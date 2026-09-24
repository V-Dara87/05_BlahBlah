import { CanvasComponent } from '@blahblah/sdk';

/**
 * StarGizmoTest (Local & Global Transform Space API Demo)
 *
 * Demonstrates:
 * 1. Local Coordinate Space (space: 'local'):
 *    - Positions are relative to center (0, 0).
 *    - Each star has its own local `rotation` angle.
 *    - The gizmo axis handles automatically rotate along the star's heading!
 *    - Dragging along the red X arrow moves the star along its local forward direction.
 * 2. Global Coordinate Space (space: 'global'):
 *    - Positions are in canvas pixel coordinates (0 to 1920, 0 to 1080).
 *    - Axis arrows remain aligned with the viewport (horizontal/vertical).
 * 3. Right-click any gizmo in preview to switch between Local and Global on the fly!
 */
export default class StarGizmoTest extends CanvasComponent {
  static props = {
    coordMode: select('local', ['local', 'global'], {
      label: 'Coordinate Mode',
    }),
    stars: {
      type: 'struct[]',
      label: 'Stars',
      gizmo: true,
      default: [
        { x: -650, y: -300, scale: 0.9, rotation: 15, points: 5, color: '#facc15' }, // Gold
        { x: -300, y: -330, scale: 1.2, rotation: -30, points: 4, color: '#38bdf8' }, // Sky Blue
        { x:    0, y: -260, scale: 1.5, rotation: 0, points: 6, color: '#ec4899' }, // Pink
        { x:  380, y: -310, scale: 0.8, rotation: 45, points: 5, color: '#a855f7' }, // Purple
        { x:  720, y: -230, scale: 1.1, rotation: 60, points: 7, color: '#f97316' }, // Orange
        { x: -600, y:    0, scale: 1.3, rotation: -15, points: 5, color: '#22c55e' }, // Emerald Green
        { x: -180, y:  -10, scale: 0.7, rotation: 20, points: 4, color: '#eab308' }, // Yellow
        { x:  220, y:   10, scale: 1.4, rotation: -45, points: 8, color: '#06b6d4' }, // Cyan
        { x:  660, y:  -10, scale: 1.0, rotation: 30, points: 5, color: '#ef4444' }, // Red
        { x: -480, y:  320, scale: 1.1, rotation: -60, points: 6, color: '#8b5cf6' }, // Violet
        { x:    0, y:  300, scale: 1.6, rotation: 0, points: 5, color: '#fbbf24' }, // Amber (Center Bottom)
        { x:  500, y:  330, scale: 0.85, rotation: 75, points: 5, color: '#14b8a6' }, // Teal
      ],
      fields: {
        x: num(0, { min: -1920, max: 1920, label: 'X' }),
        y: num(0, { min: -1080, max: 1080, label: 'Y' }),
        scale: num(1, { min: 0.1, max: 5, step: 0.05, label: 'Scale' }),
        rotation: num(0, { min: -180, max: 180, step: 5, label: 'Local Angle (°)' }),
        points: num(5, { min: 3, max: 12, step: 1, label: 'Points' }),
        color: color('#facc15', { label: 'Star Color' }),
      },
    },
    rotationSpeed: num(0.8, { min: -5, max: 5, step: 0.1, label: 'Rotation Speed' }),
    pulseEffect: bool(true, { label: 'Breathing Pulse' }),
    connectLines: bool(true, { label: 'Constellation Lines' }),
  };

  /**
   * ギズモハンドル定義
   * `space: 'local'` では各星の rotation に沿ってギズモの矢印が回転します！
   */
  getGizmos({ props, canvasWidth, canvasHeight }) {
    const list = this.getStarList(props, canvasWidth, canvasHeight);
    const isLocal = (props?.coordMode ?? 'local') === 'local';

    return list.map((star, idx) => ({
      id: `star-${idx}`,
      label: `Star ${idx + 1}`,
      x: star.x ?? 0,
      y: star.y ?? 0,
      propPath: `stars[${idx}]`,
      axes: 'xy',
      space: isLocal ? 'local' : 'global',
      rotation: isLocal ? (star.rotation || 0) : 0,
      size: (star.scale && star.scale < 0.8) ? 'compact' : 'normal',
      color: star.color || '#facc15',
    }));
  }

  getStarList(props, canvasWidth = 1920, canvasHeight = 1080) {
    if (Array.isArray(props?.stars) && props.stars.length > 0) {
      return props.stars;
    }
    return StarGizmoTest.props.stars.default;
  }

  onMount({ container, canvasWidth, canvasHeight }) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = canvasWidth || 1920;
    this.canvas.height = canvasHeight || 1080;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  onUpdate({ time, canvasWidth, canvasHeight, props }) {
    if (!this.ctx) return;
    if (this.canvas.width !== canvasWidth || this.canvas.height !== canvasHeight) {
      this.canvas.width = canvasWidth;
      this.canvas.height = canvasHeight;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const stars = this.getStarList(props, canvasWidth, canvasHeight);
    const isLocal = (props?.coordMode ?? 'local') === 'local';
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    const rotSpeed = props?.rotationSpeed ?? 0.8;
    const pulseEnabled = props?.pulseEffect !== false;
    const drawLines = props?.connectLines !== false;

    // Helper: get canvas pixel coordinates for a star
    const getPos = (star) => {
      if (isLocal) {
        return { x: cx + (star.x ?? 0), y: cy + (star.y ?? 0) };
      }
      return { x: star.x ?? cx, y: star.y ?? cy };
    };

    // 1. Constellation Connection Lines
    if (drawLines && stars.length > 1) {
      ctx.save();
      ctx.lineWidth = 1.5;
      for (let i = 0; i < stars.length; i++) {
        for (let j = i + 1; j < stars.length; j++) {
          const p1 = getPos(stars[i]);
          const p2 = getPos(stars[j]);
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 480) {
            const alpha = Math.max(0.05, (1 - dist / 480) * 0.4);
            ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // 2. Render each star
    stars.forEach((star, idx) => {
      const pos = getPos(star);
      const baseScale = star.scale ?? 1;
      const points = star.points ?? 5;
      const starColor = star.color || '#facc15';
      const localRotation = ((star.rotation || 0) * Math.PI) / 180;

      const pulse = pulseEnabled ? Math.sin(time * 3 + idx * 0.7) * 0.08 : 0;
      const finalScale = Math.max(0.1, baseScale + pulse);
      const animatedSpin = (time * rotSpeed) * ((idx % 2 === 0) ? 1 : -1);

      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(localRotation + animatedSpin);
      ctx.scale(finalScale, finalScale);

      // Draw glowing star shape
      ctx.beginPath();
      const outerR = 55;
      const innerR = 24;
      const step = Math.PI / points;

      for (let i = 0; i < 2 * points; i++) {
        const r = (i % 2 === 0) ? outerR : innerR;
        const angle = i * step - Math.PI / 2;
        const px = r * Math.cos(angle);
        const py = r * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      ctx.fillStyle = starColor;
      ctx.shadowColor = starColor;
      ctx.shadowBlur = 16;
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.restore();
    });
  }

  onUnmount({ container }) {
    if (this.canvas?.parentNode === container) {
      container.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
  }
}
