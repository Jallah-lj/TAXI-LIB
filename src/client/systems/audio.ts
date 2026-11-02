import type { SimulationState } from '../../shared/simulation';
import type { Point2 } from '../../shared/world';

interface SirenVoice { gain: GainNode; panner: StereoPannerNode }

export function sirenGainForDistance(distance: number) {
  if (!Number.isFinite(distance) || distance >= 135) return 0;
  const attenuation = 1 - Math.max(0, distance) / 135;
  return attenuation * attenuation * 0.04;
}

export function volumePercentToGain(volumePercent: number) {
  const percent = Number.isFinite(volumePercent) ? Math.max(0, Math.min(100, volumePercent)) : 0;
  return percent / 100;
}

export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private engineOsc?: OscillatorNode;
  private rainGain?: GainNode;
  private oceanGain?: GainNode;
  private readonly sirenVoices: SirenVoice[] = [];
  private volume = 0.65;

  async start() {
    if (this.context) { await this.context.resume(); return; }
    const AudioContextClass = window.AudioContext;
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);

    this.engineOsc = this.context.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0;
    const engineFilter = this.context.createBiquadFilter();
    engineFilter.type = 'lowpass'; engineFilter.frequency.value = 320;
    this.engineOsc.connect(engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    const noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 3, this.context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    const createNoise = (frequency: number, gain: number) => {
      const source = this.context!.createBufferSource();
      source.buffer = noiseBuffer; source.loop = true;
      const filter = this.context!.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = frequency;
      const node = this.context!.createGain(); node.gain.value = gain;
      source.connect(filter).connect(node).connect(this.master!); source.start();
      return node;
    };
    this.rainGain = createNoise(4200, 0);
    this.oceanGain = createNoise(650, 0.018);

    for (let index = 0; index < 2; index += 1) {
      const carrier = this.context.createOscillator();
      carrier.type = 'triangle';
      carrier.frequency.value = 780 + index * 45;
      const sweep = this.context.createOscillator();
      sweep.type = 'sine';
      sweep.frequency.value = 0.62 + index * 0.07;
      const sweepDepth = this.context.createGain();
      sweepDepth.gain.value = 270;
      sweep.connect(sweepDepth).connect(carrier.frequency);
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 1350;
      const gain = this.context.createGain(); gain.gain.value = 0;
      const panner = this.context.createStereoPanner();
      carrier.connect(filter).connect(gain).connect(panner).connect(this.master);
      carrier.start(); sweep.start();
      this.sirenVoices.push({ gain, panner });
    }
  }

  update(speed: number, driving: boolean, simulation: SimulationState, coastDistance: number) {
    if (!this.context || !this.engineGain || !this.engineOsc || !this.rainGain || !this.oceanGain) return;
    const time = this.context.currentTime;
    this.engineGain.gain.setTargetAtTime(driving ? 0.022 + Math.min(0.035, Math.abs(speed) * 0.0015) : 0, time, 0.1);
    this.engineOsc.frequency.setTargetAtTime(42 + Math.abs(speed) * 4.5, time, 0.08);
    this.rainGain.gain.setTargetAtTime(simulation.rainIntensity * 0.07, time, 0.5);
    this.oceanGain.gain.setTargetAtTime(0.006 + Math.max(0, 1 - coastDistance / 160) * 0.035, time, 0.5);
  }

  updateSirens(sources: Point2[], listener: Point2, cameraYaw: number) {
    if (!this.context) return;
    const sorted = sources.map((source) => ({ source, distance: Math.hypot(source.x - listener.x, source.z - listener.z) }))
      .sort((a, b) => a.distance - b.distance);
    const now = this.context.currentTime;
    for (let index = 0; index < this.sirenVoices.length; index += 1) {
      const voice = this.sirenVoices[index]!;
      const nearest = sorted[index];
      if (!nearest) {
        voice.gain.gain.setTargetAtTime(0, now, 0.08);
        continue;
      }
      const dx = nearest.source.x - listener.x;
      const dz = nearest.source.z - listener.z;
      const right = dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw);
      const pan = nearest.distance > 0.01 ? Math.max(-1, Math.min(1, right / nearest.distance)) : 0;
      voice.panner.pan.setTargetAtTime(pan, now, 0.08);
      voice.gain.gain.setTargetAtTime(sirenGainForDistance(nearest.distance), now, 0.1);
    }
  }

  feedback(kind: 'success' | 'click' = 'click') {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'success' ? 520 : 360, this.context.currentTime);
    if (kind === 'success') oscillator.frequency.exponentialRampToValueAtTime(780, this.context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.035, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.16);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(); oscillator.stop(this.context.currentTime + 0.17);
  }

  setVolume(volumePercent: number) {
    this.volume = volumePercentToGain(volumePercent);
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.08);
  }
}
