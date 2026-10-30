import { CanvasComponent } from '@blahblah/sdk';
import { Tween } from '@blahblah/sdk';
import { text, num, color } from 'blahblah';

export default class ParticleBurst extends CanvasComponent {
  static props = {
    count: num(40, { min: 5, max: 200 }),
    burstTime: num(0.5, { min: 0, max: 10 }),
    particleColor: color('#38bdf8'),
    particleColor2: color('#a78bfa'),
    lifetime: num(2, { min: 0.5, max: 5 }),
  };

  _particles = null;

  _seed(i) {
    // deterministic pseudo-random so scrubbing is stable
    let s = (i * 9301 + 49297) % 233280;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }

  _ensureParticles(count) {
    if (this._particles && this._particles.length === count) return;
    this._particles = [];
    for (let i = 0; i < count; i++) {
      const rng = this._seed(i);
      const angle = rng() * Math.PI * 2;
      const speed = 100 + rng() * 400;
      const size = 2 + rng() * 6;
      const useColor2 = rng() > 0.5;
      this._particles.push({ angle, speed, size, useColor2, rotSpeed: (rng() - 0.5) * 4 });
    }
  }

  onUpdate({ time, props }) {
    const { ctx, canvasWidth: W, canvasHeight: H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    this._ensureParticles(props.count);
    const t = time - props.burstTime;
    if (t < 0 || t > props.lifetime) return;

    const cx = W / 2;
    const cy = H / 2;
    const life = props.lifetime;

    for (const p of this._particles) {
      const progress = t / life;
      const alpha = 1 - progress;
      const dist = p.speed * t * (1 - progress * 0.5);
      const x = cx + Math.cos(p.angle) * dist;
      const y = cy + Math.sin(p.angle) * dist - 50 * t;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(x, y);
      ctx.rotate(p.rotSpeed * t);
      ctx.fillStyle = p.useColor2 ? props.particleColor2 : props.particleColor;

      // Mix of circles and small rectangles for visual variety
      if (p.size > 5) {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  onSeek() { /* stateless — particles are deterministic */ }
}
