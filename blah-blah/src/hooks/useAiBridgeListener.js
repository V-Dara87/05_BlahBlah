/**
 * useAiBridgeListener Hook.
 *
 * Runs inside the BlahBlah editor composition shell (App.jsx).
 * Connects the live editor state and playback controller to external AI agents
 * (MCP / CLI) via the .aibridge file IPC.
 */

import { useEffect, useRef } from 'react';
import { isTauri, joinPath } from '../services/tauriFsAdapter';
import {
  verifyBridgeToken,
  isCommandStale,
  findEntityForSelect,
} from '../utils/aiBridgeCore';
import {
  getBridgePaths,
  ensureBridgeDirectories,
  readOrGenerateBridgeToken,
  cleanupStaleInboxCommands,
  writeBridgeResult,
  writeBridgeFramePng,
  renderEditorFrame,
} from '../services/aiBridgeService';

export function useAiBridgeListener({
  projectFolderHandle,
  playbackStoreRef,
  setSelectedEntityId,
  entities = [],
  tracks = [],
  scripts = [],
  resolution,
  mediaAssets = [],
}) {
  const latestStateRef = useRef({ entities, tracks, scripts, resolution, mediaAssets });
  useEffect(() => {
    latestStateRef.current = { entities, tracks, scripts, resolution, mediaAssets };
  }, [entities, tracks, scripts, resolution, mediaAssets]);

  const tokenRef = useRef(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!isTauri() || !projectFolderHandle?.path) {
      return;
    }

    const projectDir = projectFolderHandle.path;
    let cancelled = false;

    // 1. Initial setup: directories, token, stale cleanup
    (async () => {
      try {
        await ensureBridgeDirectories(projectDir);
        if (cancelled) return;
        tokenRef.current = await readOrGenerateBridgeToken(projectDir);
        if (cancelled) return;
        await cleanupStaleInboxCommands(projectDir);
      } catch (err) {
        console.warn('AI Bridge initialization error:', err);
      }
    })();

    // 2. File polling loop
    const pollInterval = setInterval(async () => {
      if (isProcessingRef.current || cancelled) return;

      const fs = await import('@tauri-apps/plugin-fs').catch(() => null);
      if (!fs) return;

      const paths = getBridgePaths(projectDir);
      if (!paths) return;

      try {
        if (!(await fs.exists(paths.inbox))) return;
        const entries = await fs.readDir(paths.inbox);
        const jsonFiles = entries
          .filter((e) => e.isFile && e.name.endsWith('.json'))
          .map((e) => e.name)
          .sort(); // Sorts chronologically due to timestamp prefix: 00017...-<id>.json

        if (jsonFiles.length === 0) return;

        isProcessingRef.current = true;
        const targetFileName = jsonFiles[0];
        const filePath = joinPath(paths.inbox, targetFileName);

        let cmd = null;
        try {
          const raw = await fs.readTextFile(filePath);
          cmd = JSON.parse(raw);
        } catch {
          // Bad JSON or partial file: remove and continue
          await fs.remove(filePath).catch(() => {});
          isProcessingRef.current = false;
          return;
        }

        // Always delete inbox file so command runs exactly once
        await fs.remove(filePath).catch(() => {});

        if (!cmd || !cmd.id || !cmd.type) {
          isProcessingRef.current = false;
          return;
        }

        // Stale command check (>5 min)
        if (isCommandStale(cmd.timestamp)) {
          console.warn(`AI Bridge: ignored stale command ${cmd.id} (${cmd.type})`);
          isProcessingRef.current = false;
          return;
        }

        // Bearer token verification
        if (!verifyBridgeToken(cmd.token, tokenRef.current)) {
          console.warn(`AI Bridge: unauthorized command ${cmd.id} rejected`);
          await writeBridgeResult(projectDir, cmd.id, {
            ok: false,
            error: 'Unauthorized: missing or invalid bridge token.',
          });
          isProcessingRef.current = false;
          return;
        }

        // Command Dispatch
        try {
          switch (cmd.type) {
            case 'seek': {
              const rawTime = cmd.arg && typeof cmd.arg === 'object' ? cmd.arg.time : cmd.arg;
              const targetTime = Number(rawTime ?? 0);
              playbackStoreRef.current?.seek(targetTime);
              await writeBridgeResult(projectDir, cmd.id, {
                ok: true,
                command: 'seek',
                time: targetTime,
              });
              break;
            }

            case 'play': {
              playbackStoreRef.current?.play();
              await writeBridgeResult(projectDir, cmd.id, {
                ok: true,
                command: 'play',
              });
              break;
            }

            case 'pause': {
              playbackStoreRef.current?.pause();
              await writeBridgeResult(projectDir, cmd.id, {
                ok: true,
                command: 'pause',
              });
              break;
            }

            case 'select': {
              const target = cmd.arg && typeof cmd.arg === 'object'
                ? (cmd.arg.id || cmd.arg.name)
                : cmd.arg;
              const match = findEntityForSelect(latestStateRef.current.entities, target);
              if (match) {
                setSelectedEntityId(match.id);
                await writeBridgeResult(projectDir, cmd.id, {
                  ok: true,
                  command: 'select',
                  entityId: match.id,
                  name: match.name,
                });
              } else {
                await writeBridgeResult(projectDir, cmd.id, {
                  ok: false,
                  command: 'select',
                  error: `Entity not found: "${target}".`,
                });
              }
              break;
            }

            case 'reload': {
              window.dispatchEvent(new CustomEvent('blahblah:scripts-recompiled'));
              await writeBridgeResult(projectDir, cmd.id, {
                ok: true,
                command: 'reload',
              });
              break;
            }

            case 'render_frame': {
              const rawTime = cmd.arg && typeof cmd.arg === 'object' ? cmd.arg.time : cmd.arg;
              const targetTime = Number(rawTime ?? 0);

              // Seek preview playhead for synchronized visual feedback
              try {
                playbackStoreRef.current?.seek(targetTime);
              } catch {}

              const renderRes = await renderEditorFrame({
                time: targetTime,
                entities: latestStateRef.current.entities,
                tracks: latestStateRef.current.tracks,
                scripts: latestStateRef.current.scripts,
                resolution: latestStateRef.current.resolution,
                mediaAssets: latestStateRef.current.mediaAssets,
              });

              await writeBridgeFramePng(projectDir, cmd.id, renderRes.pngBase64);
              await writeBridgeResult(projectDir, cmd.id, {
                ok: true,
                command: 'render_frame',
                fidelity: 'editor',
                format: 'png',
                file: `outbox/${cmd.id}.png`,
                width: renderRes.width,
                height: renderRes.height,
                pngBase64: renderRes.pngBase64,
                time: targetTime,
              });
              break;
            }

            default: {
              await writeBridgeResult(projectDir, cmd.id, {
                ok: false,
                error: `Unknown bridge command "${cmd.type}".`,
              });
              break;
            }
          }
        } catch (execErr) {
          console.error(`AI Bridge: error executing command ${cmd.id}:`, execErr);
          await writeBridgeResult(projectDir, cmd.id, {
            ok: false,
            error: execErr?.message || String(execErr),
          });
        }
      } catch (pollErr) {
        console.warn('AI Bridge polling error:', pollErr);
      } finally {
        isProcessingRef.current = false;
      }
    }, 350);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      isProcessingRef.current = false;
    };
  }, [projectFolderHandle?.path, playbackStoreRef, setSelectedEntityId]);
}
