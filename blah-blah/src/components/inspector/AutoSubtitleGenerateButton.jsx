import { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Loader2,
  DownloadCloud,
  ChevronDown,
  AlertCircle,
  Cpu,
  XCircle,
  CheckCircle2,
} from 'lucide-react';
import { WHISPER_LANGUAGES } from '../../data/whisperLanguages.js';
import { generateSubtitlesFromEntity } from '../../engine/subtitleAutoGenerate.js';
import {
  isPackageInstalled,
  listInstalledPackages,
} from '../../services/packageManager.js';
import { addPhrase } from '../../engine/subtitleTrack.js';
import {
  ASR_ENGINE_QWEN3,
  QWEN3_ALIGNER_PACKAGE_ID,
  getEngineLabel,
  getModelEngine,
  isQwen3AsrPackage,
  listAsrModelsForLanguage,
} from '../../engine/asrEngines.js';
import {
  QWEN3_ASR_MODEL_REPO,
  cancelQwenAsr,
  checkQwenAsrSetup,
} from '../../services/qwenAsrRunner.js';
import { isTauri } from '../../services/tauriFsAdapter.js';

const PIP_COMMANDS = 'pip install torch\npip install -U qwen-asr';

/** Human-readable phase text for the trigger button and the progress line. */
function progressLabel(progress) {
  if (!progress) return 'Processing...';
  if (progress.phase === 'extracting') return 'Extracting audio...';
  if (progress.phase === 'analyzing') return 'Finding speech...';
  if (progress.phase === 'loading') return 'Loading model...';
  if (progress.phase === 'transcribing') {
    if (progress.chunkTotal) return `Transcribing ${progress.chunkIndex || 1}/${progress.chunkTotal}`;
    return `Transcribing ${progress.percent ? `${progress.percent}%` : '...'}`;
  }
  return 'Processing...';
}

export function AutoSubtitleGenerateButton({
  component,
  selectedEntity,
  commitComponent,
  onOpenPackageManager,
  mediaAssets = [],
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [selectedModelId, setSelectedModelId] = useState('whisper-small');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelInstalled, setModelInstalled] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [setupChecking, setSetupChecking] = useState(false);
  const [alignerInstalled, setAlignerInstalled] = useState(false);
  const [wordTimings, setWordTimings] = useState(true);
  const [wordTimingsUnavailable, setWordTimingsUnavailable] = useState(false);

  const containerRef = useRef(null);
  const isDesktop = isTauri();

  const selectedPackage = availableModels.find((m) => m.id === selectedModelId) || null;
  const engine = getModelEngine(selectedPackage);
  const engineLabel = getEngineLabel(engine);
  const isQwen = engine === ASR_ENGINE_QWEN3;
  const qwenReady = !isQwen || (!setupChecking && Boolean(setupStatus?.ready));
  // Word timings need BOTH the aligner package and the user's consent: it is a
  // second 0.6B model loaded next to the ASR model.
  const useWordTimings = isQwen && alignerInstalled && wordTimings;

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Load models matching the chosen language. Khmer lists Qwen3-ASR first
  // (recommended), then the Whisper Khmer fine-tune; every other language keeps
  // the official Whisper category. The browser build hides Qwen3-ASR entirely:
  // it needs the desktop app's Python bridge.
  useEffect(() => {
    let cancelled = false;

    async function checkModels() {
      const [allForLang, installed, alignerIsInstalled] = await Promise.all([
        listAsrModelsForLanguage(selectedLanguage),
        listInstalledPackages(),
        isPackageInstalled(QWEN3_ALIGNER_PACKAGE_ID),
      ]);
      if (cancelled) return;
      setAlignerInstalled(Boolean(alignerIsInstalled));

      const models = isDesktop ? allForLang : allForLang.filter((m) => !isQwen3AsrPackage(m));
      if (cancelled) return;
      setAvailableModels(models);

      const installedIds = new Set((installed || []).map((pkg) => pkg.id));
      const keepCurrent = models.find((m) => m.id === selectedModelId);
      const firstInstalled = models.find((m) => installedIds.has(m.id));
      const nextModel = keepCurrent || firstInstalled || models[0] || null;
      const nextId = nextModel?.id || 'whisper-small';

      setSelectedModelId(nextId);
      setModelInstalled(nextModel ? installedIds.has(nextModel.id) : false);
      setSetupStatus(null);
    }

    checkModels();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLanguage, isOpen]);

  // Qwen3-ASR needs Python + torch + qwen-asr. Check once per open/model change
  // so the popover can show setup instructions instead of failing at generate
  // time.
  useEffect(() => {
    if (!isOpen || !isDesktop || !isQwen) {
      setSetupStatus(null);
      setSetupChecking(false);
      return undefined;
    }

    let cancelled = false;
    setSetupChecking(true);
    setSetupStatus(null);

    checkQwenAsrSetup()
      .then((status) => {
        if (!cancelled) setSetupStatus(status);
      })
      .catch((err) => {
        if (!cancelled) {
          setSetupStatus({
            ready: false,
            pythonFound: false,
            cuda: false,
            problems: [],
            error: err?.message || String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setSetupChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, isDesktop, isQwen]);

  // When model selection changes, check if installed
  const handleModelChange = async (modelId) => {
    setSelectedModelId(modelId);
    const isInst = await isPackageInstalled(modelId);
    setModelInstalled(isInst);
    setErrorMessage(null);
  };

  const handleGenerate = async () => {
    setErrorMessage(null);
    setWordTimingsUnavailable(false);
    setIsGenerating(true);
    setGenerationProgress({ phase: 'extracting', percent: 0 });

    try {
      const generatedPhrases = await generateSubtitlesFromEntity({
        entity: selectedEntity,
        mediaAssets,
        language: selectedLanguage,
        modelId: selectedModelId,
        withWordTimings: useWordTimings,
        onProgress: (p) => {
          if (p.wordTimingsUnavailable) setWordTimingsUnavailable(true);
          setGenerationProgress(p);
        },
      });

      if (!generatedPhrases || generatedPhrases.length === 0) {
        throw new Error(`${engineLabel} produced no transcript segments for this clip.`);
      }

      // Check if existing phrases should be replaced or appended
      const existing = component.phrases || [];
      let mergedComponent;

      if (existing.length > 0) {
        const shouldReplace = window.confirm(
          `Generated ${generatedPhrases.length} subtitle phrases.\n\nClick OK to REPLACE the existing ${existing.length} phrases, or CANCEL to APPEND to them.`
        );
        if (shouldReplace) {
          mergedComponent = generatedPhrases.reduce(
            (comp, phrase) => addPhrase(comp, phrase),
            { ...component, phrases: [] }
          );
        } else {
          mergedComponent = generatedPhrases.reduce(
            (comp, phrase) => addPhrase(comp, phrase),
            component
          );
        }
      } else {
        mergedComponent = generatedPhrases.reduce(
          (comp, phrase) => addPhrase(comp, phrase),
          { ...component, phrases: [] }
        );
      }

      commitComponent(mergedComponent);
      setIsOpen(false);
    } catch (err) {
      console.error('[AutoSubtitleGenerateButton] Generation failed:', err);
      setErrorMessage(err.message || 'Auto-subtitle generation failed');
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const languageOptions = isQwen
    ? WHISPER_LANGUAGES.filter((lang) => lang.code === 'km')
    : WHISPER_LANGUAGES;

  const installCategory = isQwen ? 'whisper' : WHISPER_LANGUAGES.find((l) => l.code === selectedLanguage)?.modelCategory || 'whisper-model-official';

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="unity-btn unity-btn-secondary btn-xs"
        disabled={isGenerating}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Auto-generate subtitles using a local speech-recognition model"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(56, 189, 248, 0.1)',
          borderColor: 'rgba(56, 189, 248, 0.3)',
          color: '#38bdf8',
        }}
      >
        {isGenerating ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <Sparkles size={11} />
        )}
        <span>{isGenerating ? progressLabel(generationProgress) : 'Auto-generate'}</span>
        <ChevronDown size={10} style={{ opacity: 0.7 }} />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            width: 270,
            background: '#181a24',
            border: '1px solid var(--unity-border, rgba(255, 255, 255, 0.15))',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
            padding: 10,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles size={12} className="text-cyan" />
            <span>Generate Subtitles</span>
          </div>

          {/* Language Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 9, color: 'var(--unity-text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
              Audio Language
            </label>
            <select
              className="inspector-select"
              style={{ fontSize: 11, padding: '3px 6px', width: '100%' }}
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              disabled={isGenerating}
            >
              {languageOptions.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label} ({lang.code})
                </option>
              ))}
            </select>
          </div>

          {/* Model Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 9, color: 'var(--unity-text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
              {engineLabel} Model
            </label>
            <select
              className="inspector-select"
              style={{ fontSize: 11, padding: '3px 6px', width: '100%' }}
              value={selectedModelId}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={isGenerating}
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
            {isQwen && selectedPackage?.attribution && (
              <span style={{ fontSize: 9, color: 'var(--unity-text-dim)' }}>
                {selectedPackage.attribution}
              </span>
            )}
          </div>

          {/* Word-level timings (optional forced aligner) */}
          {isQwen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 10,
                  color: alignerInstalled ? '#e2e8f0' : 'var(--unity-text-dim)',
                }}
              >
                <input
                  type="checkbox"
                  checked={useWordTimings}
                  disabled={!alignerInstalled || isGenerating}
                  onChange={(e) => setWordTimings(e.target.checked)}
                />
                <span>Word-level timings</span>
              </label>

              {!alignerInstalled ? (
                <div style={{ fontSize: 9, color: 'var(--unity-text-dim)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span>Needs the Qwen3 Forced Aligner (0.6B, ~1.2 GB).</span>
                  <button
                    type="button"
                    className="unity-btn unity-btn-secondary btn-xs"
                    style={{ fontSize: 10, padding: '2px 6px', alignSelf: 'flex-start' }}
                    onClick={() => {
                      setIsOpen(false);
                      onOpenPackageManager?.('whisper');
                    }}
                  >
                    Open Package Manager
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: 9, color: 'var(--unity-text-dim)' }}>
                  Adds per-word times from Qwen3-ForcedAligner-0.6B (slower, more VRAM).
                </span>
              )}
            </div>
          )}

          {/* Model Installation Warning / Prompt */}
          {!modelInstalled && (
            <div
              style={{
                fontSize: 10,
                color: '#f59e0b',
                background: 'rgba(245, 158, 11, 0.1)',
                padding: '6px 8px',
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <DownloadCloud size={12} />
                <span>{engineLabel} model not installed</span>
              </div>
              <button
                type="button"
                className="unity-btn unity-btn-secondary btn-xs"
                style={{ fontSize: 10, padding: '2px 6px' }}
                onClick={() => {
                  setIsOpen(false);
                  onOpenPackageManager?.(installCategory);
                }}
              >
                Open Package Manager to Install
              </button>
            </div>
          )}

          {/* Qwen3-ASR setup: Python/torch/qwen-asr/CUDA */}
          {isQwen && isDesktop && (
            <div
              style={{
                fontSize: 10,
                color: qwenReady ? '#94a3b8' : '#f59e0b',
                background: qwenReady ? 'rgba(148, 163, 184, 0.08)' : 'rgba(245, 158, 11, 0.1)',
                padding: '6px 8px',
                borderRadius: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {setupChecking && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Loader2 size={11} className="animate-spin" />
                  <span>Checking Python environment…</span>
                </div>
              )}

              {!setupChecking && setupStatus?.ready && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={11} style={{ color: '#34d399' }} />
                  <span>Python ready</span>
                  <span style={{ marginLeft: 'auto' }}>
                    {setupStatus.cuda ? setupStatus.deviceName || 'CUDA' : 'CPU only'}
                  </span>
                </div>
              )}

              {!setupChecking && setupStatus?.ready && !setupStatus.cuda && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Cpu size={11} />
                  <span>No CUDA device — CPU fallback is much slower.</span>
                </div>
              )}

              {!setupChecking && !setupStatus?.ready && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertCircle size={11} />
                    <span>Qwen3-ASR needs a Python environment with PyTorch.</span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '4px 6px',
                      borderRadius: 3,
                      background: 'rgba(0, 0, 0, 0.35)',
                      fontSize: 9.5,
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      color: '#e2e8f0',
                    }}
                  >
                    {PIP_COMMANDS}
                  </pre>
                  <span>
                    Then set the interpreter in Settings → Speech Recognition.
                  </span>
                  {setupStatus?.error && (
                    <span style={{ color: '#fca5a5', whiteSpace: 'pre-wrap' }}>{setupStatus.error}</span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Progress (chunk-based for Qwen3-ASR) */}
          {isGenerating && generationProgress && (
            <div style={{ fontSize: 10, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Loader2 size={11} className="animate-spin" />
              <span>{progressLabel(generationProgress)}</span>
              {isQwen && (
                <button
                  type="button"
                  className="unity-btn unity-btn-secondary btn-xs"
                  style={{ fontSize: 9, padding: '1px 5px', marginLeft: 'auto' }}
                  onClick={() => cancelQwenAsr()}
                >
                  <XCircle size={9} />
                  <span>Cancel</span>
                </button>
              )}
            </div>
          )}

          {isQwen && generationProgress?.cpuFallback && (
            <div style={{ fontSize: 10, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Cpu size={11} />
              <span>CUDA unavailable — transcribing on CPU (slower).</span>
            </div>
          )}

          {isQwen && wordTimingsUnavailable && (
            <div style={{ fontSize: 10, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle size={11} />
              <span>Aligner unavailable — these subtitles have phrase timing only.</span>
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                fontSize: 10,
                color: '#ef4444',
                background: 'rgba(239, 68, 68, 0.1)',
                padding: '6px 8px',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 4,
                whiteSpace: 'pre-wrap',
              }}
            >
              <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{errorMessage}</span>
            </div>
          )}

          {isQwen && (
            <span style={{ fontSize: 9, color: 'var(--unity-text-dim)' }}>
              Model: {QWEN3_ASR_MODEL_REPO} · Apache-2.0 · text only (no punctuation)
            </span>
          )}

          {/* Action button */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="unity-btn unity-btn-primary btn-xs"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={!modelInstalled || isGenerating || !qwenReady}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={11} className="animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={11} />
                  <span>Generate</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
