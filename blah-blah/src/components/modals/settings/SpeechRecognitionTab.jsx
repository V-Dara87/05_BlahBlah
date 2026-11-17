import { useEffect, useState } from 'react';
import { RotateCcw, RefreshCw, Loader2, CheckCircle2, AlertCircle, Cpu } from 'lucide-react';
import { ASR_DEFAULTS } from '../../../services/asrSettings';
import {
  checkQwenAsrSetup,
  QWEN3_ALIGNER_MODEL_REPO,
  QWEN3_ASR_MODEL_REPO,
} from '../../../services/qwenAsrRunner';
import { isTauri } from '../../../services/tauriFsAdapter';

const PIP_COMMANDS = 'pip install torch\npip install -U qwen-asr';

function StatusRow({ ok, label, detail }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      {ok ? (
        <CheckCircle2 size={12} style={{ color: '#34d399', flexShrink: 0 }} />
      ) : (
        <AlertCircle size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
      )}
      <span style={{ color: 'var(--unity-text, #e2e8f0)' }}>{label}</span>
      {detail && <span style={{ color: 'var(--unity-text-dim, #94a3b8)', marginLeft: 'auto' }}>{detail}</span>}
    </div>
  );
}

/**
 * Speech Recognition tab — settings for the local speech-to-text engines used
 * by the auto-subtitle feature.
 *
 * Today that is exactly one value: which Python interpreter the Qwen3-ASR
 * (Khmer) helper runs with. PyTorch is deliberately not bundled with the app,
 * so the tab also carries the setup check (Python found? torch + qwen-asr
 * importable? CUDA available?) and the pip commands to fix what is missing.
 * Whisper needs no interpreter — it ships as a sidecar.
 */
export function SpeechRecognitionTab({ settings, onChange }) {
  const current = settings || ASR_DEFAULTS;
  const [draft, setDraft] = useState(current.pythonPath);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const desktop = isTauri();

  const runCheck = async (pythonPath) => {
    if (!desktop) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await checkQwenAsrSetup({ pythonPath });
      setStatus(result);
    } catch (err) {
      setStatus({
        ready: false,
        pythonFound: false,
        torch: false,
        qwenAsr: false,
        cuda: false,
        deviceName: null,
        problems: [],
        error: err?.message || String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  // Probe the stored interpreter as soon as the tab opens, so the answer is
  // already on screen instead of behind one more click.
  useEffect(() => {
    runCheck(current.pythonPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Commit the typed path on blur instead of on every keystroke, so a
  // half-typed path never gets stored or spawns a doomed check.
  const commit = () => {
    const next = draft.trim() || ASR_DEFAULTS.pythonPath;
    if (next !== draft) setDraft(next);
    if (next !== current.pythonPath) onChange?.({ ...current, pythonPath: next });
    return next;
  };

  const handleCheck = async () => {
    const pythonPath = commit();
    await runCheck(pythonPath);
  };

  const isDefault = current.pythonPath === ASR_DEFAULTS.pythonPath;

  return (
    <div className="modal-body settings-body">
      <div className="form-field-group">
        <label className="form-label">Qwen3-ASR Python interpreter</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            className="modal-text-input"
            style={{ flex: 1 }}
            value={draft}
            spellCheck={false}
            placeholder="python"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCheck();
            }}
          />
          <button
            type="button"
            className="btn-secondary btn-xs"
            disabled={busy || !desktop}
            onClick={handleCheck}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Check
          </button>
        </div>
        <p className="hint-text-sm">
          Either a command on PATH (<code>python</code>, <code>python3</code>) or the absolute path to a
          virtual environment's <code>python.exe</code>. PyTorch is not bundled with BlahBlah, so the
          environment must have <code>torch</code> and <code>qwen-asr</code> installed. Whisper ignores
          this setting.
        </p>
        <pre
          style={{
            margin: '6px 0 0',
            padding: '6px 8px',
            borderRadius: 4,
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid var(--unity-border, rgba(255, 255, 255, 0.12))',
            fontSize: 10.5,
            lineHeight: 1.5,
            color: 'var(--unity-text-dim, #94a3b8)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {PIP_COMMANDS}
        </pre>
      </div>

      <div className="form-field-group">
        <label className="form-label">Setup status</label>

        {!desktop && (
          <p className="hint-text-sm">
            Qwen3-ASR only runs in the desktop app. Auto-subtitles in the browser build use Whisper models.
          </p>
        )}

        {desktop && busy && (
          <p className="hint-text-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={12} className="animate-spin" />
            Checking {draft.trim() || ASR_DEFAULTS.pythonPath}…
          </p>
        )}

        {desktop && status && !busy && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: '8px 10px',
              borderRadius: 4,
              border: '1px solid var(--unity-border, rgba(255, 255, 255, 0.12))',
              background: 'rgba(15, 23, 42, 0.4)',
            }}
          >
            <StatusRow
              ok={status.pythonFound}
              label="Python"
              detail={status.pythonVersion || status.pythonPath}
            />
            <StatusRow ok={status.torch} label="torch" />
            <StatusRow ok={status.qwenAsr} label="qwen-asr" />
            <StatusRow
              ok={status.cuda}
              label="CUDA"
              detail={status.cuda ? status.deviceName || 'available' : 'CPU only'}
            />

            {status.ready && status.cuda && (
              <p className="hint-text-sm" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle2 size={12} style={{ color: '#34d399' }} />
                Ready. Qwen3-ASR will run in bf16 on the GPU.
              </p>
            )}

            {status.ready && !status.cuda && (
              <p className="hint-text-sm" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5, color: '#f59e0b' }}>
                <Cpu size={12} />
                No CUDA device found — Qwen3-ASR will fall back to CPU, which is much slower.
              </p>
            )}

            {!status.ready && status.error && (
              <p className="hint-text-sm" style={{ margin: 0, color: '#f59e0b', whiteSpace: 'pre-wrap' }}>
                {status.error}
              </p>
            )}

            {!status.ready && status.problems?.length > 0 && (
              <ul className="hint-text-sm" style={{ margin: 0, paddingLeft: 16 }}>
                {status.problems.map((problem, index) => (
                  <li key={index}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="hint-text-sm settings-hint-spaced">
          The Khmer model is <code>{QWEN3_ASR_MODEL_REPO}</code> (Apache-2.0). Install it from the Package
          Manager's Speech tab; it is a Hugging Face snapshot of roughly 1.5 GB and does not download PyTorch.
        </p>
        <p className="hint-text-sm">
          Word-level subtitle timings use the optional <code>{QWEN3_ALIGNER_MODEL_REPO}</code> package
          (Apache-2.0, ~1.2 GB). It is only loaded when “Word-level timings” is enabled in the
          auto-subtitle popover, and subtitles still work without it.
        </p>
      </div>

      <button
        type="button"
        className="btn-secondary btn-xs"
        disabled={isDefault && draft === ASR_DEFAULTS.pythonPath}
        onClick={() => {
          setDraft(ASR_DEFAULTS.pythonPath);
          onChange?.({ ...current, pythonPath: ASR_DEFAULTS.pythonPath });
          runCheck(ASR_DEFAULTS.pythonPath);
        }}
      >
        <RotateCcw size={12} />
        Reset to Defaults
      </button>
    </div>
  );
}
