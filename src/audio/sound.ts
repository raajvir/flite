/**
 * Synthesised sound (no audio files):
 *  - whine: a soft tone whose pitch rises linearly with road speed
 *  - skid:  filtered noise whose volume follows how hard the tires are sliding
 *
 * Browsers only allow audio after a user gesture, so call start() from a key/click handler.
 */
import type { CarParams } from '../sim/params';
import type { CarState } from '../sim/types';
import { slideIntensity } from '../render/slide';

export const SOUND_TUNING = {
  masterVolume: 0.5,
  whineBaseHz: 55, // pitch at standstill
  whineHzPerMps: 4.5, // pitch rise per m/s (linear): ~460 Hz at 320 km/h
  whineIdleGain: 0.03,
  whineThrottleGain: 0.05,
  whineFilterHz: 900, // low-pass: takes the harsh edge off
  skidMaxGain: 0.32,
  skidBandHz: 1100,
  smoothing: 0.04, // s, time constant for volume/pitch changes
};

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

    // Whine: mellow triangle + a sine an octave below for body, through a low-pass filter.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = t.whineFilterHz;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc = ctx.createOscillator();
    this.whineOsc.type = 'triangle';
    this.whineOsc2 = ctx.createOscillator();
    this.whineOsc2.type = 'sine';
    const octaveGain = ctx.createGain();
    octaveGain.gain.value = 0.8;
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

  update(s: CarState, throttle: number, p: CarParams): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = SOUND_TUNING;
    const now = ctx.currentTime;
    const speed = Math.hypot(s.u, s.v);

    const hz = t.whineBaseHz + t.whineHzPerMps * speed;
    this.whineOsc.frequency.setTargetAtTime(hz, now, t.smoothing);
    this.whineOsc2.frequency.setTargetAtTime(hz * 0.5, now, t.smoothing);
    this.whineGain.gain.setTargetAtTime(t.whineIdleGain + t.whineThrottleGain * throttle, now, t.smoothing);

    // Loudest sliding wheel decides the skid volume.
    let skid = 0;
    for (let i = 0; i < 4; i++) skid = Math.max(skid, slideIntensity(s, i, p));
    this.skidGain.gain.setTargetAtTime(skid * t.skidMaxGain, now, t.smoothing);
    this.skidFilter.frequency.setTargetAtTime(t.skidBandHz + speed * 4, now, t.smoothing);
  }
}
