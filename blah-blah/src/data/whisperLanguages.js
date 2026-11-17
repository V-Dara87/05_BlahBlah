export const WHISPER_LANGUAGES = [
  { code: 'en', label: 'English', recommendedModelTags: ['en', 'multilingual'] },
  { code: 'ja', label: 'Japanese', recommendedModelTags: ['ja', 'multilingual'] },
  {
    code: 'km',
    label: 'Khmer',
    recommendedModelTags: ['km'],
    // Primary category, kept for getRecommendedPackageFilterForLanguage and the
    // Package Manager's Khmer filter.
    modelCategory: 'whisper-model-khmer',
    // Every category the auto-subtitle model list merges, in display order:
    // Qwen3-ASR is the recommended Khmer engine (Whisper is very inaccurate
    // for Khmer), the Whisper Khmer fine-tune stays available as a fallback.
    modelCategories: ['asr-model-khmer', 'whisper-model-khmer'],
  },
  { code: 'auto', label: 'Auto Detect', recommendedModelTags: ['multilingual'] },
  { code: 'zh', label: 'Chinese', recommendedModelTags: ['multilingual'] },
  { code: 'es', label: 'Spanish', recommendedModelTags: ['multilingual'] },
  { code: 'fr', label: 'French', recommendedModelTags: ['multilingual'] },
  { code: 'de', label: 'German', recommendedModelTags: ['multilingual'] },
  { code: 'ko', label: 'Korean', recommendedModelTags: ['multilingual'] },
];

/**
 * Languages the Qwen3-ASR Khmer engine can transcribe. seanghay's fine-tune is
 * Khmer-only (fine-tuned from Qwen/Qwen3-ASR-0.6B on ~700h of Khmer speech),
 * so English is deliberately NOT offered for it: the multilingual base model
 * would have to be a separate catalog entry.
 */
export const QWEN3_ASR_SUPPORTED_LANGUAGES = ['km'];

/**
 * Returns the recommended package ID or category for a given language code.
 */
export function getRecommendedPackageFilterForLanguage(langCode) {
  const match = WHISPER_LANGUAGES.find((l) => l.code === langCode);
  if (!match) return { tag: 'multilingual' };
  if (match.modelCategory) {
    return { category: match.modelCategory, tag: match.code };
  }
  return { tag: match.code };
}
