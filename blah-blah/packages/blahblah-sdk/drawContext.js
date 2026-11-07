// ─── DrawContext / CanvasKit (Motion Canvas style fluent 2D wrapper) ───────────

export class DrawContext {
  /** @type {CanvasRenderingContext2D} */
  ctx;
  /** @type {number} */
  width = 0;
  /** @type {number} */
  height = 0;
  /** @type {number} */
  aspect = 1;
  /** @type {any} */
  component = null;

  constructor(ctx, { width = 0, height = 0, component = null } = {}) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.aspect = height > 0 ? width / height : 1;
    this.component = component;
  }

  _sync(ctx, width, height) {
    if (ctx) this.ctx = ctx;
    if (width !== undefined) this.width = width;
    if (height !== undefined) this.height = height;
    this.aspect = this.height > 0 ? this.width / this.height : 1;
    return this;
  }

  clear(color) {
    if (!this.ctx) return this;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (color && color !== 'transparent') {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(0, 0, this.width, this.height);
    } else {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
    this.ctx.restore();
    return this;
  }

  center() {
    if (!this.ctx) return this;
    this.ctx.translate(this.width / 2, this.height / 2);
    return this;
  }

  resetTransform() {
    if (!this.ctx) return this;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    return this;
  }

  toScreen(x, y) {
    return {
      x: (this.width / 2) + (Number(x) || 0),
      y: (this.height / 2) + (Number(y) || 0),
    };
  }

  fromScreen(x, y) {
    return {
      x: (Number(x) || 0) - (this.width / 2),
      y: (Number(y) || 0) - (this.height / 2),
    };
  }

  isolate(fn) {
    if (!this.ctx) return fn(this);
    this.ctx.save();
    try {
      return fn(this);
    } finally {
      this.ctx.restore();
    }
  }

  save() {
    this.ctx?.save();
    return this;
  }

  restore() {
    this.ctx?.restore();
    return this;
  }

  translate(x, y) {
    this.ctx?.translate(Number(x) || 0, Number(y) || 0);
    return this;
  }

  rotate(angle, unit = 'deg') {
    if (!this.ctx) return this;
    const rad = unit === 'deg' ? (angle * Math.PI) / 180 : angle;
    this.ctx.rotate(rad);
    return this;
  }

  scale(sx, sy = sx) {
    this.ctx?.scale(sx, sy);
    return this;
  }

  alpha(opacity) {
    if (!this.ctx) return this;
    this.ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
    return this;
  }

  _applyStyles({ fill, stroke, lineWidth = 1, dash, shadow, alpha, lineCap, lineJoin } = {}) {
    if (!this.ctx) return;
    if (alpha !== undefined && alpha !== null) {
      this.ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
    }
    if (fill) this.ctx.fillStyle = fill;
    if (stroke) {
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = lineWidth;
    }
    if (lineCap) this.ctx.lineCap = lineCap;
    if (lineJoin) this.ctx.lineJoin = lineJoin;
    if (Array.isArray(dash)) {
      this.ctx.setLineDash(dash);
    }
    if (shadow) {
      this.ctx.shadowColor = shadow.color || 'rgba(0,0,0,0.5)';
      this.ctx.shadowBlur = shadow.blur || 0;
      this.ctx.shadowOffsetX = shadow.x || 0;
      this.ctx.shadowOffsetY = shadow.y || 0;
    }
  }

  _roundRectPath(x, y, w, h, r = 0) {
    if (typeof this.ctx.roundRect === 'function') {
      this.ctx.roundRect(x, y, w, h, r);
      return;
    }
    let radius = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : { tl: 0, tr: 0, br: 0, bl: 0, ...r };
    const maxR = Math.min(Math.abs(w) / 2, Math.abs(h) / 2);
    radius.tl = Math.min(radius.tl, maxR);
    radius.tr = Math.min(radius.tr, maxR);
    radius.br = Math.min(radius.br, maxR);
    radius.bl = Math.min(radius.bl, maxR);

    this.ctx.moveTo(x + radius.tl, y);
    this.ctx.lineTo(x + w - radius.tr, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + radius.tr);
    this.ctx.lineTo(x + w, y + h - radius.br);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - radius.br, y + h);
    this.ctx.lineTo(x + radius.bl, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - radius.bl);
    this.ctx.lineTo(x, y + radius.tl);
    this.ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    this.ctx.closePath();
  }

  rect({
    x = 0,
    y = 0,
    width = 100,
    height = 100,
    radius = 0,
    fill,
    stroke,
    lineWidth = 1,
    anchor = 'center',
    dash,
    shadow,
    alpha,
  } = {}) {
    if (!this.ctx) return { x, y, width, height, right: x + width, bottom: y + height };
    const drawX = anchor === 'center' ? x - width / 2 : x;
    const drawY = anchor === 'center' ? y - height / 2 : y;

    this.isolate(() => {
      this._applyStyles({ fill, stroke, lineWidth, dash, shadow, alpha });
      this.ctx.beginPath();
      if (radius) {
        this._roundRectPath(drawX, drawY, width, height, radius);
      } else {
        this.ctx.rect(drawX, drawY, width, height);
      }
      if (fill) this.ctx.fill();
      if (stroke) this.ctx.stroke();
    });

    return { x: drawX, y: drawY, width, height, right: drawX + width, bottom: drawY + height };
  }

  circle({
    x = 0,
    y = 0,
    radius = 50,
    fill,
    stroke,
    lineWidth = 1,
    dash,
    shadow,
    alpha,
  } = {}) {
    if (!this.ctx) return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 };
    this.isolate(() => {
      this._applyStyles({ fill, stroke, lineWidth, dash, shadow, alpha });
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      if (fill) this.ctx.fill();
      if (stroke) this.ctx.stroke();
    });
    return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2, radius };
  }

  ellipse({
    x = 0,
    y = 0,
    radiusX = 50,
    radiusY = 30,
    rotation = 0,
    fill,
    stroke,
    lineWidth = 1,
    dash,
    shadow,
    alpha,
  } = {}) {
    if (!this.ctx) return { x: x - radiusX, y: y - radiusY, width: radiusX * 2, height: radiusY * 2 };
    const rotRad = (rotation * Math.PI) / 180;
    this.isolate(() => {
      this._applyStyles({ fill, stroke, lineWidth, dash, shadow, alpha });
      this.ctx.beginPath();
      this.ctx.ellipse(x, y, radiusX, radiusY, rotRad, 0, Math.PI * 2);
      if (fill) this.ctx.fill();
      if (stroke) this.ctx.stroke();
    });
    return { x: x - radiusX, y: y - radiusY, width: radiusX * 2, height: radiusY * 2 };
  }

  line({
    from = [0, 0],
    to = [100, 100],
    stroke = '#ffffff',
    lineWidth = 2,
    cap = 'round',
    dash,
    shadow,
    alpha,
  } = {}) {
    if (!this.ctx) return { from, to };
    this.isolate(() => {
      this._applyStyles({ stroke, lineWidth, dash, shadow, alpha, lineCap: cap });
      this.ctx.beginPath();
      this.ctx.moveTo(from[0], from[1]);
      this.ctx.lineTo(to[0], to[1]);
      this.ctx.stroke();
    });
    return { from, to };
  }

  arrow({
    from = [0, 0],
    to = [100, 100],
    stroke = '#ffffff',
    fillHead = true,
    lineWidth = 2,
    headSize = 14,
    headAngle = 30,
    dash,
    shadow,
    alpha,
  } = {}) {
    if (!this.ctx) return { from, to };
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const angle = Math.atan2(dy, dx);
    const arrowRad = (headAngle * Math.PI) / 180;

    this.isolate(() => {
      this._applyStyles({ stroke, fill: fillHead ? stroke : undefined, lineWidth, dash, shadow, alpha, lineCap: 'round', lineJoin: 'round' });
      this.ctx.beginPath();
      this.ctx.moveTo(from[0], from[1]);
      this.ctx.lineTo(to[0], to[1]);
      this.ctx.stroke();

      const x1 = to[0] - headSize * Math.cos(angle - arrowRad);
      const y1 = to[1] - headSize * Math.sin(angle - arrowRad);
      const x2 = to[0] - headSize * Math.cos(angle + arrowRad);
      const y2 = to[1] - headSize * Math.sin(angle + arrowRad);

      this.ctx.beginPath();
      this.ctx.moveTo(to[0], to[1]);
      this.ctx.lineTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.closePath();
      if (fillHead) {
        this.ctx.fill();
      }
      this.ctx.stroke();
    });
    return { from, to };
  }

  polygon({
    points = [],
    fill,
    stroke,
    lineWidth = 1,
    closed = true,
    dash,
    shadow,
    alpha,
  } = {}) {
    if (!this.ctx || points.length === 0) return this;
    this.isolate(() => {
      this._applyStyles({ fill, stroke, lineWidth, dash, shadow, alpha, lineJoin: 'round' });
      this.ctx.beginPath();
      this.ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        this.ctx.lineTo(points[i][0], points[i][1]);
      }
      if (closed) this.ctx.closePath();
      if (fill) this.ctx.fill();
      if (stroke) this.ctx.stroke();
    });
    return this;
  }

  grid({
    size = 60,
    stroke = 'rgba(255, 255, 255, 0.08)',
    lineWidth = 1,
  } = {}) {
    if (!this.ctx) return this;
    this.isolate(() => {
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = lineWidth;
      this.ctx.beginPath();
      const halfW = this.width / 2;
      const halfH = this.height / 2;
      for (let x = -halfW; x <= halfW; x += size) {
        this.ctx.moveTo(x, -halfH);
        this.ctx.lineTo(x, halfH);
      }
      for (let y = -halfH; y <= halfH; y += size) {
        this.ctx.moveTo(-halfW, y);
        this.ctx.lineTo(halfW, y);
      }
      this.ctx.stroke();
    });
    return this;
  }

  _formatFont({ font, size = 16, weight = 400, family = 'sans-serif', style = 'normal' }) {
    if (font) return font;
    return `${style} ${weight} ${size}px "${family}", sans-serif`;
  }

  measureText(content, options = {}) {
    const textStr = String(content ?? '');
    const fontStr = this._formatFont(options);
    if (!this.ctx) return { width: textStr.length * 8, height: options.size || 16, font: fontStr };
    this.ctx.save();
    this.ctx.font = fontStr;
    const metrics = this.ctx.measureText(textStr);
    this.ctx.restore();
    return {
      width: metrics.width,
      height: options.size || (metrics.actualBoundingBoxAscent ? metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent : 16),
      font: fontStr,
    };
  }

  text(content, {
    x = 0,
    y = 0,
    font,
    size = 16,
    weight = 400,
    family = 'sans-serif',
    style = 'normal',
    color = '#ffffff',
    fill = color,
    stroke,
    strokeWidth = 1,
    align = 'center',
    baseline = 'middle',
    maxWidth,
    shadow,
    alpha,
  } = {}) {
    const textStr = String(content ?? '');
    const fontStr = this._formatFont({ font, size, weight, family, style });
    if (!this.ctx) return { x, y, width: 0, height: size };

    let measuredWidth = 0;
    this.isolate(() => {
      this._applyStyles({ fill, stroke, lineWidth: strokeWidth, shadow, alpha });
      this.ctx.font = fontStr;
      this.ctx.textAlign = align;
      this.ctx.textBaseline = baseline;
      measuredWidth = this.ctx.measureText(textStr).width;
      if (maxWidth && maxWidth > 0) {
        if (fill) this.ctx.fillText(textStr, x, y, maxWidth);
        if (stroke) this.ctx.strokeText(textStr, x, y, maxWidth);
      } else {
        if (fill) this.ctx.fillText(textStr, x, y);
        if (stroke) this.ctx.strokeText(textStr, x, y);
      }
    });

    return { x, y, width: measuredWidth, height: size };
  }

  textWrap(content, {
    x = 0,
    y = 0,
    maxWidth = 400,
    lineHeight,
    font,
    size = 16,
    weight = 400,
    family = 'sans-serif',
    color = '#ffffff',
    fill = color,
    align = 'left',
    baseline = 'top',
    maxLines = Infinity,
    shadow,
    alpha,
  } = {}) {
    const textStr = String(content ?? '');
    const fontStr = this._formatFont({ font, size, weight, family });
    const lineSpacing = lineHeight || Math.round(size * 1.35);
    const words = textStr.split(/\s+/);
    const lines = [];
    let currentLine = '';

    if (this.ctx) {
      this.ctx.save();
      this.ctx.font = fontStr;

      for (let i = 0; i < words.length; i++) {
        const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
        const w = this.ctx.measureText(testLine).width;
        if (w > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = words[i];
          if (lines.length >= maxLines - 1) {
            const remaining = words.slice(i).join(' ');
            let truncated = remaining;
            while (truncated.length > 0 && this.ctx.measureText(`${truncated}...`).width > maxWidth) {
              truncated = truncated.slice(0, -1);
            }
            lines.push(`${truncated}...`);
            currentLine = '';
            break;
          }
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
      }
      this.ctx.restore();
    } else {
      lines.push(textStr);
    }

    const totalHeight = lines.length * lineSpacing;
    lines.forEach((line, idx) => {
      const lineY = y + idx * lineSpacing;
      this.text(line, {
        x,
        y: lineY,
        font: fontStr,
        size,
        fill,
        align,
        baseline,
        shadow,
        alpha,
      });
    });

    return { lines, count: lines.length, totalHeight, maxWidth };
  }

  badge(text, {
    x = 0,
    y = 0,
    bg = '#38bdf8',
    color = '#ffffff',
    radius = 6,
    padding = [4, 10],
    size = 14,
    weight = 700,
    family = 'sans-serif',
    border,
    shadow,
    alpha,
    anchor = 'center',
  } = {}) {
    const padY = Array.isArray(padding) ? padding[0] : padding;
    const padX = Array.isArray(padding) ? (padding[1] ?? padding[0]) : padding;
    const textMeas = this.measureText(text, { size, weight, family });
    const boxWidth = textMeas.width + padX * 2;
    const boxHeight = size + padY * 2;

    const box = this.rect({
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      radius,
      fill: bg,
      stroke: border?.color,
      lineWidth: border?.width || 1,
      shadow,
      alpha,
      anchor,
    });

    const textCenterX = box.x + boxWidth / 2;
    const textCenterY = box.y + boxHeight / 2;
    this.text(text, {
      x: textCenterX,
      y: textCenterY,
      size,
      weight,
      family,
      color,
      align: 'center',
      baseline: 'middle',
      alpha,
    });

    return box;
  }

  progressBar({
    x = 0,
    y = 0,
    width = 500,
    height = 22,
    progress = 0,
    fill = '#38bdf8',
    bg = 'rgba(15, 23, 42, 0.9)',
    border = 'rgba(255, 255, 255, 0.2)',
    radius = 5,
    label = '',
    showPercentage = true,
    font = 'Inter',
    textColor = '#e2e8f0',
    anchor = 'center',
    alpha = 1,
  } = {}) {
    const normalized = progress > 1 ? Math.min(1, progress / 100) : Math.max(0, Math.min(1, progress));
    const percentInt = Math.round(normalized * 100);
    const drawX = anchor === 'center' ? x - width / 2 : x;
    const drawY = anchor === 'center' ? y : y;

    if (label || showPercentage) {
      if (label) {
        this.text(label.toUpperCase(), {
          x: drawX,
          y: drawY - 14,
          font: `800 15px "${font}", sans-serif`,
          color: textColor,
          align: 'left',
          baseline: 'middle',
          alpha,
        });
      }
      if (showPercentage) {
        this.text(`${percentInt}%`, {
          x: drawX + width,
          y: drawY - 14,
          font: `800 15px "${font}", sans-serif`,
          color: fill,
          align: 'right',
          baseline: 'middle',
          alpha,
        });
      }
    }

    this.rect({
      x: drawX,
      y: drawY,
      width,
      height,
      radius,
      fill: bg,
      stroke: border,
      lineWidth: 2,
      anchor: 'top-left',
      alpha,
    });

    if (normalized > 0.001) {
      this.clipRect({ x: drawX, y: drawY, width, height, radius, anchor: 'top-left' }, () => {
        this.rect({
          x: drawX,
          y: drawY,
          width: width * normalized,
          height,
          radius: 0,
          fill,
          anchor: 'top-left',
          alpha,
        });
      });
    }

    return { x: drawX, y: drawY, width, height, progress: normalized };
  }

  clipRect({ x = 0, y = 0, width = 100, height = 100, radius = 0, anchor = 'center' } = {}, fn) {
    if (!this.ctx) return fn(this);
    const drawX = anchor === 'center' ? x - width / 2 : x;
    const drawY = anchor === 'center' ? y - height / 2 : y;
    return this.isolate(() => {
      this.ctx.beginPath();
      if (radius) {
        this._roundRectPath(drawX, drawY, width, height, radius);
      } else {
        this.ctx.rect(drawX, drawY, width, height);
      }
      this.ctx.clip();
      return fn(this);
    });
  }

  clipCircle({ x = 0, y = 0, radius = 50 } = {}, fn) {
    if (!this.ctx) return fn(this);
    return this.isolate(() => {
      this.ctx.beginPath();
      this.ctx.arc(x, y, radius, 0, Math.PI * 2);
      this.ctx.clip();
      return fn(this);
    });
  }

  glow(color = '#38bdf8', blur = 16, fn) {
    return this.isolate(() => {
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = blur;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = 0;
      return fn(this);
    });
  }

  shadow({ color = 'rgba(0,0,0,0.5)', blur = 10, x = 0, y = 4 } = {}, fn) {
    return this.isolate(() => {
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = blur;
      this.ctx.shadowOffsetX = x;
      this.ctx.shadowOffsetY = y;
      return fn(this);
    });
  }

  row({ x = 0, y = 0, gap = 12, align = 'center', anchor = 'center', items = [] } = {}) {
    if (!items.length) return { x, y, width: 0, height: 0 };
    const measured = items.map((item) => {
      if (item.width !== undefined && item.height !== undefined) {
        return { item, width: item.width, height: item.height };
      }
      if (item.type === 'text') {
        const m = this.measureText(item.content, item);
        return { item, width: m.width, height: m.height };
      }
      if (item.type === 'badge') {
        const padX = Array.isArray(item.padding) ? (item.padding[1] ?? item.padding[0]) : (item.padding || 10);
        const padY = Array.isArray(item.padding) ? item.padding[0] : (item.padding || 4);
        const size = item.size || 14;
        const m = this.measureText(item.text, { size, weight: item.weight, family: item.family });
        return { item, width: m.width + padX * 2, height: size + padY * 2 };
      }
      if (item.type === 'circle') {
        const r = item.radius || 20;
        return { item, width: r * 2, height: r * 2 };
      }
      return { item, width: item.width || 40, height: item.height || 40 };
    });

    const totalWidth = measured.reduce((acc, m) => acc + m.width, 0) + (items.length - 1) * gap;
    const maxHeight = Math.max(...measured.map((m) => m.height), 0);

    const startX = anchor === 'center' ? x - totalWidth / 2 : x;
    let curX = startX;

    measured.forEach(({ item, width, height }) => {
      let itemY = y;
      if (align === 'center') {
        itemY = anchor === 'center' ? y : y + maxHeight / 2;
      } else if (align === 'start') {
        itemY = anchor === 'center' ? y - maxHeight / 2 + height / 2 : y + height / 2;
      } else if (align === 'end') {
        itemY = anchor === 'center' ? y + maxHeight / 2 - height / 2 : y + maxHeight - height / 2;
      }

      const itemCenterX = curX + width / 2;
      if (typeof item.render === 'function') {
        item.render(this, itemCenterX, itemY, width, height);
      } else if (item.type === 'text') {
        this.text(item.content, { ...item, x: itemCenterX, y: itemY, align: 'center', baseline: 'middle' });
      } else if (item.type === 'badge') {
        this.badge(item.text, { ...item, x: itemCenterX, y: itemY, anchor: 'center' });
      } else if (item.type === 'circle') {
        this.circle({ ...item, x: itemCenterX, y: itemY });
      } else if (item.type === 'rect') {
        this.rect({ ...item, x: itemCenterX, y: itemY, width, height, anchor: 'center' });
      }
      curX += width + gap;
    });

    return { x: startX, y, width: totalWidth, height: maxHeight };
  }

  column({ x = 0, y = 0, gap = 12, align = 'center', anchor = 'center', items = [] } = {}) {
    if (!items.length) return { x, y, width: 0, height: 0 };
    const measured = items.map((item) => {
      if (item.width !== undefined && item.height !== undefined) {
        return { item, width: item.width, height: item.height };
      }
      if (item.type === 'text') {
        const m = this.measureText(item.content, item);
        return { item, width: m.width, height: m.height };
      }
      if (item.type === 'badge') {
        const padX = Array.isArray(item.padding) ? (item.padding[1] ?? item.padding[0]) : (item.padding || 10);
        const padY = Array.isArray(item.padding) ? item.padding[0] : (item.padding || 4);
        const size = item.size || 14;
        const m = this.measureText(item.text, { size, weight: item.weight, family: item.family });
        return { item, width: m.width + padX * 2, height: size + padY * 2 };
      }
      return { item, width: item.width || 40, height: item.height || 40 };
    });

    const totalHeight = measured.reduce((acc, m) => acc + m.height, 0) + (items.length - 1) * gap;
    const maxWidth = Math.max(...measured.map((m) => m.width), 0);

    const startY = anchor === 'center' ? y - totalHeight / 2 : y;
    let curY = startY;

    measured.forEach(({ item, width, height }) => {
      let itemX = x;
      if (align === 'center') {
        itemX = anchor === 'center' ? x : x + maxWidth / 2;
      } else if (align === 'start') {
        itemX = anchor === 'center' ? x - maxWidth / 2 + width / 2 : x + width / 2;
      } else if (align === 'end') {
        itemX = anchor === 'center' ? x + maxWidth / 2 - width / 2 : x + maxWidth - width / 2;
      }

      const itemCenterY = curY + height / 2;
      if (typeof item.render === 'function') {
        item.render(this, itemX, itemCenterY, width, height);
      } else if (item.type === 'text') {
        this.text(item.content, { ...item, x: itemX, y: itemCenterY, align: 'center', baseline: 'middle' });
      } else if (item.type === 'badge') {
        this.badge(item.text, { ...item, x: itemX, y: itemCenterY, anchor: 'center' });
      } else if (item.type === 'rect') {
        this.rect({ ...item, x: itemX, y: itemCenterY, width, height, anchor: 'center' });
      }
      curY += height + gap;
    });

    return { x, y: startY, width: maxWidth, height: totalHeight };
  }

  // ─── High-Level Motion / Video Primitives ───────────────────────────────────

  spotlight(options = {}) {
    const {
      x = 0,
      y = 0,
      width = 200,
      height = 200,
      radius = 16,
      shape = 'rect',
      backdrop = 'rgba(0, 0, 0, 0.7)',
      stroke = null,
      lineWidth = 2,
      anchor = 'center',
    } = options;

    const w = this.canvasWidth || 1920;
    const h = this.canvasHeight || 1080;

    let rx = x;
    let ry = y;
    if (anchor === 'center') {
      rx = x - width / 2;
      ry = y - height / 2;
    }

    this.ctx.save();
    this.ctx.fillStyle = backdrop;
    this.ctx.fillRect(-w, -h, w * 2, h * 2);

    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.beginPath();
    if (shape === 'circle') {
      const cr = typeof options.radius === 'number' ? options.radius : Math.min(width, height) / 2;
      this.ctx.arc(x, y, cr, 0, Math.PI * 2);
    } else {
      const safeR = Math.min(Math.max(0, radius), width / 2, height / 2);
      this.ctx.roundRect(rx, ry, width, height, safeR);
    }
    this.ctx.fillStyle = '#000000';
    this.ctx.fill();

    this.ctx.restore();

    if (stroke) {
      if (shape === 'circle') {
        const cr = typeof options.radius === 'number' ? options.radius : Math.min(width, height) / 2;
        this.circle({ x, y, radius: cr, stroke, lineWidth });
      } else {
        this.rect({ x: rx, y: ry, width, height, radius, stroke, lineWidth, anchor: 'top-left' });
      }
    }
    return this;
  }

  traceRect(options = {}) {
    const {
      x = 0,
      y = 0,
      width = 100,
      height = 100,
      radius = 0,
      progress = 1,
      stroke = '#ffffff',
      lineWidth = 2,
      anchor = 'top-left',
    } = options;

    const p = Math.max(0, Math.min(1, progress));
    if (p <= 0) return this;

    let rx = x;
    let ry = y;
    if (anchor === 'center') {
      rx = x - width / 2;
      ry = y - height / 2;
    }

    const safeR = Math.min(Math.max(0, radius), width / 2, height / 2);
    const perimeter = Math.max(1, 2 * (width + height - 4 * safeR) + 2 * Math.PI * safeR);

    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.setLineDash([perimeter * p, perimeter + 1]);
    this.ctx.beginPath();
    this.ctx.roundRect(rx, ry, width, height, safeR);
    this.ctx.stroke();
    this.ctx.restore();
    return this;
  }

  traceCircle(options = {}) {
    const {
      x = 0,
      y = 0,
      radius = 50,
      progress = 1,
      stroke = '#ffffff',
      lineWidth = 2,
      startAngle = -Math.PI / 2,
      clockwise = true,
    } = options;

    const p = Math.max(0, Math.min(1, progress));
    if (p <= 0) return this;

    const totalAngle = Math.PI * 2 * p;
    const endAngle = clockwise ? startAngle + totalAngle : startAngle - totalAngle;

    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, startAngle, endAngle, !clockwise);
    this.ctx.stroke();
    this.ctx.restore();
    return this;
  }

  callout(options = {}) {
    const {
      fromX = 0,
      fromY = 0,
      toX = 0,
      toY = 0,
      text = '',
      color = '#a3e635',
      textColor = '#ffffff',
      fontFamily = 'Inter',
      fontSize = 24,
      fontWeight = 800,
      lineWidth = 4,
      scale = 1,
      ping = true,
      pingRadius = 16,
      cardBackground = 'rgba(15, 23, 42, 0.94)',
    } = options;

    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / length;
    const ny = dy / length;
    const head = 22;
    const arrowBaseX = toX - nx * head;
    const arrowBaseY = toY - ny * head;

    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(arrowBaseX, arrowBaseY);
    this.ctx.stroke();

    const sideX = -ny;
    const sideY = nx;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(arrowBaseX + sideX * head * 0.55, arrowBaseY + sideY * head * 0.55);
    this.ctx.lineTo(arrowBaseX - sideX * head * 0.55, arrowBaseY - sideY * head * 0.55);
    this.ctx.closePath();
    this.ctx.fill();

    if (ping) {
      this.circle({
        x: toX,
        y: toY,
        radius: pingRadius,
        stroke: color,
        lineWidth: 3,
      });
    }

    if (text) {
      this.ctx.save();
      this.ctx.translate(fromX, fromY);
      this.ctx.scale(scale, scale);
      this.ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
      const textWidth = this.ctx.measureText(text).width;
      const cardWidth = Math.max(140, textWidth + 52);
      const cardHeight = fontSize * 2.25;

      this.rect({
        x: 0,
        y: 0,
        width: cardWidth,
        height: cardHeight,
        radius: 16,
        fill: cardBackground,
        stroke: color,
        lineWidth: 2,
        anchor: 'center',
      });

      this.text(text, {
        x: 0,
        y: 1,
        size: fontSize,
        weight: fontWeight,
        family: fontFamily,
        color: textColor,
        align: 'center',
        baseline: 'middle',
      });
      this.ctx.restore();
    }

    this.ctx.restore();
    return this;
  }

  counter(options = {}) {
    const {
      x = 0,
      y = 0,
      value = 0,
      decimals = 0,
      prefix = '',
      suffix = '',
      label = '',
      labelColor = '#facc15',
      labelSize = 18,
      valueColor = '#ffffff',
      valueSize = 74,
      fontFamily = 'Inter',
      underline = true,
      underlineColor = '#facc15',
      underlineWidth = null,
      underlineThickness = 5,
    } = options;

    const rounded = Number(value.toFixed(Math.round(decimals)));
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: Math.round(decimals),
      maximumFractionDigits: Math.round(decimals),
    }).format(rounded);
    const display = `${prefix}${formatted}${suffix}`;

    this.ctx.save();
    this.ctx.translate(x, y);

    if (label) {
      this.text(label.toUpperCase(), {
        x: 0,
        y: -valueSize * 0.72,
        size: labelSize,
        weight: 800,
        family: fontFamily,
        color: labelColor,
        align: 'center',
        baseline: 'middle',
      });
    }

    this.text(display, {
      x: 0,
      y: 4,
      size: valueSize,
      weight: 900,
      family: fontFamily,
      color: valueColor,
      align: 'center',
      baseline: 'middle',
    });

    if (underline) {
      this.ctx.font = `900 ${valueSize}px "${fontFamily}", sans-serif`;
      const numW = this.ctx.measureText(display).width;
      const w = underlineWidth !== null ? underlineWidth : Math.min(390, numW * 0.78);
      const uy = valueSize * 0.76;
      this.ctx.strokeStyle = underlineColor;
      this.ctx.lineWidth = underlineThickness;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(-w / 2, uy);
      this.ctx.lineTo(w / 2, uy);
      this.ctx.stroke();
    }

    this.ctx.restore();
    return this;
  }

  windowBar(options = {}) {
    const {
      x = 0,
      y = 0,
      width = 500,
      height = 36,
      title = '',
      controls = true,
      background = '#1e293b',
      border = '#334155',
      titleColor = '#94a3b8',
      radius = [8, 8, 0, 0],
      anchor = 'top-left',
    } = options;

    let rx = x;
    let ry = y;
    if (anchor === 'center') {
      rx = x - width / 2;
      ry = y - height / 2;
    }

    this.ctx.save();
    this.ctx.fillStyle = background;
    this.ctx.beginPath();
    this.ctx.roundRect(rx, ry, width, height, radius);
    this.ctx.fill();

    if (border) {
      this.ctx.strokeStyle = border;
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    if (controls) {
      const dotRadius = 5;
      const dotSpacing = 16;
      const startX = rx + 18;
      const centerY = ry + height / 2;
      const colors = ['#ef4444', '#facc15', '#4ade80'];
      colors.forEach((c, i) => {
        this.ctx.fillStyle = c;
        this.ctx.beginPath();
        this.ctx.arc(startX + i * dotSpacing, centerY, dotRadius, 0, Math.PI * 2);
        this.ctx.fill();
      });
    }

    if (title) {
      this.text(title, {
        x: rx + width / 2,
        y: ry + height / 2,
        size: Math.max(11, Math.round(height * 0.4)),
        weight: 600,
        color: titleColor,
        align: 'center',
        baseline: 'middle',
      });
    }

    this.ctx.restore();
    return this;
  }

  cornerBrackets(options = {}) {
    const {
      x = 0,
      y = 0,
      width = 200,
      height = 150,
      length = 40,
      progress = 1,
      stroke = '#ffffff',
      lineWidth = 3,
      anchor = 'top-left',
    } = options;

    const p = Math.max(0, Math.min(1, progress));
    if (p <= 0) return this;

    let rx = x;
    let ry = y;
    if (anchor === 'center') {
      rx = x - width / 2;
      ry = y - height / 2;
    }

    const armLen = length * p;

    this.ctx.save();
    this.ctx.strokeStyle = stroke;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'miter';
    this.ctx.setLineDash([]);

    const corners = [
      [rx, ry, 1, 1],
      [rx + width, ry, -1, 1],
      [rx, ry + height, 1, -1],
      [rx + width, ry + height, -1, -1],
    ];

    for (const [px, py, hx, vy] of corners) {
      this.ctx.beginPath();
      this.ctx.moveTo(px, py);
      this.ctx.lineTo(px + hx * armLen, py);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(px, py);
      this.ctx.lineTo(px, py + vy * armLen);
      this.ctx.stroke();
    }

    this.ctx.restore();
    return this;
  }

}

export const CanvasKit = DrawContext;
export function createDrawContext(ctx, options = {}) {
  return new DrawContext(ctx, options);
}

// ─── Motion Canvas-style Scene Graph Nodes ────────────────────────────────────

export class CanvasNode {
  x = 0;
  y = 0;
  scale = 1;
  rotation = 0;
  opacity = 1;
  visible = true;
  /** @type {CanvasNode[]} */
  children = [];
  /** @type {CanvasNode | null} */
  parent = null;

  constructor(options = {}) {
    Object.assign(this, options);
  }

  add(...children) {
    for (const child of children) {
      if (child.parent) child.parent.remove(child);
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }

  remove(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
    }
    return this;
  }

  render(draw) {
    if (!this.visible || this.opacity <= 0) return;
    draw.isolate(() => {
      const effX = typeof this.x === 'function' ? this.x() : this.x;
      const effY = typeof this.y === 'function' ? this.y() : this.y;
      const effScale = typeof this.scale === 'function' ? this.scale() : this.scale;
      const effRot = typeof this.rotation === 'function' ? this.rotation() : this.rotation;
      const effAlpha = typeof this.opacity === 'function' ? this.opacity() : this.opacity;

      draw.translate(effX, effY);
      if (effRot) draw.rotate(effRot);
      if (effScale !== 1) draw.scale(effScale);
      if (effAlpha !== 1) draw.alpha(effAlpha);

      this.drawSelf(draw);

      for (const child of this.children) {
        child.render(draw);
      }
    });
  }

  drawSelf(draw) {
    // Override in subclasses
  }
}

export class RectNode extends CanvasNode {
  width = 100;
  height = 100;
  radius = 0;
  fill = null;
  stroke = null;
  lineWidth = 1;
  anchor = 'center';

  constructor(options = {}) {
    super();
    Object.assign(this, options);
  }

  drawSelf(draw) {
    const w = typeof this.width === 'function' ? this.width() : this.width;
    const h = typeof this.height === 'function' ? this.height() : this.height;
    const r = typeof this.radius === 'function' ? this.radius() : this.radius;
    const f = typeof this.fill === 'function' ? this.fill() : this.fill;
    const s = typeof this.stroke === 'function' ? this.stroke() : this.stroke;

    draw.rect({
      x: 0,
      y: 0,
      width: w,
      height: h,
      radius: r,
      fill: f,
      stroke: s,
      lineWidth: this.lineWidth,
      anchor: this.anchor,
    });
  }
}

export class TextNode extends CanvasNode {
  text = '';
  size = 16;
  weight = 400;
  family = 'sans-serif';
  color = '#ffffff';
  align = 'center';
  baseline = 'middle';

  constructor(options = {}) {
    super();
    Object.assign(this, options);
  }

  drawSelf(draw) {
    const txt = typeof this.text === 'function' ? this.text() : this.text;
    const c = typeof this.color === 'function' ? this.color() : this.color;
    draw.text(txt, {
      x: 0,
      y: 0,
      size: this.size,
      weight: this.weight,
      family: this.family,
      color: c,
      align: this.align,
      baseline: this.baseline,
    });
  }
}

export class CircleNode extends CanvasNode {
  radius = 50;
  fill = null;
  stroke = null;
  lineWidth = 1;

  constructor(options = {}) {
    super();
    Object.assign(this, options);
  }

  drawSelf(draw) {
    const r = typeof this.radius === 'function' ? this.radius() : this.radius;
    const f = typeof this.fill === 'function' ? this.fill() : this.fill;
    const s = typeof this.stroke === 'function' ? this.stroke() : this.stroke;
    draw.circle({
      x: 0,
      y: 0,
      radius: r,
      fill: f,
      stroke: s,
      lineWidth: this.lineWidth,
    });
  }
}
