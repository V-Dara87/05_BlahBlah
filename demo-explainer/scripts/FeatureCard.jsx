import { CanvasComponent } from '@blahblah/sdk';
import { Tween } from '@blahblah/sdk';
import { text, num, color } from 'blahblah';

export default class FeatureCard extends CanvasComponent {
  static props = {
    icon: text('\u2728', { label: 'Emoji Icon' }),
    title: text('Feature', { label: 'Title' }),
    body: text('Description text here', { label: 'Body', multiline: true }),
    cardWidth: num(520, { min: 200, max: 1000 }),
    cardHeight: num(280, { min: 100, max: 600 }),
    bgColor: color('rgba(15,23,42,0.85)'),
    borderColor: color('rgba(56,189,248,0.3)'),
    titleColor: color('#f1f5f9'),
    bodyColor: color('#94a3b8'),
    accentColor: color('#38bdf8'),
    entranceDelay: num(0, { min: 0, max: 5 }),
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth: W, canvasHeight: H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const t = time - props.entranceDelay;
    if (t < 0) return;

    const p = Tween.progress(t, { at: 0, duration: 0.8, ease: 'outCubic' });
    const scaleP = 0.85 + 0.15 * p;
    const alphaP = p;
    const slideY = (1 - p) * 60;

    const cw = props.cardWidth;
    const ch = props.cardHeight;
    const cx = (W - cw) / 2;
    const cy = (H - ch) / 2 + slideY;
    const r = 20;

    ctx.save();
    ctx.globalAlpha = alphaP;
    ctx.translate(W / 2, H / 2 + slideY);
    ctx.scale(scaleP, scaleP);
    ctx.translate(-W / 2, -H / 2 - slideY);

    // Card shadow
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;

    // Rounded rect fill
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, r);
    ctx.fillStyle = props.bgColor;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Gradient border
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = props.borderColor;
    ctx.stroke();

    // Accent line at top
    const accentP = Tween.progress(t, { at: 0.3, duration: 0.5, ease: 'outCubic' });
    if (accentP > 0) {
      const lineLen = (cw - 2 * r) * accentP;
      ctx.beginPath();
      ctx.moveTo(cx + r, cy);
      ctx.lineTo(cx + r + lineLen, cy);
      ctx.strokeStyle = props.accentColor;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Icon
    const iconP = Tween.progress(t, { at: 0.2, duration: 0.6, ease: 'outCubic' });
    ctx.globalAlpha = alphaP * iconP;
    ctx.font = '52px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(props.icon, cx + 36, cy + 36);

    // Title
    const titleP = Tween.progress(t, { at: 0.35, duration: 0.6, ease: 'outCubic' });
    ctx.globalAlpha = alphaP * titleP;
    ctx.font = 'bold 32px "Inter", system-ui, sans-serif';
    ctx.fillStyle = props.titleColor;
    ctx.fillText(props.title, cx + 36, cy + 105);

    // Body text
    const bodyP = Tween.progress(t, { at: 0.5, duration: 0.6, ease: 'outCubic' });
    ctx.globalAlpha = alphaP * bodyP;
    ctx.font = '20px "Inter", system-ui, sans-serif';
    ctx.fillStyle = props.bodyColor;

    const words = props.body.split(' ');
    let line = '';
    let lineY = cy + 155;
    const maxW = cw - 72;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx + 36, lineY);
        line = word;
        lineY += 28;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, cx + 36, lineY);

    ctx.restore();
  }
}
