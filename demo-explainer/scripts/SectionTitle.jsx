import { CanvasComponent } from '@blahblah/sdk';
import { Tween } from '@blahblah/sdk';
import { text, num, color } from 'blahblah';

export default class SectionTitle extends CanvasComponent {
  static props = {
    label: text('WHY BLAHBLAH?', { label: 'Section Label' }),
    fontSize: num(28, { min: 10, max: 100 }),
    textColor: color('#38bdf8'),
    pillBg: color('rgba(56,189,248,0.1)'),
    pillBorder: color('rgba(56,189,248,0.3)'),
    entranceDelay: num(0, { min: 0, max: 10 }),
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth: W, canvasHeight: H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const t = time - props.entranceDelay;
    if (t < 0) return;

    const p = Tween.progress(t, { at: 0, duration: 0.7, ease: 'outCubic' });
    const scaleP = 0.9 + 0.1 * p;

    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(W / 2, H / 2);
    ctx.scale(scaleP, scaleP);

    // Measure text for pill
    ctx.font = `600 ${props.fontSize}px "Inter", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(props.label);
    const tw = metrics.width;
    const th = props.fontSize;
    const px = 32;
    const py = 16;
    const pillW = tw + px * 2;
    const pillH = th + py * 2;
    const r = pillH / 2;

    // Pill background
    ctx.beginPath();
    ctx.roundRect(-pillW / 2, -pillH / 2, pillW, pillH, r);
    ctx.fillStyle = props.pillBg;
    ctx.fill();
    ctx.strokeStyle = props.pillBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Text
    ctx.fillStyle = props.textColor;
    ctx.fillText(props.label, 0, 1);

    ctx.restore();
  }
}
