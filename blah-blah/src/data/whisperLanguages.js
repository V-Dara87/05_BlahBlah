export const WHISPER_LANGUAGES = [
  { code: 'en', label: 'English', recommendedModelTags: ['en', 'multilingual'] },
  { code: 'ja', label: 'Japanese', recommendedModelTags: ['ja', 'multilingual'] },
  { code: 'km', label: 'Khmer', recommendedModelTags: ['km'], modelCategory: 'whisper-model-khmer' },
  { code: 'auto', label: 'Auto Detect', recommendedModelTags: ['multilingual'] },
  { code: 'zh', label: 'Chinese', recommendedModelTags: ['multilingual'] },
  { code: 'es', label: 'Spanish', recommendedModelTags: ['multilingual'] },
  { code: 'fr', label: 'French', recommendedModelTags: ['multilingual'] },
  { code: 'de', label: 'German', recommendedModelTags: ['multilingual'] },
  { code: 'ko', label: 'Korean', recommendedModelTags: ['multilingual'] },
];

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
