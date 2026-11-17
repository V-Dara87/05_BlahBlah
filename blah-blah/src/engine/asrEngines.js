/**
 * Speech-recognition engine selection.
 *
 * Model packages declare which runner backs them:
 *
 *   engine: 'whisper-cpp'  (default, every existing package) -> whisper-cli
 *   engine: 'qwen3-asr'                                      -> the Python helper
 *
 * Anything without an `engine` field is Whisper, so the existing catalog keeps
 * working unchanged and old custom packages need no migration. Keeping this in
 * one pure module means the UI, the generator, and the tests all agree on what
 * "which engine is this model" means.
 */

import { WHISPER_LANGUAGES, QWEN3_ASR_SUPPORTED_LANGUAGES } from '../data/whisperLanguages.js';
import { listPackages } from '../services/packageManager.js';

/**
 * Optional companion package for the Qwen3-ASR engine: the forced aligner that
 * turns a chunk transcript into word-level timings. It is a model package of
 * its own (category 'asr-aligner'), deliberately NOT part of the transcription
 * model list, and only used when it is installed and word timings are wanted.
 */
export const QWEN3_ALIGNER_PACKAGE_ID = 'qwen3-aligner-0.6b';

export const ASR_ENGINE_WHISPER = 'whisper-cpp';
export const ASR_ENGINE_QWEN3 = 'qwen3-asr';
export const DEFAULT_ASR_ENGINE = ASR_ENGINE_WHISPER;

export const ASR_ENGINE_LABELS = Object.freeze({
  [ASR_ENGINE_WHISPER]: 'Whisper',
  [ASR_ENGINE_QWEN3]: 'Qwen3-ASR',
});

export { QWEN3_ASR_SUPPORTED_LANGUAGES };

/** Engine that will run a model package (defaults to whisper-cpp). */
export function getModelEngine(modelPackage) {
  const engine = modelPackage?.engine;
  return engine === ASR_ENGINE_QWEN3 || engine === ASR_ENGINE_WHISPER ? engine : DEFAULT_ASR_ENGINE;
}

/** Human-readable engine name for progress/error copy. */
export function getEngineLabel(engine) {
  return ASR_ENGINE_LABELS[engine] || ASR_ENGINE_LABELS[DEFAULT_ASR_ENGINE];
}

/** True when a package is backed by the Qwen3-ASR Python engine. */
export function isQwen3AsrPackage(modelPackage) {
  return getModelEngine(modelPackage) === ASR_ENGINE_QWEN3;
}

/** True when an engine can transcribe a language code. Whisper covers all. */
export function isLanguageSupportedByEngine(engine, languageCode) {
  if (getModelEngine({ engine }) === ASR_ENGINE_QWEN3) {
    return QWEN3_ASR_SUPPORTED_LANGUAGES.includes(languageCode);
  }
  return true;
}

/**
 * Package categories to list for a language, in display order. The Khmer entry
 * lists Qwen3-ASR first so it is the recommended default, then the Whisper
 * Khmer model. Other languages keep the existing official Whisper category.
 */
export function modelCategoriesForLanguage(languageCode) {
  const config = WHISPER_LANGUAGES.find((language) => language.code === languageCode);
  if (!config) return ['whisper-model-official'];
  if (Array.isArray(config.modelCategories) && config.modelCategories.length > 0) {
    return config.modelCategories;
  }
  if (config.modelCategory) return [config.modelCategory];
  return ['whisper-model-official'];
}

/**
 * Every model package offered for a language, in manifest order per category.
 * @param {string} languageCode
 * @returns {Promise<Array<object>>}
 */
export async function listAsrModelsForLanguage(languageCode) {
  const seen = new Set();
  const models = [];
  for (const category of modelCategoriesForLanguage(languageCode)) {
    for (const model of await listPackages({ category })) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  return models;
}
