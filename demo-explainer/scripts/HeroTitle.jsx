import { CanvasComponent } from '@blahblah/sdk';
import { Tween, Easing } from '@blahblah/sdk';
import { text, num, color } from 'blahblah';

export default class HeroTitle extends CanvasComponent {
  static props = {
    line1: text('BlahBlah', { label: 'Main Title' }),
    line2: text('AI-Native Video Editor', { label: 'Subtitle' }),
    fontSize1: num(120, { min: 20, max: 300 }),
    fontSize2: num(44, { min: 10, max: 120 }),
    textColor: color('#f1f5f9'),
    accentColor: color('#38bdf8'),
    animDuration: num(1.2, { min: 0.2, max: 5 }),
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth: W, canvasHeight: H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const dur = props.animDuration;

    // Line 1 — slide up + fade in
    const p1 = Tween.progress(time, { at: 0, duration: dur, ease: 'outCubic' });
    const y1Off = (1 - p1) * 80;
    const alpha1 = p1;

    ctx.save();
    ctx.globalAlpha = alpha1;
    ctx.font = `bold ${props.fontSize1}px "Inter", "SF Pro Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Accent glow behind text
    ctx.shadowColor = props.accentColor;
    ctx.shadowBlur = 40 * p1;
    ctx.fillStyle = props.textColor;
    ctx.fillText(props.line1, W / 2, H / 2 - 40 + y1Off);
    ctx.shadowBlur = 0;
    ctx.restore();

    // Line 2 — staggered entrance
    const p2 = Tween.progress(time, { at: 0.4, duration: dur, ease: 'outCubic' });
    const y2Off = (1 - p2) * 50;

    ctx.save();
    ctx.globalAlpha = p2;
    ctx.font = `400 ${props.fontSize2}px "Inter", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = props.accentColor;
    ctx.fillText(props.line2, W / 2, H / 2 + 60 + y2Off);
    ctx.restore();

    // Animated underline accent
    const lineP = Tween.progress(time, { at: 0.8, duration: 0.6, ease: 'outCubic' });
    if (lineP > 0) {
      const lineW = 200 * lineP;
      ctx.save();
      ctx.strokeStyle = props.accentColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.globalAlpha = lineP;
      ctx.beginPath();
      ctx.moveTo(W / 2 - lineW / 2, H / 2 + 95);
      ctx.lineTo(W / 2 + lineW / 2, H / 2 + 95);
      ctx.stroke();
      ctx.restore();
    }
  }
}
