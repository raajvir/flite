/**
 * Synthesised sound (no audio files):
 *  - whine: a smooth tone whose pitch rises linearly with road speed
 *  - skid:  filtered noise whose volume follows how hard the tires are sliding
 *
 * Browsers only allow audio after a user gesture, so call start() from a key/click handler.
 */
import type { CarState } from '../sim/types';

export const SOUND_TUNING = {
  masterVolume: 0.5,
  whineBaseHz: 70, // pitch at standstill
  whineHzPerMps: 8.5, // pitch rise per m/s (linear)
  whineIdleGain: 0.05,
  whineThrottleGain: 0.09,
  whineFilterHz: 2200,
  skidStart: 1.1, // combined slip (1 = tire peak) where squeal starts
  skidFull: 2.5, // combined slip for full volume
  skidMaxGain: 0.32,
  skidMinSpeed: 1.5, // m/s, contact-patch sliding speed needed for any skid sound
  skidBandHz: 1100,
  smoothing: 0.04, // s, time constant for volume/pitch changes
};

export interface SlipInfo {
  peakSlipRatio: number;
  tanPeakSlipAngle: number;
  wheelRadius: number;
}

export class CarSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private whineOsc!: OscillatorNode;
  private whineOsc2!: OscillatorNode;
  private whineGain!: GainNode;
  private skidGain!: GainNode;
  private skidFilter!: BiquadFilterNode;
  muted = false;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const t = SOUND_TUNING;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = t.masterVolume;
    this.master.connect(ctx.destination);

    // Whine: sawtooth + quieter octave, softened by a low-pass filter.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = t.whineFilterHz;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'sawtooth';
    this.whineOsc2 = ctx.createOscillator();
    this.whineOsc2.type = 'triangle';
    const octaveGain = ctx.createGain();
    octaveGain.gain.value = 0.5;
    this.whineOsc.connect(filter);
    this.whineOsc2.connect(octaveGain).connect(filter);
    filter.connect(this.whineGain).connect(this.master);
    this.whineOsc.start();
    this.whineOsc2.start();

    // Skid: looping white noise through a band-pass filter.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = t.skidBandHz;
    this.skidFilter.Q.value = 1.2;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    src.connect(this.skidFilter).connect(this.skidGain).connect(this.master);
    src.start();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : SOUND_TUNING.masterVolume, this.ctx.currentTime, 0.02);
  }

  update(s: CarState, throttle: number, slip: SlipInfo): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = SOUND_TUNING;
    const now = ctx.currentTime;
    const speed = Math.hypot(s.u, s.v);

    const hz = t.whineBaseHz + t.whineHzPerMps * speed;
    this.whineOsc.frequency.setTargetAtTime(hz, now, t.smoothing);
    this.whineOsc2.frequency.setTargetAtTime(hz * 2, now, t.smoothing);
    this.whineGain.gain.setTargetAtTime(t.whineIdleGain + t.whineThrottleGain * throttle, now, t.smoothing);

    // Loudest sliding wheel decides the skid volume.
    let skid = 0;
    for (const w of s.wheels) {
      const rho = Math.hypot(w.kappa / slip.peakSlipRatio, w.tanAlpha / slip.tanPeakSlipAngle);
      const slideSpeed = Math.abs(w.omega * slip.wheelRadius - s.u) + Math.abs(w.tanAlpha) * Math.abs(s.u);
      if (slideSpeed < t.skidMinSpeed) continue;
      skid = Math.max(skid, Math.min(1, Math.max(0, (rho - t.skidStart) / (t.skidFull - t.skidStart))));
    }
    this.skidGain.gain.setTargetAtTime(skid * t.skidMaxGain, now, t.smoothing);
    this.skidFilter.frequency.setTargetAtTime(t.skidBandHz + speed * 4, now, t.smoothing);
  }
}
