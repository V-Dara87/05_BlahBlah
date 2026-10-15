import { useState, useRef, useEffect } from 'react';
import { Sparkles, Loader2, DownloadCloud, Check, ChevronDown, AlertCircle } from 'lucide-react';
import { WHISPER_LANGUAGES } from '../../data/whisperLanguages.js';
import { generateSubtitlesFromEntity } from '../../engine/subtitleAutoGenerate.js';
import {
  isPackageInstalled,
  listInstalledPackages,
  listPackages,
} from '../../services/packageManager.js';
import { addPhrase } from '../../engine/subtitleTrack.js';

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

  const containerRef = useRef(null);

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

  // Load models matching the chosen language
  useEffect(() => {
    async function checkModels() {
      const langConfig = WHISPER_LANGUAGES.find((l) => l.code === selectedLanguage);
      const category = langConfig?.modelCategory || 'whisper-model-official';

      const [allForCat, installed] = await Promise.all([
        listPackages({ category }),
        listInstalledPackages(),
      ]);

      setAvailableModels(allForCat);

      // Pick default model
      let defaultId = selectedModelId;
      if (langConfig?.modelCategory) {
        // e.g. Khmer model
        const firstCat = allForCat[0]?.id;
        if (firstCat) defaultId = firstCat;
      } else if (!allForCat.some((m) => m.id === defaultId)) {
        defaultId = allForCat[0]?.id || 'whisper-small';
      }

      setSelectedModelId(defaultId);
      const isInst = await isPackageInstalled(defaultId);
      setModelInstalled(isInst);
    }

    checkModels();
  }, [selectedLanguage, isOpen]);

  // When model selection changes, check if installed
  const handleModelChange = async (modelId) => {
    setSelectedModelId(modelId);
    const isInst = await isPackageInstalled(modelId);
    setModelInstalled(isInst);
  };

  const handleGenerate = async () => {
    setErrorMessage(null);
    setIsGenerating(true);
    setGenerationProgress({ phase: 'extracting', percent: 0 });

    try {
      const generatedPhrases = await generateSubtitlesFromEntity({
        entity: selectedEntity,
        mediaAssets,
        language: selectedLanguage,
        modelId: selectedModelId,
        onProgress: (p) => {
          setGenerationProgress(p);
        },
      });

      if (!generatedPhrases || generatedPhrases.length === 0) {
        throw new Error('Whisper produced no transcript segments for this clip.');
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

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="unity-btn unity-btn-secondary btn-xs"
        disabled={isGenerating}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Auto-generate subtitles using local Whisper AI model"
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
        <span>
          {isGenerating
            ? generationProgress?.phase === 'transcribing'
              ? `Transcribing ${generationProgress?.percent ? generationProgress.percent + '%' : '...'}`
              : 'Extracting audio...'
            : 'Auto-generate'}
        </span>
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
            width: 250,
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
            <span>Generate Subtitles with Whisper</span>
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
              {WHISPER_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label} ({lang.code})
                </option>
              ))}
            </select>
          </div>

          {/* Model Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 9, color: 'var(--unity-text-dim)', textTransform: 'uppercase', fontWeight: 600 }}>
              Whisper Model
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
          </div>

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
                <span>Model not installed</span>
              </div>
              <button
                type="button"
                className="unity-btn unity-btn-secondary btn-xs"
                style={{ fontSize: 10, padding: '2px 6px' }}
                onClick={() => {
                  setIsOpen(false);
                  const langConfig = WHISPER_LANGUAGES.find((l) => l.code === selectedLanguage);
                  onOpenPackageManager?.(langConfig?.modelCategory || 'whisper-model-official');
                }}
              >
                Open Package Manager to Install
              </button>
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
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AlertCircle size={12} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action button */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="unity-btn unity-btn-primary btn-xs"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={!modelInstalled || isGenerating}
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
