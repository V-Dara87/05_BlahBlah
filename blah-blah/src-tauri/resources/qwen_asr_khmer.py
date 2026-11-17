#!/usr/bin/env python3
"""Qwen3-ASR Khmer helper for BlahBlah.

Runs seanghay/Qwen3-ASR-0.6B-Khmer (Apache-2.0, fine-tuned from
Qwen/Qwen3-ASR-0.6B on ~700h of Khmer speech) through the ``qwen-asr``
package, and downloads its weights.

This script is spawned by the Rust command ``run_qwen_asr`` (see
src-tauri/src/lib.rs). The app does NOT bundle PyTorch: the user points
BlahBlah at a Python interpreter that has ``torch`` + ``qwen-asr``
installed (Settings > Speech Recognition).

Every stdout line is one machine-readable record, because the Rust side
forwards each line to the webview as a ``qwen-asr-progress`` event:

    QASR_CHECK     {...}   setup probe                       (--check)
    QASR_STATUS    {...}   device / dtype (and whether the aligner loaded)
    QASR_PROGRESS  {...}   about to transcribe chunk i of n
    QASR_RESULT    {...}   transcript for chunk i, plus word timings
    QASR_WARNING   {...}   something degraded but the job continues
    QASR_ERROR     {...}   one chunk failed; the job continues
    QASR_DOWNLOAD  {...}   bytes written to the model directory so far
    QASR_DONE      {...}   every chunk processed

Usage:
    python qwen_asr_khmer.py --check
    python qwen_asr_khmer.py --download --model <dir> [--cache-dir <dir>]
    python qwen_asr_khmer.py --audio <16k wav> --chunks-file <json> \
        --model <dir-or-repo-id> [--language km] \
        [--time-stamps --aligner <dir-or-repo-id>]

The chunks file is ``{"language": "km", "chunks": [{"start": 0.0, "end": 12.5}]}``.
Phrase timing comes entirely from that plan: the model returns text without
timestamps, so BlahBlah detects speech with ffmpeg first, splits the audio
into chunks of at most ~25 s, and uses each chunk's start/end as the
subtitle timing.

With ``--time-stamps`` the model is constructed with Qwen's forced aligner
(``Qwen/Qwen3-ForcedAligner-0.6B``, Apache-2.0) and each RESULT also carries
``words``: a list of ``{"text", "start", "end"}`` entries already offset by
the chunk start, clamped to the chunk, and sorted by start. Alignment is
optional: if the aligner cannot be loaded the script says so once and keeps
transcribing without word timings.

The model was tuned on clean read speech; it is weaker on noisy or
spontaneous audio and on Khmer/English code-switching. Output has no
punctuation. Those limitations are documented, not worked around here.
"""

import argparse
import json
import math
import os
import sys
import threading
import time
import wave

DEFAULT_REPO = "seanghay/Qwen3-ASR-0.6B-Khmer"
DEFAULT_ALIGNER_REPO = "Qwen/Qwen3-ForcedAligner-0.6B"

# Qwen3-ASR is a multilingual model, but this fine-tune is Khmer-only, so
# BlahBlah only offers these. Values are the names the model expects.
# Khmer maps to None (no language hint): the qwen-asr package validates the
# ``language`` argument against the base model's supported-language list, which
# does not include Khmer, so passing "Khmer" raises "Unsupported language".
# The fine-tune is Khmer-only, so no hint is needed.
LANGUAGE_NAMES = {"km": None, "en": "English"}

# Khmer speech tokenizes to roughly 20-30 tokens per second of audio.
TOKENS_PER_SECOND = 25.0
MIN_NEW_TOKENS = 64
DEFAULT_MAX_NEW_TOKENS_CAP = 1024

PRINT_LOCK = threading.Lock()


def emit(kind, payload):
    """Write one machine-readable progress record (never raises)."""
    try:
        line = "QASR_%s %s" % (kind, json.dumps(payload, ensure_ascii=True, default=str))
        with PRINT_LOCK:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()
    except Exception:
        # A broken pipe means the app closed the process; nothing to report.
        pass


def setup_streams():
    """Force UTF-8 so Khmer text survives a Windows console code page."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def check_setup():
    """Probe the interpreter: torch, qwen-asr, and CUDA availability."""
    details = {
        "ready": False,
        "pythonVersion": sys.version.split()[0],
        "pythonPath": sys.executable,
        "torch": False,
        "torchVersion": None,
        "qwenAsr": False,
        "qwenAsrVersion": None,
        "cuda": False,
        "deviceName": None,
        "problems": [],
    }

    try:
        import torch  # noqa: F401  (probe only)

        details["torch"] = True
        details["torchVersion"] = getattr(torch, "__version__", None)
        try:
            details["cuda"] = bool(torch.cuda.is_available())
            if details["cuda"]:
                details["deviceName"] = torch.cuda.get_device_name(0)
        except Exception as exc:
            details["problems"].append("CUDA probe failed: %s" % exc)
    except Exception as exc:
        details["problems"].append(
            'torch is not installed in this interpreter (%s). Run: pip install torch'
            % exc
        )

    try:
        import qwen_asr  # noqa: F401  (probe only)

        details["qwenAsr"] = True
        details["qwenAsrVersion"] = getattr(qwen_asr, "__version__", None)
    except Exception as exc:
        details["problems"].append(
            'qwen-asr is not installed in this interpreter (%s). Run: pip install -U qwen-asr'
            % exc
        )

    details["ready"] = bool(details["torch"] and details["qwenAsr"])
    emit("CHECK", details)
    # Always exit 0: "not ready" is a normal answer, reported in the payload.
    # A non-zero exit would make the Rust command surface a process error and
    # the app could not show the setup instructions this check exists for.
    return 0


def directory_size(path):
    total = 0
    try:
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(root, name))
                except OSError:
                    pass
    except OSError:
        pass
    return total


def download_model(model_dir, cache_dir, repo):
    """Download the HF snapshot into model_dir (no PyTorch needed)."""
    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:
        emit(
            "FATAL",
            {
                "message": (
                    "huggingface_hub is required to download the model (%s). "
                    "Run: pip install -U huggingface_hub"
                    % exc
                )
            },
        )
        return 1

    os.makedirs(model_dir, exist_ok=True)
    stop = threading.Event()

    def poll():
        while not stop.wait(0.75):
            emit("DOWNLOAD", {"bytes": directory_size(model_dir)})

    poller = threading.Thread(target=poll, name="qasr-download-poll")
    poller.daemon = True
    poller.start()

    try:
        kwargs = {"repo_id": repo, "local_dir": model_dir}
        if cache_dir:
            kwargs["cache_dir"] = cache_dir
        snapshot_download(**kwargs)
    except Exception as exc:
        stop.set()
        emit("FATAL", {"message": "Model download failed: %s" % exc})
        return 1
    finally:
        stop.set()

    emit("DOWNLOAD", {"bytes": directory_size(model_dir), "done": True})
    emit("DONE", {"downloaded": True, "modelDir": model_dir})
    return 0


def load_model(
    model_ref, cache_dir, device_preference, max_new_tokens, aligner_ref=None
):
    """Load Qwen3ASRModel, preferring bf16 on CUDA, falling back to CPU.

    When ``aligner_ref`` is given, the forced aligner is loaded alongside the
    ASR model so ``transcribe(..., return_time_stamps=True)`` can return word
    timings. Returns ``(model, device_attempt, aligner_loaded)``; a build of
    qwen-asr that does not know the aligner kwargs simply drops them, and the
    caller keeps working without word timings.
    """
    import torch
    from qwen_asr import Qwen3ASRModel

    wants_cuda = device_preference in ("auto", "cuda") and bool(torch.cuda.is_available())
    attempts = []
    if wants_cuda:
        attempts.append(
            {
                "deviceMap": "cuda:0",
                "device": "cuda:0",
                "dtypeName": "bfloat16",
                "dtype": torch.bfloat16,
            }
        )
    attempts.append(
        {
            "deviceMap": "cpu",
            "device": "cpu",
            "dtypeName": "float32",
            "dtype": torch.float32,
        }
    )

    def build_kwargs(attempt, dtype_key, with_aligner):
        kwargs = {
            "max_inference_batch_size": 1,
            "max_new_tokens": int(max_new_tokens),
            "device_map": attempt["deviceMap"],
            dtype_key: attempt["dtype"],
        }
        if cache_dir:
            kwargs["cache_dir"] = cache_dir
        if with_aligner and aligner_ref:
            kwargs["forced_aligner"] = aligner_ref
            aligner_kwargs = {
                "dtype": attempt["dtype"],
                "device_map": attempt["deviceMap"],
            }
            if cache_dir:
                aligner_kwargs["cache_dir"] = cache_dir
            kwargs["forced_aligner_kwargs"] = aligner_kwargs
        return kwargs

    last_error = None
    aligner_supported = bool(aligner_ref)

    for attempt in attempts:
        for dtype_key in ("dtype", "torch_dtype"):
            try:
                model = Qwen3ASRModel.from_pretrained(
                    model_ref, **build_kwargs(attempt, dtype_key, aligner_supported)
                )
                return model, attempt, aligner_supported
            except TypeError as exc:
                # Older/newer releases may name the dtype kwarg differently, and
                # some builds predate forced_aligner. Retry without the aligner
                # once, then keep trying the remaining dtypes/devices.
                last_error = exc
                if aligner_supported:
                    aligner_supported = False
                    try:
                        model = Qwen3ASRModel.from_pretrained(
                            model_ref, **build_kwargs(attempt, dtype_key, False)
                        )
                        return model, attempt, False
                    except Exception as inner:
                        last_error = inner
                continue
            except Exception as exc:
                last_error = exc
                if aligner_supported:
                    # A missing or half-downloaded aligner must cost the word
                    # timings, never the transcript: retry without it.
                    aligner_supported = False
                    try:
                        model = Qwen3ASRModel.from_pretrained(
                            model_ref, **build_kwargs(attempt, dtype_key, False)
                        )
                        return model, attempt, False
                    except Exception as inner:
                        last_error = inner
                continue

    raise RuntimeError(last_error if last_error else "could not load the model")


class WavReader(object):
    """Random-access reader for the 16 kHz mono PCM WAV the app extracts."""

    def __init__(self, path):
        self.file = wave.open(path, "rb")
        self.channels = self.file.getnchannels()
        self.sample_rate = self.file.getframerate()
        self.sample_width = self.file.getsampwidth()
        self.frame_count = self.file.getnframes()
        if self.sample_width != 2:
            raise RuntimeError(
                "Expected 16-bit PCM audio, got %d-byte samples." % self.sample_width
            )

    @property
    def duration(self):
        if not self.sample_rate:
            return 0.0
        return float(self.frame_count) / float(self.sample_rate)

    def read(self, start, end):
        import numpy as np

        start_frame = max(0, int(round(float(start) * self.sample_rate)))
        end_frame = min(self.frame_count, int(round(float(end) * self.sample_rate)))
        if end_frame <= start_frame:
            return np.zeros(0, dtype="float32")
        self.file.setpos(start_frame)
        frames = self.file.readframes(end_frame - start_frame)
        samples = np.frombuffer(frames, dtype="<i2").astype("float32") / 32768.0
        if self.channels > 1:
            samples = samples.reshape(-1, self.channels).mean(axis=1)
        return samples

    def close(self):
        try:
            self.file.close()
        except Exception:
            pass


def max_new_tokens_for_chunk(seconds, cap):
    """Cap generation relative to chunk length so it cannot run away."""
    estimate = int(math.ceil(max(0.0, float(seconds)) * TOKENS_PER_SECOND)) + 32
    return int(max(MIN_NEW_TOKENS, min(int(cap), estimate)))


def result_text(result):
    if result is None:
        return ""
    text = getattr(result, "text", None)
    if text is None and isinstance(result, dict):
        text = result.get("text")
    return (text or "").strip()


def result_words(result):
    """Word timings from a result, relative to the audio we passed in."""
    stamps = getattr(result, "time_stamps", None)
    if not stamps and isinstance(result, dict):
        stamps = result.get("time_stamps")

    words = []
    for stamp in stamps or []:
        if isinstance(stamp, dict):
            text = stamp.get("text")
            start = stamp.get("start_time")
            end = stamp.get("end_time")
        else:
            text = getattr(stamp, "text", None)
            start = getattr(stamp, "start_time", None)
            end = getattr(stamp, "end_time", None)
        try:
            start_value = float(start)
            end_value = float(end)
        except (TypeError, ValueError):
            continue
        cleaned = (text or "").strip()
        if not cleaned or end_value <= start_value:
            continue
        words.append({"text": cleaned, "start": start_value, "end": end_value})
    return words


def transcribe_chunk(
    model, samples, sample_rate, language_name, max_new_tokens, want_time_stamps=False
):
    """Returns ``(text, words)``; words are relative to this chunk's audio."""
    audio = (samples, sample_rate)
    kwargs = {
        "audio": audio,
        "language": language_name,
        "max_new_tokens": max_new_tokens,
    }

    results = None
    if want_time_stamps:
        try:
            results = model.transcribe(return_time_stamps=True, **kwargs)
        except TypeError:
            # This qwen-asr build has no return_time_stamps argument.
            results = None
        except Exception:
            # Alignment is best-effort: never lose the transcript over it.
            results = None

    if results is None:
        try:
            results = model.transcribe(**kwargs)
        except TypeError:
            # Older releases only take max_new_tokens at construction time.
            results = model.transcribe(audio=audio, language=language_name)

    if not results:
        return "", []
    return result_text(results[0]), result_words(results[0])


def transcribe(args):
    try:
        with open(args.chunks_file, "r", encoding="utf-8") as handle:
            plan = json.load(handle)
    except Exception as exc:
        emit("FATAL", {"message": "Could not read the chunk plan: %s" % exc})
        return 1

    chunks = plan.get("chunks") or []
    language_code = plan.get("language") or args.language or "km"
    language_name = LANGUAGE_NAMES.get(language_code)
    if not chunks:
        emit("DONE", {"count": 0})
        return 0

    max_new_tokens_cap = args.max_new_tokens_cap
    longest = max(float(c.get("end", 0)) - float(c.get("start", 0)) for c in chunks)
    load_cap = max_new_tokens_for_chunk(max(longest, 0.0), max_new_tokens_cap)

    want_time_stamps = bool(getattr(args, "time_stamps", False))

    emit(
        "STATUS",
        {"stage": "loading", "model": args.model, "aligner": want_time_stamps},
    )
    try:
        model, attempt, aligner_loaded = load_model(
            args.model,
            args.cache_dir,
            args.device,
            load_cap,
            args.aligner if want_time_stamps else None,
        )
    except Exception as exc:
        emit("FATAL", {"message": "Could not load Qwen3-ASR: %s" % exc})
        return 1

    aligner_ready = bool(want_time_stamps and aligner_loaded)
    emit(
        "STATUS",
        {
            "stage": "ready",
            "device": attempt["device"],
            "dtype": attempt["dtypeName"],
            "cuda": attempt["device"] != "cpu",
            "aligner": aligner_ready,
        },
    )
    if want_time_stamps and not aligner_ready:
        emit(
            "WARNING",
            {
                "message": (
                    "The forced aligner could not be loaded, so these subtitles "
                    "have chunk timing only (no word timings)."
                )
            },
        )

    try:
        reader = WavReader(args.audio)
    except Exception as exc:
        emit("FATAL", {"message": "Could not read the audio file: %s" % exc})
        return 1

    total = len(chunks)
    produced = 0
    try:
        for index, chunk in enumerate(chunks):
            start = float(chunk.get("start", 0.0))
            end = float(chunk.get("end", 0.0))
            duration = max(0.0, end - start)
            emit(
                "PROGRESS",
                {
                    "index": index,
                    "total": total,
                    "start": start,
                    "end": end,
                },
            )
            if duration <= 0:
                continue
            try:
                samples = reader.read(start, end)
                if samples.size == 0:
                    continue
                text, chunk_words = transcribe_chunk(
                    model,
                    samples,
                    reader.sample_rate,
                    language_name,
                    max_new_tokens_for_chunk(duration, max_new_tokens_cap),
                    aligner_ready,
                )
            except Exception as exc:
                # One bad chunk must never kill the whole subtitle job.
                emit("ERROR", {"index": index, "message": str(exc)})
                continue
            if not text:
                continue
            produced += 1

            # Word timings are relative to the chunk audio; offset them into
            # clip time and keep them inside the chunk the text came from.
            emitted_words = []
            for word in chunk_words:
                word_start = min(max(start, start + word["start"]), end)
                word_end = min(max(start, start + word["end"]), end)
                if word_end <= word_start:
                    continue
                emitted_words.append(
                    {
                        "text": word["text"],
                        "start": round(word_start, 3),
                        "end": round(word_end, 3),
                    }
                )

            payload = {
                "index": index,
                "start": start,
                "end": end,
                "text": text,
            }
            if emitted_words:
                payload["words"] = emitted_words
            emit("RESULT", payload)
    finally:
        reader.close()

    emit("DONE", {"count": produced, "total": total})
    return 0


def main(argv):
    setup_streams()
    parser = argparse.ArgumentParser(description="Qwen3-ASR Khmer helper for BlahBlah")
    parser.add_argument("--check", action="store_true", help="probe the environment")
    parser.add_argument("--download", action="store_true", help="download model weights")
    parser.add_argument("--audio", help="16 kHz mono PCM WAV file")
    parser.add_argument("--chunks-file", dest="chunks_file", help="JSON speech-chunk plan")
    parser.add_argument("--model", default=DEFAULT_REPO, help="model directory or HF repo id")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="HF repo id to download")
    parser.add_argument("--cache-dir", dest="cache_dir", help="Hugging Face cache directory")
    parser.add_argument("--language", default="km")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    parser.add_argument(
        "--time-stamps",
        dest="time_stamps",
        action="store_true",
        help="return word-level timings from the forced aligner",
    )
    parser.add_argument(
        "--aligner",
        default=DEFAULT_ALIGNER_REPO,
        help="forced-aligner model directory or HF repo id",
    )
    parser.add_argument(
        "--max-new-tokens-cap",
        dest="max_new_tokens_cap",
        type=int,
        default=DEFAULT_MAX_NEW_TOKENS_CAP,
    )
    args = parser.parse_args(argv)

    if args.check:
        return check_setup()
    if args.download:
        return download_model(args.model, args.cache_dir, args.repo)
    if not args.audio or not args.chunks_file:
        emit("FATAL", {"message": "--audio and --chunks-file are required."})
        return 1
    return transcribe(args)


if __name__ == "__main__":
    start = time.time()
    try:
        code = main(sys.argv[1:])
    except KeyboardInterrupt:
        code = 130
    except Exception as unexpected:
        emit("FATAL", {"message": "Unexpected error: %s" % unexpected})
        code = 1
    sys.exit(code)