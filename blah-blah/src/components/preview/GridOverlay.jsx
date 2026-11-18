import { useRef, useLayoutEffect } from 'react';
import { drawGroundGrid } from '../../engine/groundGrid3d.js';

/**
 * Canvas overlay that renders a 3D ground plane grid (Y=0) projected through the active camera.
 */
export function GridOverlay({
  camera,
  width = 1920,
  height = 1080,
  zIndex = 1,
}) {
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (!camera) return;

    drawGroundGrid(ctx, camera, { width, height });
  }, [camera, width, height]);

  if (!camera) return null;

  return (
    <canvas
      ref={canvasRef}
      className="preview-ground-grid-canvas"
      width={width}
      height={height}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
        zIndex,
      }}
    />
  );
}
