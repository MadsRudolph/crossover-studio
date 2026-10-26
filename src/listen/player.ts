// The Web Audio graph of the Listen view:
//
//   source (pink / band noise / probe tone / sweep / track) -> input
//     input -> convolver A -> gain A --+
//     input -> convolver B -> gain B --+-> master volume -> limiter (-3 dB, 20:1) -> meter -> speakers
//
// Two convolver chains so a new IR (a design edit, Design/Snapshot/Flat, a muted unit) fades in over
// 40 ms while the old one fades out: no click, no gap. The AudioContext is created on the first play()
// (browsers only allow sound after a gesture) and closed by close().

import { SIGNAL_DBFS, logSweep, octaveEdges, pinkNoise } from "./noise";
import { IR_FS } from "./ir";

export type SourceKind = "pink" | "band-wm" | "band-mt" | "tone" | "sweep" | "track";

/** Crossfade between the two convolver chains (s). */
export const XFADE_S = 0.04;
export const VOLUME_MIN_DB = -60;
export const VOLUME_MAX_DB = 0;
export const SWEEP_S = 10;

export interface SourceSettings {
  kind: SourceKind;
  /** Centre of the band noise (Hz). */
  bandHz: number;
  /** Probe-tone frequency (Hz). */
  toneHz: number;
  /** Decoded user track (loops). */
  track: AudioBuffer | null;
}

type Ctor = typeof AudioContext;
const AudioCtx = (): Ctor | undefined =>
  typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext);

/** True when this browser/webview has Web Audio at all. */
export const audioSupported = (): boolean => !!AudioCtx();

const dbToGain = (db: number) => (db <= VOLUME_MIN_DB ? 0 : 10 ** (db / 20));

export class ListenPlayer {
  ctx: AudioContext | null = null;
  private input: GainNode | null = null;
  private conv: (ConvolverNode | null)[] = [null, null];
  private gains: GainNode[] = [];
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private active = 0;
  private ir: Float32Array | null = null;
  private irKey = "";
  private src: AudioScheduledSourceNode | null = null;
  private srcNodes: AudioNode[] = [];
  private osc: OscillatorNode | null = null;
  private band: [BiquadFilterNode, BiquadFilterNode] | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private settings: SourceSettings = { kind: "pink", bandHz: 1000, toneHz: 1000, track: null };
  private volumeDb = -20;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  playing = false;
  /** Context time at which the current source started (for the sweep read-out). */
  startedAt = 0;

  /** The context's sample rate once it exists, else the rate the IRs are built for by default. */
  get sampleRate(): number { return this.ctx?.sampleRate ?? IR_FS; }

  /** Create the context and the fixed part of the graph (first play only). */
  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const C = AudioCtx();
    if (!C) throw new Error("This window has no Web Audio support, so the design cannot be played.");
    let ctx: AudioContext;
    try { ctx = new C({ sampleRate: IR_FS, latencyHint: "interactive" }); }
    catch { ctx = new C(); }
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = dbToGain(this.volumeDb);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = 0.002; lim.release.value = 0.1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.gains = [ctx.createGain(), ctx.createGain()];
    this.gains[0].gain.value = 1; this.gains[1].gain.value = 0;
    for (const g of this.gains) g.connect(this.master);
    this.master.connect(lim); lim.connect(this.analyser); this.analyser.connect(ctx.destination);
    if (this.ir) this.mountIr(this.active, this.ir);
    return ctx;
  }

  /** A fresh convolver with the IR on chain i (the old one, if any, is disconnected). */
  private mountIr(i: number, ir: Float32Array) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ir.length, ctx.sampleRate);
    buf.copyToChannel(ir as Float32Array<ArrayBuffer>, 0);
    const c = ctx.createConvolver();
    c.normalize = false;                    // keep the calibrated level: no automatic scaling
    c.buffer = buf;
    this.input!.connect(c); c.connect(this.gains[i]);
    const old = this.conv[i];
    this.conv[i] = c;
    if (old) {
      // let the old tail finish under the fade, then drop it
      setTimeout(() => { try { this.input?.disconnect(old); old.disconnect(); } catch { /* already gone */ } }, (XFADE_S * 1000) + 400);
    }
  }

  /**
   * Play this IR. `key` identifies it, so asking for the same one again does nothing. The IR must be
   * at `sampleRate`. With sound running the switch is a 40 ms crossfade.
   */
  setIr(ir: Float32Array, key: string): void {
    if (key === this.irKey && this.ir) return;
    this.ir = ir; this.irKey = key;
    if (!this.ctx) return;
    const next = 1 - this.active, now = this.ctx.currentTime;
    this.mountIr(next, ir);
    for (const [i, to] of [[this.active, 0], [next, 1]] as const) {
      const g = this.gains[i].gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(to, now + XFADE_S);
    }
    this.active = next;
  }

  setVolumeDb(db: number): void {
    this.volumeDb = Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, db));
    if (!this.ctx || !this.master) return;
    const g = this.master.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(dbToGain(this.volumeDb), now, 0.015);
  }

  /** Change what is played. The tone frequency and band glide; a new kind restarts the source. */
  setSource(s: Partial<SourceSettings>): void {
    const prev = this.settings;
    this.settings = { ...prev, ...s };
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime, cur = this.settings;
    if (cur.kind !== prev.kind || (cur.kind === "track" && cur.track !== prev.track)) { this.startSource(); return; }
    if (this.osc && cur.toneHz !== prev.toneHz) this.osc.frequency.setTargetAtTime(cur.toneHz, now, 0.02);
    if (this.band && cur.bandHz !== prev.bandHz) {
      const [lo, hi] = octaveEdges(cur.bandHz);
      this.band[0].frequency.setTargetAtTime(lo, now, 0.05);
      this.band[1].frequency.setTargetAtTime(hi, now, 0.05);
    }
  }

  private buffer(name: "pink" | "sweep"): AudioBuffer {
    const ctx = this.ctx!, key = `${name}@${ctx.sampleRate}`;
    let b = this.buffers.get(key);
    if (!b) {
      const data = name === "pink" ? pinkNoise(ctx.sampleRate, 10) : logSweep(ctx.sampleRate, SWEEP_S, 20, 20000);
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(key, b);
    }
    return b;
  }

  private stopSource(): void {
    try { this.src?.stop(); } catch { /* never started */ }
    for (const n of this.srcNodes) { try { n.disconnect(); } catch { /* fine */ } }
    this.src = null; this.srcNodes = []; this.osc = null; this.band = null;
  }

  private startSource(): void {
    const ctx = this.ctx!, s = this.settings;
    this.stopSource();
    let src: AudioScheduledSourceNode, out: AudioNode;
    if (s.kind === "tone") {
      const o = ctx.createOscillator();
      o.type = "sine"; o.frequency.value = s.toneHz;
      const g = ctx.createGain();
      g.gain.value = 10 ** (SIGNAL_DBFS / 20) * Math.SQRT2;          // -12 dBFS RMS, like the noise
      o.connect(g);
      this.osc = o; src = o; out = g; this.srcNodes.push(o, g);
    } else {
      const b = ctx.createBufferSource();
      if (s.kind === "track") {
        // no file yet: stay silent until one is chosen (setSource starts it then)
        if (!s.track) { this.startedAt = ctx.currentTime; return; }
        b.buffer = s.track;
      } else b.buffer = this.buffer(s.kind === "sweep" ? "sweep" : "pink");
      b.loop = true;
      src = b; out = b; this.srcNodes.push(b);
      if (s.kind === "band-wm" || s.kind === "band-mt") {
        const [lo, hi] = octaveEdges(s.bandHz);
        const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = lo; hp.Q.value = Math.SQRT1_2;
        lp.type = "lowpass"; lp.frequency.value = hi; lp.Q.value = Math.SQRT1_2;
        b.connect(hp); hp.connect(lp);
        this.band = [hp, lp]; out = lp; this.srcNodes.push(hp, lp);
      }
    }
    out.connect(this.input!);
    src.start();
    this.src = src;
    this.startedAt = ctx.currentTime;
  }

  /** Start sound (creates the context on the first call; must run inside a user gesture). */
  async play(): Promise<void> {
    const ctx = this.ensure();
    this.startSource();
    this.playing = true;
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch { /* headless: stays suspended */ } }
  }

  stop(): void {
    this.stopSource();
    this.playing = false;
  }

  /** Peak of the output over the last analyser frame (dBFS), -Infinity when silent or not started. */
  peakDb(): number {
    if (!this.analyser) return -Infinity;
    if (!this.meterBuf) this.meterBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let m = 0;
    for (let i = 0; i < this.meterBuf.length; i++) m = Math.max(m, Math.abs(this.meterBuf[i]));
    return 20 * Math.log10(m);
  }

  /** Seconds since the current source started (for the sweep read-out). */
  elapsed(): number { return this.ctx && this.playing ? this.ctx.currentTime - this.startedAt : 0; }

  /** Decode an audio file. Uses the running context, or a short-lived one before the first play. */
  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    if (this.ctx) return this.ctx.decodeAudioData(data);
    const C = AudioCtx();
    if (!C) throw new Error("This window has no Web Audio support.");
    // an OfflineAudioContext decodes without needing a user gesture; resampled to the IR rate
    const off = new OfflineAudioContext(1, 1, IR_FS);
    return off.decodeAudioData(data);
  }

  /** Stop the sound and release the audio device. */
  async close(): Promise<void> {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null; this.input = null; this.master = null; this.analyser = null;
    this.conv = [null, null]; this.gains = []; this.buffers.clear();
    if (ctx && ctx.state !== "closed") { try { await ctx.close(); } catch { /* already closed */ } }
  }
}
