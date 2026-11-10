/**
 * Capability gate for the experimental VST3 feature. The mixer and settings
 * call this before building any scan/process command, so a browser preview,
 * a non-Windows build, or a missing sidecar simply shows a reason instead of
 * throwing IPC errors.
 */

import { getVstHostInfo, isVstHostRuntime } from './vstHostRunner';

export const VST_PROTOCOL_VERSION = 1;

export async function inspectVstSupport({ enabled = true } = {}) {
  if (!enabled) {
    return { supported: false, reason: 'disabled', info: null };
  }
  if (!isVstHostRuntime()) {
    return { supported: false, reason: 'desktop-only', info: null };
  }

  try {
    const info = await getVstHostInfo();
    if (Number(info.protocolVersion) !== VST_PROTOCOL_VERSION) {
      return {
        supported: false,
        reason: 'protocol',
        info,
        message: `VST host protocol ${info.protocolVersion} is not supported (expected ${VST_PROTOCOL_VERSION}).`,
      };
    }
    if (info.platform && info.platform !== 'windows') {
      return {
        supported: false,
        reason: 'os',
        info,
        message: 'VST3 hosting is currently Windows-only.',
      };
    }
    return { supported: true, reason: 'ready', info };
  } catch (error) {
    return {
      supported: false,
      reason: 'missing-sidecar',
      info: null,
      message: error?.message || 'The VST host sidecar is not available.',
    };
  }
}

export function describeVstSupport(result) {
  switch (result?.reason) {
    case 'disabled':
      return 'Enable experimental VST3 inserts to use plugins.';
    case 'desktop-only':
      return 'VST3 inserts require the desktop app. They are unavailable in a browser preview.';
    case 'protocol':
      return result.message;
    case 'os':
      return result.message;
    case 'missing-sidecar':
      return `VST host unavailable: ${result.message}`;
    case 'ready':
      return `VST host ready · ${result.info?.backend || 'truce-rack'} ${result.info?.backendVersion || ''}`.trim();
    default:
      return 'VST host status unknown.';
  }
}
