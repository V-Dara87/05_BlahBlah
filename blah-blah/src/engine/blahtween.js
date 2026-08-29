/**
 * BlahTween - A deterministic, timeline-compatible motion & tweening engine
 * inspired by Unity's DOTween with fluent chaining and easing functions.
 */

export const Ease = {
  Linear: (t) => t,
  InQuad: (t) => t * t,
  OutQuad: (t) => t * (2 - t),
  InOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  InCubic: (t) => t * t * t,
  OutCubic: (t) => --t * t * t + 1,
  InOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  InSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  OutSine: (t) => Math.sin((t * Math.PI) / 2),
  InOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  InBack: (t) => {
    const s = 1.70158;
    return t * t * ((s + 1) * t - s);
  },
  OutBack: (t) => {
    const s = 1.70158;
    return --t * t * ((s + 1) * t + s) + 1;
  },
  InOutBack: (t) => {
    const s = 1.70158 * 1.525;
    return (t *= 2) < 1
      ? 0.5 * (t * t * ((s + 1) * t - s))
      : 0.5 * ((t -= 2) * t * ((s + 1) * t + s) + 2);
  },
  InBounce: (t) => 1 - Ease.OutBounce(1 - t),
  OutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  },
  InOutBounce: (t) =>
    t < 0.5 ? (1 - Ease.OutBounce(1 - 2 * t)) / 2 : (1 + Ease.OutBounce(2 * t - 1)) / 2,
  InElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return -Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1.1) * 5 * Math.PI) / 0.4);
  },
  OutElastic: (t) => {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin(((t - 0.1) * 5 * Math.PI) / 0.4) + 1;
  },
};

export const LoopType = {
  Restart: 'restart',
  Yoyo: 'yoyo',
  Incremental: 'incremental',
};

class TweenTrack {
  constructor(property, targetVal, duration, startVal = null) {
    this.property = property; // 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'scale', 'opacity'
    this.targetVal = targetVal;
    this.startVal = startVal;
    this.duration = Math.max(0.001, duration);
    this.delay = 0;
    this.easeFn = Ease.OutQuad;
    this.easeName = 'OutQuad';
    this.loops = 1; // 1 = play once, -1 = infinite
    this.loopType = LoopType.Restart;
    this.startTimeOffset = 0;
  }

  SetEase(ease) {
    if (typeof ease === 'string' && Ease[ease]) {
      this.easeFn = Ease[ease];
      this.easeName = ease;
    } else if (typeof ease === 'function') {
      this.easeFn = ease;
      this.easeName = 'Custom';
    }
    return this;
  }

  SetDelay(delay) {
    this.delay = Math.max(0, delay);
    return this;
  }

  SetLoops(loops, loopType = LoopType.Restart) {
    this.loops = loops;
    this.loopType = loopType;
    return this;
  }

  // Calculate value at specific local time relative to clip start
  evaluate(localTime, initialVal) {
    const fromVal = this.startVal !== null ? this.startVal : initialVal;
    const effectiveTime = localTime - this.startTimeOffset - this.delay;

    if (effectiveTime <= 0) {
      return fromVal;
    }

    const singleDur = this.duration;
    let progress = 0;

    if (this.loops === -1 || this.loops > 1) {
      const currentLoopIndex = Math.floor(effectiveTime / singleDur);
      if (this.loops !== -1 && currentLoopIndex >= this.loops) {
        // Tween finished
        if (this.loopType === LoopType.Yoyo && this.loops % 2 === 0) {
          progress = 0;
        } else {
          progress = 1;
        }
      } else {
        const loopLocalTime = effectiveTime % singleDur;
        progress = loopLocalTime / singleDur;
        if (this.loopType === LoopType.Yoyo && currentLoopIndex % 2 === 1) {
          progress = 1 - progress;
        }
      }
    } else {
      progress = Math.min(1, effectiveTime / singleDur);
    }

    const easedProgress = this.easeFn(progress);

    if (typeof fromVal === 'number' && typeof this.targetVal === 'number') {
      return fromVal + (this.targetVal - fromVal) * easedProgress;
    }
    return this.targetVal;
  }
}

export class BlahTweenSequence {
  constructor() {
    this.tracks = [];
    this.currentTimePointer = 0;
  }

  // Append a tween after previous tweens in sequence
  Append(tweenTrack) {
    tweenTrack.startTimeOffset = this.currentTimePointer;
    this.tracks.push(tweenTrack);
    this.currentTimePointer += tweenTrack.delay + tweenTrack.duration;
    return this;
  }

  // Join runs simultaneously with the previous action
  Join(tweenTrack) {
    const lastTrack = this.tracks[this.tracks.length - 1];
    tweenTrack.startTimeOffset = lastTrack ? lastTrack.startTimeOffset : 0;
    this.tracks.push(tweenTrack);
    return this;
  }

  AppendInterval(intervalSec) {
    this.currentTimePointer += intervalSec;
    return this;
  }
}

/**
 * Main BlahTween API attached to GameObject Transforms
 */
export class BlahTweenContext {
  constructor(transform) {
    this.transform = transform;
    this.tracks = [];
  }

  DOMove(x, y, duration) {
    const tx = new TweenTrack('x', x, duration, this.transform.x);
    const ty = new TweenTrack('y', y, duration, this.transform.y);
    this.tracks.push(tx, ty);
    return {
      SetEase: (e) => { tx.SetEase(e); ty.SetEase(e); return this; },
      SetDelay: (d) => { tx.SetDelay(d); ty.SetDelay(d); return this; },
      SetLoops: (l, lt) => { tx.SetLoops(l, lt); ty.SetLoops(l, lt); return this; }
    };
  }

  DOMoveX(x, duration) {
    const t = new TweenTrack('x', x, duration, this.transform.x);
    this.tracks.push(t);
    return t;
  }

  DOMoveY(y, duration) {
    const t = new TweenTrack('y', y, duration, this.transform.y);
    this.tracks.push(t);
    return t;
  }

  DORotate(degrees, duration) {
    const t = new TweenTrack('rotation', degrees, duration, this.transform.rotation || 0);
    this.tracks.push(t);
    return t;
  }

  DOScale(scale, duration) {
    const sx = new TweenTrack('scaleX', scale, duration, this.transform.scaleX ?? 1);
    const sy = new TweenTrack('scaleY', scale, duration, this.transform.scaleY ?? 1);
    this.tracks.push(sx, sy);
    return {
      SetEase: (e) => { sx.SetEase(e); sy.SetEase(e); return this; },
      SetDelay: (d) => { sx.SetDelay(d); sy.SetDelay(d); return this; },
      SetLoops: (l, lt) => { sx.SetLoops(l, lt); sy.SetLoops(l, lt); return this; }
    };
  }

  DOScaleX(scaleX, duration) {
    const t = new TweenTrack('scaleX', scaleX, duration, this.transform.scaleX ?? 1);
    this.tracks.push(t);
    return t;
  }

  DOScaleY(scaleY, duration) {
    const t = new TweenTrack('scaleY', scaleY, duration, this.transform.scaleY ?? 1);
    this.tracks.push(t);
    return t;
  }

  DOFade(opacity, duration) {
    const t = new TweenTrack('opacity', opacity, duration, this.transform.opacity ?? 1);
    this.tracks.push(t);
    return t;
  }

  DOShakePosition(intensity = 20, duration = 1) {
    const t = new TweenTrack('shake', intensity, duration, 0);
    this.tracks.push(t);
    return t;
  }

  DOPunchPosition(punch = 30, duration = 0.6) {
    const t = new TweenTrack('punch', punch, duration, 0);
    t.SetEase(Ease.OutElastic);
    this.tracks.push(t);
    return t;
  }

  // Evaluate all active tweens at localTime
  evaluate(localTime, baseTransform) {
    const result = { ...baseTransform };

    for (const track of this.tracks) {
      if (track.property === 'x') {
        result.x = track.evaluate(localTime, baseTransform.x);
      } else if (track.property === 'y') {
        result.y = track.evaluate(localTime, baseTransform.y);
      } else if (track.property === 'rotation') {
        result.rotation = track.evaluate(localTime, baseTransform.rotation || 0);
      } else if (track.property === 'scaleX') {
        result.scaleX = track.evaluate(localTime, baseTransform.scaleX ?? 1);
      } else if (track.property === 'scaleY') {
        result.scaleY = track.evaluate(localTime, baseTransform.scaleY ?? 1);
      } else if (track.property === 'opacity') {
        result.opacity = track.evaluate(localTime, baseTransform.opacity ?? 1);
      } else if (track.property === 'shake') {
        const val = track.evaluate(localTime, 0);
        if (val > 0) {
          result.x += (Math.random() * 2 - 1) * val;
          result.y += (Math.random() * 2 - 1) * val;
        }
      } else if (track.property === 'punch') {
        const val = track.evaluate(localTime, 0);
        result.y -= val;
      }
    }

    return result;
  }
}

export const BlahTween = {
  Sequence: () => new BlahTweenSequence(),
};
