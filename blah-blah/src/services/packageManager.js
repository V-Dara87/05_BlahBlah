import { isTauri, joinPath, ensureDir, removeFileIfExists } from './tauriFsAdapter.js';
import builtInManifest from '../data/packageManifest.json' with { type: 'json' };

const CUSTOM_PACKAGES_KEY = 'blahblah-custom-packages-v1';
const INSTALLED_PACKAGES_KEY = 'blahblah-installed-packages-v1';

let cachedAppDataDir = null;
const activeDownloadSessions = new Map();

/**
 * Returns the application data directory path (in Tauri).
 * @returns {Promise<string|null>}
 */
export async function getAppDataDirectory() {
  if (!isTauri()) return null;
  if (cachedAppDataDir) return cachedAppDataDir;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    cachedAppDataDir = await invoke('get_app_data_dir');
    return cachedAppDataDir;
  } catch (err) {
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      cachedAppDataDir = await appDataDir();
      return cachedAppDataDir;
    } catch {
      console.warn('[packageManager] Could not determine appDataDir:', err);
      return null;
    }
  }
}

/**
 * Reads custom packages defined by the user.
 * @returns {Promise<Array>}
 */
export async function getCustomPackages() {
  try {
    const raw = localStorage.getItem(CUSTOM_PACKAGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Saves custom packages defined by the user.
 * @param {Array} packages
 */
export async function saveCustomPackages(packages) {
  try {
    localStorage.setItem(CUSTOM_PACKAGES_KEY, JSON.stringify(packages || []));
  } catch (err) {
    console.warn('[packageManager] Failed to save custom packages:', err);
  }
}

/**
 * Reads installed packages registry.
 * @returns {Promise<Record<string, object>>} Map of packageId -> metadata
 */
export async function getInstalledPackagesRegistry() {
  if (isTauri()) {
    try {
      const appDir = await getAppDataDirectory();
      if (appDir) {
        const fs = await import('@tauri-apps/plugin-fs');
        const regPath = joinPath(appDir, 'installedPackages.json');
        if (await fs.exists(regPath)) {
          const content = await fs.readTextFile(regPath);
          return JSON.parse(content || '{}');
        }
      }
    } catch (err) {
      console.warn('[packageManager] Error reading installedPackages.json, falling back to localStorage:', err);
    }
  }

  try {
    const raw = localStorage.getItem(INSTALLED_PACKAGES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Saves installed packages registry.
 * @param {Record<string, object>} registry
 */
export async function saveInstalledPackagesRegistry(registry) {
  const data = registry || {};
  if (isTauri()) {
    try {
      const appDir = await getAppDataDirectory();
      if (appDir) {
        const fs = await import('@tauri-apps/plugin-fs');
        await ensureDir(appDir);
        const regPath = joinPath(appDir, 'installedPackages.json');
        await fs.writeTextFile(regPath, JSON.stringify(data, null, 2));
      }
    } catch (err) {
      console.warn('[packageManager] Error writing installedPackages.json to disk:', err);
    }
  }

  try {
    localStorage.setItem(INSTALLED_PACKAGES_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('[packageManager] Failed to save installed registry to localStorage:', err);
  }
}

/**
 * Loads the merged manifest (built-in + custom).
 * @returns {Promise<Array>} List of package objects
 */
export async function loadManifest() {
  const custom = await getCustomPackages();
  const builtIn = builtInManifest?.packages || [];
  return [...builtIn, ...custom];
}

/**
 * Lists available packages with optional filtering.
 * @param {object} [filters]
 * @param {string} [filters.category]
 * @param {string} [filters.tag]
 * @returns {Promise<Array>}
 */
export async function listPackages({ category, tag } = {}) {
  const all = await loadManifest();
  return all.filter((pkg) => {
    if (category && pkg.category !== category) return false;
    if (tag && !(pkg.tags && pkg.tags.includes(tag))) return false;
    return true;
  });
}

/**
 * Lists all currently installed packages.
 * @param {object} [filters]
 * @param {string} [filters.category]
 * @returns {Promise<Array>}
 */
export async function listInstalledPackages({ category } = {}) {
  const [manifest, registry] = await Promise.all([loadManifest(), getInstalledPackagesRegistry()]);
  return manifest.filter((pkg) => {
    const isInstalled = Boolean(registry[pkg.id]);
    if (!isInstalled) return false;
    if (category && pkg.category !== category) return false;
    return true;
  });
}

/**
 * Checks if a specific package is installed.
 * @param {string} packageId
 * @returns {Promise<boolean>}
 */
export async function isPackageInstalled(packageId) {
  const registry = await getInstalledPackagesRegistry();
  return Boolean(registry[packageId]);
}

/**
 * Gets the total storage size in bytes consumed by installed packages.
 * @returns {Promise<number>}
 */
export async function getTotalInstalledSize() {
  const registry = await getInstalledPackagesRegistry();
  return Object.values(registry).reduce((sum, item) => sum + (Number(item?.sizeBytes) || 0), 0);
}

/**
 * Gets the absolute path of an installed package on disk.
 * Returns null if not installed or running in browser.
 * @param {string} packageId
 * @returns {Promise<string|null>}
 */
export async function getPackagePath(packageId) {
  const registry = await getInstalledPackagesRegistry();
  const info = registry[packageId];
  if (!info || !info.installPath) return null;

  if (isTauri()) {
    const appDir = await getAppDataDirectory();
    if (appDir && !info.installPath.includes(':') && !info.installPath.startsWith('/')) {
      return joinPath(appDir, info.installPath);
    }
  }
  return info.installPath;
}

/**
 * Cancels an ongoing package download session.
 * @param {string} packageId
 * @returns {Promise<boolean>}
 */
export async function cancelDownload(packageId) {
  const sessionId = activeDownloadSessions.get(packageId);
  if (!sessionId) return false;

  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cancel_download', { sessionId });
      activeDownloadSessions.delete(packageId);
      return true;
    } catch (err) {
      console.warn('[packageManager] Failed to cancel download:', err);
    }
  }
  activeDownloadSessions.delete(packageId);
  return true;
}

/**
 * Opens the application models storage directory in the OS file explorer.
 * @returns {Promise<boolean>}
 */
export async function openModelsDirectory() {
  if (!isTauri()) return false;
  const appDir = await getAppDataDirectory();
  if (!appDir) return false;
  const modelsDir = joinPath(appDir, 'models');
  await ensureDir(modelsDir);

  try {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(modelsDir);
    return true;
  } catch (err) {
    console.warn('[packageManager] Failed to open models directory:', err);
    return false;
  }
}

/**
 * Reveals an installed package file in the OS file explorer.
 * @param {string} packageId
 * @returns {Promise<boolean>}
 */
export async function revealPackageInExplorer(packageId) {
  if (!isTauri()) return false;
  const fullPath = await getPackagePath(packageId);
  if (!fullPath || fullPath.startsWith('indexeddb:') || fullPath.startsWith('sharedLibrary:')) {
    return false;
  }

  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(fullPath);
    return true;
  } catch (err) {
    console.warn('[packageManager] Failed to reveal package in explorer:', err);
    return false;
  }
}

/**
 * Imports a local model file directly from disk into the package registry.
 * Eliminates the need to re-download multi-gigabyte models if already present.
 *
 * @param {object} params
 * @param {string} params.filePath - Absolute path to local .bin file
 * @param {string} [params.displayName]
 * @param {string} [params.category='custom-model']
 * @param {string[]} [params.tags=['custom', 'local']]
 * @param {string} [params.description]
 * @returns {Promise<object>}
 */
export async function importLocalModelFile({
  filePath,
  displayName,
  category = 'custom-model',
  tags = ['custom', 'local'],
  description = 'Local imported model',
}) {
  if (!filePath) {
    throw new Error('Local file path is required.');
  }

  const fileName = filePath.split(/[/\\]/).pop() || 'model.bin';
  const name = displayName?.trim() || fileName.replace(/\.bin$/i, '');
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let sizeBytes = 0;
  if (isTauri()) {
    try {
      const fs = await import('@tauri-apps/plugin-fs');
      const stat = await fs.stat(filePath);
      sizeBytes = stat.size || 0;
    } catch {
      // ignore
    }
  }

  const custom = await getCustomPackages();
  const newPkg = {
    id,
    displayName: name,
    category,
    version: '1.0.0',
    installPath: filePath,
    tags: Array.isArray(tags) ? tags : [String(tags)],
    description,
    attribution: 'Local Disk Import',
    sizeBytes,
    isCustom: true,
    isLocalImport: true,
  };
  custom.push(newPkg);
  await saveCustomPackages(custom);

  const registry = await getInstalledPackagesRegistry();
  registry[id] = {
    id,
    displayName: name,
    category,
    version: '1.0.0',
    installPath: filePath,
    sizeBytes,
    installedAt: Date.now(),
    attribution: 'Local Disk Import',
    isLocalImport: true,
  };
  await saveInstalledPackagesRegistry(registry);

  return newPkg;
}

/**
 * Directly installs a preset component into the active project scripts folder.
 * @param {string} packageId
 * @param {Function} onCreateScript - (name: string, code: string, type: string) => Promise<any>
 * @returns {Promise<string>} Created script name
 */
export async function installPresetToProject(packageId, onCreateScript) {
  const manifest = await loadManifest();
  const pkg = manifest.find((p) => p.id === packageId);
  if (!pkg) throw new Error(`Package ${packageId} not found in manifest.`);
  if (!pkg.sampleCode) throw new Error('Package does not contain preset script code.');

  const componentName = pkg.componentName || `${pkg.displayName.replace(/\s+/g, '')}.jsx`;
  const cleanName = componentName.replace(/\.jsx$/, '');

  if (typeof onCreateScript === 'function') {
    await onCreateScript(cleanName, pkg.sampleCode, 'canvas');
    return cleanName;
  }
  return cleanName;
}

/**
 * Downloads and installs a package.
 * Supports:
 * - 'whisper-model' / 'whisper-model-official' / 'whisper-model-khmer' -> Tauri streaming download to app data dir
 * - 'script-library' / 'npm-library' -> esm.sh fetch & IndexedDB moduleCache pre-cache
 * - 'component-pack' -> Shared Library import for cross-project reuse
 *
 * @param {string} packageId
 * @param {object} [options]
 * @param {(progress: { bytesDownloaded: number, totalBytes?: number, percent?: number }) => void} [options.onProgress]
 * @returns {Promise<{ id: string, installPath?: string, sizeBytes: number }>}
 */
export async function downloadPackage(packageId, { onProgress } = {}) {
  const manifest = await loadManifest();
  const pkg = manifest.find((p) => p.id === packageId);
  if (!pkg) {
    throw new Error(`Package not found in manifest: ${packageId}`);
  }

  // Case 1: npm-library (Pre-cache in IndexedDB moduleCache via packageResolver)
  if (pkg.category === 'script-library' || pkg.packageType === 'npm-library') {
    onProgress?.({ bytesDownloaded: 0, totalBytes: pkg.sizeBytes, percent: 10 });
    const { resolvePackageImport } = await import('../engine/packageResolver.js');
    const specifier = pkg.packageName || pkg.id.replace(/^npm-/, '');
    onProgress?.({ bytesDownloaded: Math.floor(pkg.sizeBytes * 0.4), totalBytes: pkg.sizeBytes, percent: 50 });
    const resolved = await resolvePackageImport(specifier);
    onProgress?.({ bytesDownloaded: pkg.sizeBytes, totalBytes: pkg.sizeBytes, percent: 100 });

    const registry = await getInstalledPackagesRegistry();
    registry[pkg.id] = {
      id: pkg.id,
      displayName: pkg.displayName,
      category: pkg.category,
      version: resolved.version || pkg.version || '1.0.0',
      installPath: `indexeddb:moduleCache/${resolved.key}`,
      sizeBytes: pkg.sizeBytes,
      installedAt: Date.now(),
      packageName: specifier,
    };
    await saveInstalledPackagesRegistry(registry);
    return { id: pkg.id, sizeBytes: pkg.sizeBytes };
  }

  // Case 2: component-pack (Preset script added to Shared Library)
  if (pkg.category === 'component-pack' || pkg.packageType === 'component-pack') {
    onProgress?.({ bytesDownloaded: 0, totalBytes: pkg.sizeBytes, percent: 20 });
    const { addSharedItem, makeSharedScriptItem } = await import('./sharedLibraryStorage.js');
    const componentName = pkg.componentName || `${pkg.displayName.replace(/\s+/g, '')}.jsx`;
    const cleanName = componentName.replace(/\.jsx$/, '');

    await addSharedItem({
      ...makeSharedScriptItem({
        name: cleanName,
        code: pkg.sampleCode || '',
        description: pkg.description || 'Pre-installed component preset',
      }),
      folder: 'Presets',
    });
    onProgress?.({ bytesDownloaded: pkg.sizeBytes, totalBytes: pkg.sizeBytes, percent: 100 });

    const registry = await getInstalledPackagesRegistry();
    registry[pkg.id] = {
      id: pkg.id,
      displayName: pkg.displayName,
      category: pkg.category,
      version: pkg.version || '1.0.0',
      installPath: `sharedLibrary:scripts/${componentName}`,
      sizeBytes: pkg.sizeBytes,
      installedAt: Date.now(),
      componentName,
    };
    await saveInstalledPackagesRegistry(registry);
    return { id: pkg.id, sizeBytes: pkg.sizeBytes };
  }

  // Case 3: Whisper model or binary asset -> Tauri native download
  if (!isTauri()) {
    throw new Error('Native model downloading is only supported in the Tauri desktop app.');
  }

  const appDir = await getAppDataDirectory();
  if (!appDir) {
    throw new Error('Failed to resolve application directory.');
  }

  const targetRelPath = pkg.installPath || `models/${pkg.id}.bin`;
  const fullDestPath = joinPath(appDir, targetRelPath);

  const sessionId = `pkg-dl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  activeDownloadSessions.set(pkg.id, sessionId);
  let unlisten = null;

  try {
    if (typeof onProgress === 'function') {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('package-download-progress', (event) => {
        const payload = event?.payload;
        if (payload && payload.session_id === sessionId) {
          try {
            onProgress({
              bytesDownloaded: payload.bytes_downloaded,
              totalBytes: payload.total_bytes,
              percent: payload.percent,
            });
          } catch (cbErr) {
            console.error('[packageManager] Error in onProgress callback:', cbErr);
          }
        }
      });
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const downloadedBytes = await invoke('download_package', {
      url: pkg.url,
      destPath: fullDestPath,
      sessionId,
    });

    // Verify SHA-256 if specified
    if (pkg.sha256) {
      const isMatch = await invoke('verify_sha256', {
        filePath: fullDestPath,
        expectedHash: pkg.sha256,
      });

      if (!isMatch) {
        await removeFileIfExists(fullDestPath);
        throw new Error(
          `SHA-256 verification failed for package ${pkg.id}. The downloaded file was corrupted or tampered with and has been removed.`
        );
      }
    }

    // Update installed registry
    const registry = await getInstalledPackagesRegistry();
    registry[pkg.id] = {
      id: pkg.id,
      displayName: pkg.displayName,
      category: pkg.category,
      version: pkg.version || '1.0.0',
      installPath: targetRelPath,
      sizeBytes: downloadedBytes || pkg.sizeBytes,
      installedAt: Date.now(),
      sha256: pkg.sha256 || null,
    };
    await saveInstalledPackagesRegistry(registry);

    return {
      id: pkg.id,
      installPath: fullDestPath,
      sizeBytes: downloadedBytes || pkg.sizeBytes,
    };
  } finally {
    activeDownloadSessions.delete(pkg.id);
    if (unlisten) {
      try {
        unlisten();
      } catch (err) {
        console.warn('[packageManager] Failed to unlisten download progress:', err);
      }
    }
  }
}

/**
 * Deletes an installed package and removes it from the registry.
 * @param {string} packageId
 * @returns {Promise<boolean>}
 */
export async function deletePackage(packageId) {
  const registry = await getInstalledPackagesRegistry();
  const info = registry[packageId];
  if (!info) return false;

  // Case 1: component-pack in shared library
  if (info.category === 'component-pack' && info.componentName) {
    try {
      const { listSharedItems, removeSharedItem } = await import('./sharedLibraryStorage.js');
      const cleanName = info.componentName.replace(/\.jsx$/, '');
      const items = await listSharedItems();
      const match = items.find((it) => it.type === 'script' && it.name === cleanName);
      if (match) {
        await removeSharedItem(match.id);
      }
    } catch (err) {
      console.warn('[packageManager] Failed to remove item from shared library:', err);
    }
  }

  // Case 2: On-disk file removal (Tauri) - only delete if not a local import outside app data
  if (isTauri() && info.installPath && !info.installPath.startsWith('indexeddb:') && !info.installPath.startsWith('sharedLibrary:') && !info.isLocalImport) {
    const appDir = await getAppDataDirectory();
    const fullPath = appDir ? joinPath(appDir, info.installPath) : info.installPath;
    await removeFileIfExists(fullPath);
  }

  delete registry[packageId];
  await saveInstalledPackagesRegistry(registry);
  return true;
}

/**
 * Adds a user-defined custom package.
 * @param {object} params
 * @param {string} params.url
 * @param {string} params.displayName
 * @param {string} [params.category]
 * @param {string[]} [params.tags]
 * @param {string} [params.description]
 * @param {string} [params.attribution]
 * @param {string} [params.sha256]
 * @returns {Promise<object>} The added package
 */
export async function addCustomPackage({
  url,
  displayName,
  category = 'custom-model',
  tags = ['custom'],
  description = 'User-provided custom model',
  attribution = 'Custom',
  sha256 = null,
}) {
  if (!url || !displayName) {
    throw new Error('URL and Display Name are required for custom package.');
  }

  const customPackages = await getCustomPackages();
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const fileName = url.split('/').pop().split('?')[0] || `${id}.bin`;

  const newPkg = {
    id,
    displayName,
    category,
    version: '1.0.0',
    url,
    installPath: `models/custom/${fileName}`,
    tags: Array.isArray(tags) ? tags : [String(tags)],
    description,
    attribution,
    sha256: sha256 || null,
    isCustom: true,
  };

  customPackages.push(newPkg);
  await saveCustomPackages(customPackages);
  return newPkg;
}

/**
 * Removes a custom package definition and deletes its installed files if present.
 * @param {string} packageId
 */
export async function removeCustomPackage(packageId) {
  await deletePackage(packageId);
  const custom = await getCustomPackages();
  const filtered = custom.filter((p) => p.id !== packageId);
  await saveCustomPackages(filtered);
}