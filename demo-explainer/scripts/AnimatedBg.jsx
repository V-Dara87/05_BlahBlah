import { CanvasComponent } from '@blahblah/sdk';
import { color, num } from 'blahblah';

export default class AnimatedBg extends CanvasComponent {
  static props = {
    color1: color('#0f172a'),
    color2: color('#1e3a5f'),
    color3: color('#0d9488'),
    speed: num(0.3, { min: 0.01, max: 2, step: 0.01 }),
    noiseScale: num(0.8, { min: 0.1, max: 3, step: 0.1 }),
  };

  onUpdate({ time, props }) {
    const { ctx } = this;
    if (!ctx) return;

    // canvasWidth/canvasHeight が 0 や未定義の時は安全なデフォルト値を使用
    const W = Number.isFinite(this.canvasWidth) && this.canvasWidth > 0 ? this.canvasWidth : 1920;
    const H = Number.isFinite(this.canvasHeight) && this.canvasHeight > 0 ? this.canvasHeight : 1080;

    const t = (Number.isFinite(time) ? time : 0) * (props.speed || 0.3);

    // Deep dark base fill
    ctx.fillStyle = props.color1 || '#0f172a';
    ctx.fillRect(0, 0, W, H);

    // Animated gradient orbs with guaranteed positive finite radii
    const orbs = [
      {
        cx: W * (0.3 + 0.15 * Math.sin(t * 0.7)),
        cy: H * (0.3 + 0.1 * Math.cos(t * 0.5)),
        r: Math.max(10, W * 0.45),
        color: props.color2 || '#1e3a5f',
      },
      {
        cx: W * (0.7 + 0.12 * Math.cos(t * 0.9)),
        cy: H * (0.7 + 0.15 * Math.sin(t * 0.6)),
        r: Math.max(10, W * 0.4),
        color: props.color3 || '#0d9488',
      },
      {
        cx: W * (0.5 + 0.2 * Math.sin(t * 1.1)),
        cy: H * (0.2 + 0.1 * Math.cos(t * 0.8)),
        r: Math.max(10, W * 0.3),
        color: props.color2 || '#1e3a5f',
      },
    ];

    ctx.globalCompositeOperation = 'lighter';
    for (const orb of orbs) {
      if (!Number.isFinite(orb.cx) || !Number.isFinite(orb.cy) || !Number.isFinite(orb.r) || orb.r <= 0) {
        continue;
      }
      try {
        const grad = ctx.createRadialGradient(orb.cx, orb.cy, 0, orb.cx, orb.cy, orb.r);
        grad.addColorStop(0, orb.color + '33');
        grad.addColorStop(0.5, orb.color + '15');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      } catch (e) {
        // Safe fallback if gradient creation fails
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // Subtle grid overlay
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    const gridSize = 60;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Vignette
    const vigR1 = Math.max(1, W * 0.25);
    const vigR2 = Math.max(vigR1 + 1, W * 0.75);
    try {
      const vig = ctx.createRadialGradient(W / 2, H / 2, vigR1, W / 2, H / 2, vigR2);
      vig.addColorStop(0, 'transparent');
      vig.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    } catch (e) {
      // Safe fallback
    }
  }
}
