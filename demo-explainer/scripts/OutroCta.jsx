import { CanvasComponent } from '@blahblah/sdk';
import { Tween } from '@blahblah/sdk';
import { text, num, color } from 'blahblah';

export default class OutroCta extends CanvasComponent {
  static props = {
    badgeText: text('OPEN SOURCE & EXTENSIBLE', { label: 'Badge' }),
    heading: text('Start Building with BlahBlah', { label: 'Heading' }),
    tagline: text('The AI-Native Motion Canvas & Video Engine', { label: 'Tagline' }),
    buttonText: text('Get Started \u2192', { label: 'Button' }),
    accentColor: color('#38bdf8'),
    textColor: color('#f8fafc'),
  };

  onUpdate({ time, props }) {
    const { ctx, canvasWidth: W, canvasHeight: H } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    // Staggered entrance
    const pBadge = Tween.progress(time, { at: 0.2, duration: 0.6, ease: 'outCubic' });
    const pHeading = Tween.progress(time, { at: 0.5, duration: 0.8, ease: 'outCubic' });
    const pTagline = Tween.progress(time, { at: 0.8, duration: 0.7, ease: 'outCubic' });
    const pButton = Tween.progress(time, { at: 1.1, duration: 0.6, ease: 'outCubic' });

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. Badge Pill
    if (pBadge > 0) {
      ctx.save();
      ctx.globalAlpha = pBadge;
      const bY = H / 2 - 130 + (1 - pBadge) * 30;
      ctx.font = '600 20px "Inter", system-ui, sans-serif';
      const bText = props.badgeText;
      const bW = ctx.measureText(bText).width + 36;
      const bH = 38;

      ctx.beginPath();
      ctx.roundRect(W / 2 - bW / 2, bY - bH / 2, bW, bH, 19);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = props.accentColor;
      ctx.fillText(bText, W / 2, bY + 1);
      ctx.restore();
    }

    // 2. Heading
    if (pHeading > 0) {
      ctx.save();
      ctx.globalAlpha = pHeading;
      const hY = H / 2 - 40 + (1 - pHeading) * 40;
      ctx.font = 'bold 76px "Inter", "SF Pro Display", system-ui, sans-serif';
      ctx.shadowColor = props.accentColor;
      ctx.shadowBlur = 35 * pHeading;
      ctx.fillStyle = props.textColor;
      ctx.fillText(props.heading, W / 2, hY);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // 3. Tagline
    if (pTagline > 0) {
      ctx.save();
      ctx.globalAlpha = pTagline;
      const tY = H / 2 + 45 + (1 - pTagline) * 30;
      ctx.font = '400 30px "Inter", system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(props.tagline, W / 2, tY);
      ctx.restore();
    }

    // 4. CTA Button (Glowing Glassmorphic pill)
    if (pButton > 0) {
      ctx.save();
      ctx.globalAlpha = pButton;
      const btnY = H / 2 + 140 + (1 - pButton) * 25;
      const btnText = props.buttonText;
      ctx.font = '600 24px "Inter", system-ui, sans-serif';
      const btnW = ctx.measureText(btnText).width + 64;
      const btnH = 58;

      // Glow behind button
      ctx.shadowColor = props.accentColor;
      ctx.shadowBlur = 25 * pButton;

      ctx.beginPath();
      ctx.roundRect(W / 2 - btnW / 2, btnY - btnH / 2, btnW, btnH, 29);
      ctx.fillStyle = props.accentColor;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#0f172a';
      ctx.fillText(btnText, W / 2, btnY + 1);
      ctx.restore();
    }

    ctx.restore();
  }
}
