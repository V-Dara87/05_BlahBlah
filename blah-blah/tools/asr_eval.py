#!/usr/bin/env python3
"""CER comparison: Qwen3-ASR (Khmer) vs a whisper.cpp model.

Optional developer tool for checking, on your own recordings, that the Khmer
Qwen3-ASR engine really is better than Whisper for your material. It is not
used by the app at runtime.

Folder layout (one subfolder per clip, or flat files):

    recordings/
      clip01.wav
      clip01.txt          <- reference transcript (UTF-8)
      clip02.m4a
      clip02.txt
      ...

Any audio ffmpeg can read works; every file is converted to 16 kHz mono WAV
before transcription. CER is character-level Levenshtein distance over the
normalized text (whitespace, zero-width characters, and punctuation removed by
default, because Qwen3-ASR emits no punctuation), divided by the number of
reference characters.

Examples:

    python tools/asr_eval.py --dir recordings
    python tools/asr_eval.py --dir recordings --no-whisper
    python tools/asr_eval.py --dir recordings --whisper src-tauri/binaries/ggml-khmer-small.bin

Requirements:
    Qwen3-ASR : Python with torch + qwen-asr (the same environment BlahBlah uses)
    Whisper   : the whisper.cpp CLI (bundled as a sidecar) plus a GGML model
    Both      : ffmpeg on PATH (or --ffmpeg)
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
import wave

AUDIO_EXTENSIONS = (".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".aac", ".webm")
REFERENCE_SUFFIXES = (".txt", ".reference.txt")
DEFAULT_QWEN_MODEL = "seanghay/Qwen3-ASR-0.6B-Khmer"
LANGUAGE_NAMES = {"km": "Khmer", "en": "English"}

# Everything that is not a letter/digit/mark (in any script, Khmer included).
# Qwen3-ASR emits no punctuation, so scoring it would only penalize the model.
PUNCTUATION_RE = re.compile(r"[^\w]+", re.UNICODE)
ZERO_WIDTH_RE = re.compile("[\u200b\u200c\u200d\ufeff]")


def log(message):
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


def normalize(text, strip_punctuation=True):
    """Text form CER is computed on."""
    out = ZERO_WIDTH_RE.sub("", str(text or ""))
    if strip_punctuation:
        out = PUNCTUATION_RE.sub("", out)
    else:
        out = re.sub(r"\s+", "", out)
    return out.replace(" ", "").replace("\t", "").replace("\n", "")


def levenshtein(a, b):
    """Character-level edit distance (two rows, O(len(b)) memory)."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, a_char in enumerate(a, start=1):
        current = [i]
        for j, b_char in enumerate(b, start=1):
            current.append(
                min(
                    previous[j] + 1,            # deletion
                    current[j - 1] + 1,         # insertion
                    previous[j - 1] + (a_char != b_char),  # substitution
                )
            )
        previous = current
    return previous[-1]


def cer(hypothesis, reference):
    reference_chars = len(reference)
    if reference_chars == 0:
        return None
    return levenshtein(hypothesis, reference) / float(reference_chars)


def find_pairs(folder):
    """[(audioPath, referencePath)] for every audio file with a .txt sibling."""
    pairs = []
    for root, _dirs, files in os.walk(folder):
        for name in sorted(files):
            stem, extension = os.path.splitext(name)
            if extension.lower() not in AUDIO_EXTENSIONS:
                continue
            audio_path = os.path.join(root, name)
            reference_path = None
            for suffix in REFERENCE_SUFFIXES:
                candidate = os.path.join(root, stem + suffix)
                if os.path.isfile(candidate):
                    reference_path = candidate
                    break
            if reference_path:
                pairs.append((audio_path, reference_path))
            else:
                log("skip (no %s.txt): %s" % (stem, audio_path))
    return pairs


def to_wav(audio_path, ffmpeg_binary):
    """Converts to 16 kHz mono PCM WAV in a temp file; returns its path."""
    handle, wav_path = tempfile.mkstemp(suffix=".wav", prefix="asr_eval_")
    os.close(handle)
    command = [
        ffmpeg_binary,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        audio_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        wav_path,
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", "replace").strip()
        raise RuntimeError("ffmpeg failed for %s: %s" % (audio_path, detail))
    return wav_path


def wav_duration(wav_path):
    try:
        with wave.open(wav_path, "rb") as handle:
            rate = handle.getframerate()
            return float(handle.getnframes()) / float(rate) if rate else 0.0
    except Exception:
        return 0.0


def read_reference(path):
    with open(path, "r", encoding="utf-8-sig") as handle:
        return handle.read()


def load_qwen(model_ref, device_preference, max_new_tokens):
    import torch
    from qwen_asr import Qwen3ASRModel

    attempts = []
    if device_preference in ("auto", "cuda") and torch.cuda.is_available():
        attempts.append({"device_map": "cuda:0", "dtype": torch.bfloat16})
    attempts.append({"device_map": "cpu", "dtype": torch.float32})

    last_error = None
    for attempt in attempts:
        for dtype_key in ("dtype", "torch_dtype"):
            kwargs = {
                "device_map": attempt["device_map"],
                "max_inference_batch_size": 1,
                "max_new_tokens": max_new_tokens,
                dtype_key: attempt["dtype"],
            }
            try:
                return Qwen3ASRModel.from_pretrained(model_ref, **kwargs)
            except TypeError as exc:
                # Older/newer releases name the dtype kwarg differently.
                last_error = exc
            except Exception as exc:
                last_error = exc
                break
    raise RuntimeError(last_error if last_error else "could not load the model")


def transcribe_qwen(model, wav_path, language_name, max_new_tokens):
    duration = wav_duration(wav_path)
    tokens = min(max_new_tokens, max(256, int(duration * 25) + 64))
    try:
        results = model.transcribe(audio=wav_path, language=language_name, max_new_tokens=tokens)
    except TypeError:
        results = model.transcribe(audio=wav_path, language=language_name)
    if not results:
        return ""
    text = getattr(results[0], "text", None)
    return (text or "").strip()


def transcribe_whisper(whisper_binary, whisper_model, wav_path, language):
    prefix = wav_path[: -len(".wav")] + "_whisper"
    command = [
        whisper_binary,
        "-m",
        whisper_model,
        "-f",
        wav_path,
        "-l",
        language,
        "-otxt",
        "-of",
        prefix,
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    text_path = prefix + ".txt"
    try:
        with open(text_path, "r", encoding="utf-8", errors="replace") as handle:
            return handle.read().strip()
    finally:
        try:
            os.remove(text_path)
        except OSError:
            pass


def fmt(value):
    return "   n/a" if value is None else "%6.2f%%" % (value * 100.0)


def main(argv):
    parser = argparse.ArgumentParser(description="CER comparison: Qwen3-ASR Khmer vs whisper.cpp")
    parser.add_argument("--dir", required=True, help="folder with <clip>.<audio> + <clip>.txt pairs")
    parser.add_argument("--language", default="km", help="language code (default: km)")
    parser.add_argument("--model", default=DEFAULT_QWEN_MODEL, help="Qwen3-ASR model dir or HF repo id")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--max-new-tokens", dest="max_new_tokens", type=int, default=2048)
    parser.add_argument("--ffmpeg", default="ffmpeg", help="ffmpeg executable (default: ffmpeg on PATH)")
    parser.add_argument("--whisper", default=None, help="whisper.cpp GGML model path")
    parser.add_argument("--whisper-cli", dest="whisper_cli", default=None, help="whisper-cli executable")
    parser.add_argument("--no-qwen", action="store_true", help="skip Qwen3-ASR")
    parser.add_argument("--no-whisper", action="store_true", help="skip whisper.cpp")
    parser.add_argument(
        "--keep-punctuation",
        action="store_true",
        help="score punctuation too (references usually have it, Qwen3-ASR does not)",
    )
    parser.add_argument("--verbose", action="store_true", help="print every transcript")
    args = parser.parse_args(argv)

    pairs = find_pairs(args.dir)
    if not pairs:
        log("No <audio + .txt> pairs found in %s" % args.dir)
        return 1

    language_name = LANGUAGE_NAMES.get(args.language, args.language)

    qwen_model = None
    if not args.no_qwen:
        try:
            qwen_model = load_qwen(args.model, args.device, args.max_new_tokens)
            log("Qwen3-ASR ready: %s" % args.model)
        except Exception as exc:
            log("Qwen3-ASR unavailable (%s) - skipping it." % exc)

    whisper_binary = args.whisper_cli
    if not args.no_whisper and args.whisper:
        if not whisper_binary:
            default_sidecars = [
                os.path.join("src-tauri", "binaries", "whisper-cli-x86_64-pc-windows-msvc.exe"),
                os.path.join("src-tauri", "binaries", "whisper-cli"),
            ]
            whisper_binary = next((path for path in default_sidecars if os.path.isfile(path)), "whisper-cli")
        if not os.path.isfile(args.whisper):
            log("Whisper model not found: %s - skipping whisper.cpp." % args.whisper)
            whisper_binary = None
    elif not args.no_whisper:
        log("No --whisper model given - skipping whisper.cpp.")
        whisper_binary = None

    rows = []
    qwen_distance = qwen_reference = 0
    whisper_distance = whisper_reference = 0

    print("")
    print("%-28s %10s %10s  %s" % ("clip", "qwen3-asr", "whisper", "reference chars"))
    print("-" * 74)

    for audio_path, reference_path in pairs:
        name = os.path.basename(audio_path)
        reference = normalize(read_reference(reference_path), not args.keep_punctuation)
        if not reference:
            log("skip (empty reference): %s" % reference_path)
            continue

        wav_path = to_wav(audio_path, args.ffmpeg)
        try:
            qwen_text = None
            if qwen_model is not None:
                try:
                    qwen_text = transcribe_qwen(qwen_model, wav_path, language_name, args.max_new_tokens)
                except Exception as exc:
                    log("Qwen3-ASR failed on %s: %s" % (name, exc))

            whisper_text = None
            if whisper_binary:
                try:
                    whisper_text = transcribe_whisper(
                        whisper_binary, args.whisper, wav_path, args.language
                    )
                except Exception as exc:
                    log("whisper.cpp failed on %s: %s" % (name, exc))

            qwen_cer = None
            if qwen_text is not None:
                qwen_hypothesis = normalize(qwen_text, not args.keep_punctuation)
                qwen_cer = cer(qwen_hypothesis, reference)
                qwen_distance += levenshtein(qwen_hypothesis, reference)
                qwen_reference += len(reference)
                if args.verbose:
                    print("  qwen3-asr > %s" % qwen_text)

            whisper_cer = None
            if whisper_text is not None:
                whisper_hypothesis = normalize(whisper_text, not args.keep_punctuation)
                whisper_cer = cer(whisper_hypothesis, reference)
                whisper_distance += levenshtein(whisper_hypothesis, reference)
                whisper_reference += len(reference)
                if args.verbose:
                    print("  whisper   > %s" % whisper_text)

            rows.append((name, qwen_cer, whisper_cer, len(reference)))
            print("%-28s %10s %10s  %d" % (name, fmt(qwen_cer), fmt(whisper_cer), len(reference)))
        finally:
            try:
                os.remove(wav_path)
            except OSError:
                pass

    print("-" * 74)
    corpus_qwen = (qwen_distance / float(qwen_reference)) if qwen_reference else None
    corpus_whisper = (whisper_distance / float(whisper_reference)) if whisper_reference else None
    print("%-28s %10s %10s  %d" % ("CORPUS (micro-average)", fmt(corpus_qwen), fmt(corpus_whisper), qwen_reference))
    print("")

    if corpus_qwen is not None and corpus_whisper is not None:
        if corpus_qwen < corpus_whisper:
            print("Qwen3-ASR is better on this set by %.2f points of CER." % ((corpus_whisper - corpus_qwen) * 100.0))
        else:
            print("Whisper is better on this set by %.2f points of CER." % ((corpus_qwen - corpus_whisper) * 100.0))

    return 0 if rows else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
