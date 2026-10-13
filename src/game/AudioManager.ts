import { clamp } from '../physics/math';

export interface EngineSoundInput {
  rpm: number;
  maxRpm: number;
  throttle: number;
  speed: number;
  /** Combined tyre slip intensity (m/s). */
  slip: number;
  /** Fraction of wheels on the ground. */
  grounded: number;
  /** Engine firing pulses per revolution (cylinders / 2). */
  pulses: number;
}

/**
 * Procedural Web Audio (no recorded assets). Every method is a no-op if audio is
 * unavailable or disabled, so the game is fully playable without sound.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: {
    oscA: OscillatorNode;
    oscB: OscillatorNode;
    sub: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
    slipGain: GainNode;
    slipFilter: BiquadFilterNode;
    windGain: GainNode;
  } | null = null;
  private volume = 0.7;
  private muted = false;
  private engineOn = false;

  /** Must be called from a user gesture (key press / click) to satisfy autoplay rules. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number, muted: boolean): void {
    this.volume = clamp(v, 0, 1);
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.8, this.ctx.currentTime, 0.05);
  }

  /** Pause/resume all sound (game paused, tab hidden). */
  suspend(on: boolean): void {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private noiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  startEngine(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.engine) {
      this.engineOn = true;
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const oscA = ctx.createOscillator();
    oscA.type = 'sawtooth';
    const oscB = ctx.createOscillator();
    oscB.type = 'square';
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    const gB = ctx.createGain();
    gB.gain.value = 0.35;
    const gS = ctx.createGain();
    gS.gain.value = 0.6;
    oscA.connect(shaper);
    oscB.connect(gB).connect(shaper);
    sub.connect(gS).connect(filter);
    shaper.connect(filter);
    filter.connect(gain).connect(this.master);
    oscA.start();
    oscB.start();
    sub.start();

    // Gravel/tyre slip noise and wind/rolling noise.
    const slipGain = ctx.createGain();
    slipGain.gain.value = 0;
    const slipFilter = ctx.createBiquadFilter();
    slipFilter.type = 'bandpass';
    slipFilter.frequency.value = 700;
    slipFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const n1 = this.noiseSource();
    const n2 = this.noiseSource();
    if (n1 && n2) {
      n1.connect(slipFilter).connect(slipGain).connect(this.master);
      n2.connect(windFilter).connect(windGain).connect(this.master);
      n1.start();
      n2.start(0, 0.7);
    }
    this.engine = { oscA, oscB, sub, filter, gain, slipGain, slipFilter, windGain };
    this.engineOn = true;
  }

  stopEngine(): void {
    this.engineOn = false;
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(0, t, 0.08);
    this.engine.slipGain.gain.setTargetAtTime(0, t, 0.08);
    this.engine.windGain.gain.setTargetAtTime(0, t, 0.08);
  }

  /** Engine pitch follows RPM; loudness and brightness follow throttle. */
  updateEngine(e: EngineSoundInput): void {
    if (!this.engine || !this.ctx || !this.engineOn) return;
    const t = this.ctx.currentTime;
    const f = Math.max(18, (e.rpm / 60) * e.pulses);
    const en = this.engine;
    en.oscA.frequency.setTargetAtTime(f, t, 0.02);
    en.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.02);
    en.sub.frequency.setTargetAtTime(f * 0.25, t, 0.03);
    const load = 0.35 + 0.65 * e.throttle;
    en.filter.frequency.setTargetAtTime(260 + 1900 * load * (0.4 + 0.6 * e.rpm / e.maxRpm), t, 0.04);
    en.gain.gain.setTargetAtTime(0.06 + 0.12 * load, t, 0.05);
    const slip = clamp((e.slip - 1.2) / 6, 0, 1) * e.grounded;
    en.slipGain.gain.setTargetAtTime(slip * 0.25, t, 0.05);
    en.slipFilter.frequency.setTargetAtTime(500 + slip * 600, t, 0.05);
    en.windGain.gain.setTargetAtTime(clamp(e.speed / 45, 0, 1) * 0.12 + 0.02 * e.grounded * clamp(e.speed / 10, 0, 1), t, 0.1);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  private burst(start: number, dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    const s = this.noiseSource();
    if (!ctx || !s || !this.master) return;
    s.loop = false;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(start, Math.random());
    s.stop(start + dur + 0.05);
  }

  impact(strength: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = clamp(strength / 6, 0.05, 1);
    this.burst(t, 0.25 + v * 0.2, 0.5 * v, 900);
    this.tone(90, t, 0.25, 'sine', 0.6 * v, 45);
  }

  collect(kind: 'hourglass' | 'sign' | 'turbo' | 'question'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'hourglass') {
      [784, 988, 1319].forEach((f, i) => this.tone(f, t + i * 0.07, 0.25, 'triangle', 0.25));
    } else if (kind === 'sign' || kind === 'question') {
      this.tone(1046, t, 0.3, 'sine', 0.3);
      this.tone(1568, t + 0.05, 0.35, 'sine', 0.18);
    } else {
      this.burst(t, 0.6, 0.35, 1800, 'bandpass');
      this.tone(220, t, 0.6, 'sawtooth', 0.12, 880);
    }
  }

  answer(correct: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (correct) {
      this.tone(660, t, 0.18, 'triangle', 0.3);
      this.tone(990, t + 0.14, 0.3, 'triangle', 0.3);
    } else {
      this.tone(220, t, 0.45, 'square', 0.15, 140);
    }
  }

  questionOpen(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(880, t, 0.12, 'sine', 0.2);
    this.tone(880, t + 0.16, 0.12, 'sine', 0.2);
  }

  countdown(final: boolean): void {
    if (!this.ctx) return;
    this.tone(final ? 880 : 440, this.ctx.currentTime, final ? 0.55 : 0.22, 'square', 0.18);
  }

  finish(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.13, 0.4, 'triangle', 0.28));
    this.tone(1046, t + 0.55, 0.9, 'square', 0.1);
  }

  click(): void {
    if (!this.ctx) return;
    this.tone(600, this.ctx.currentTime, 0.06, 'square', 0.08);
  }

  notice(): void {
    if (!this.ctx) return;
    this.tone(523, this.ctx.currentTime, 0.12, 'triangle', 0.15);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.engine = null;
  }
}
