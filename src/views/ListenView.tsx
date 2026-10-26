// Listen view: hear the design before building it. The unit responses of the current design (or a
// snapshot) become impulse responses (src/listen/ir.ts) that a Web Audio convolver plays pink noise,
// band noise at a crossover, the probe tone, a sweep or the student's own track through. Units can be
// muted, soloed and inverted for listening only; the design is never edited here.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { FileAudio, Headphones, Play, Square, Upload } from "lucide-react";
import { Plot, type PlotSeries } from "../charts";
import { Button, Checkbox, EmptyState, Segmented, Slider, Switch, fmtFreq, layerOpen, type SegmentOption } from "../ui";
import { isTauri } from "../platform";
import { useStore } from "../state/store";
import type { UnitId } from "../types";
import { UNIT_IDS } from "../types";
import { IR_N, flatIr, irMagnitude, irsFromResults, mixIr, type IrSet, type UnitWeights } from "../listen/ir";
import { bandCentre, octaveEdges, sweepFrequency } from "../listen/noise";
import { ListenPlayer, SWEEP_S, VOLUME_MAX_DB, VOLUME_MIN_DB, audioSupported, type SourceKind } from "../listen/player";
import { Card, ViewHeader, crossoverLines, useProbe, useSize } from "./common";
import { TRACE_META } from "./data";
import "./listen.css";

type What = "design" | "snapshot" | "flat";

const SOURCES: SegmentOption<SourceKind>[] = [
  { value: "pink", label: "Pink", hint: "Pink noise over the whole band: the overall balance" },
  { value: "band-wm", label: "W/M band", hint: "Pink noise one octave around the woofer/midrange crossover" },
  { value: "band-mt", label: "M/T band", hint: "Pink noise one octave around the midrange/tweeter crossover" },
  { value: "tone", label: "Tone", hint: "A sine at the probe frequency; click any plot to move it" },
  { value: "sweep", label: "Sweep", hint: "Logarithmic sweep 20 Hz-20 kHz in 10 s, repeating" },
  { value: "track", label: "Track", hint: "An audio file of your own (WAV always works), looping" },
];

const DEFAULT_VOLUME_DB = -20;
const DEBOUNCE_MS = 150;
const METER_FLOOR_DB = -60;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !["checkbox", "radio", "button", "range"].includes((el as HTMLInputElement).type);
}
/** A control that does its own thing with Space (a button, a switch, a radio). */
const ownsSpace = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.("button, [role=switch], [role=radio], [role=checkbox], [role=slider], a, input");

export function ListenView() {
  const prep = useStore(s => s.prep);
  const results = useStore(s => s.results)!;
  const profile = useStore(s => s.profile);
  const snapshots = useStore(s => s.snapshots);
  const angleChoice = useStore(s => s.ui.angle);
  const setUi = useStore(s => s.setUi);
  const [probe, setProbe] = useProbe();

  const angles = useMemo(() => Object.keys(results.angles).sort((a, b) => +a - +b), [results]);
  const angle = angleChoice !== "both" && results.angles[angleChoice] ? angleChoice : "0";

  // ---------------------------------------------------------------- player and settings
  const player = useRef<ListenPlayer | null>(null);
  if (!player.current) player.current = new ListenPlayer();
  const [playing, setPlaying] = useState(false);
  const [audioState, setAudioState] = useState<string>("none");
  const [fs, setFs] = useState(player.current.sampleRate);
  const [source, setSource] = useState<SourceKind>("pink");
  const [volume, setVolume] = useState(DEFAULT_VOLUME_DB);
  const [what, setWhat] = useState<What>("design");
  const [snapId, setSnapId] = useState<string | null>(null);
  const [on, setOn] = useState<Record<UnitId, boolean>>({ woof: true, mid: true, tw: true });
  const [inv, setInv] = useState<Record<UnitId, boolean>>({ woof: false, mid: false, tw: false });
  const [track, setTrack] = useState<{ name: string; buffer: AudioBuffer } | null>(null);
  const [trackMsg, setTrackMsg] = useState<{ tone: "bad" | "info"; text: string } | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => () => { void player.current?.close(); player.current = null; }, []);

  // the snapshot to compare with: the chosen one, else the newest
  const snap = snapshots.find(s => s.id === snapId) ?? snapshots[snapshots.length - 1] ?? null;
  const whatNow: What = what === "snapshot" && !snap ? "design" : what;

  // ---------------------------------------------------------------- impulse responses
  const seq = useRef(0);
  const [designSet, setDesignSet] = useState<{ set: IrSet; id: number } | null>(null);
  const [irError, setIrError] = useState<string | null>(null);
  const designRef = useRef(useStore.getState().design);
  designRef.current = useStore(s => s.design);
  const hasSet = !!designSet;
  useEffect(() => {
    const build = () => {
      try {
        setDesignSet({ set: irsFromResults(prep, designRef.current, results, angle, fs, IR_N), id: ++seq.current });
        setIrError(null);
      } catch (e) { setIrError(e instanceof Error ? e.message : String(e)); }
    };
    // the first build is immediate; edits (slider drags) are debounced
    if (!hasSet) { build(); return; }
    const t = setTimeout(build, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prep, results, angle, fs]);

  const snapCache = useRef(new Map<string, { set: IrSet; id: number }>());
  const snapSet = useMemo(() => {
    if (!snap || whatNow !== "snapshot") return null;
    const key = `${snap.id}|${angle}|${fs}`;
    let hit = snapCache.current.get(key);
    if (!hit) {
      try {
        hit = { set: irsFromResults(prep, snap.design, snap.results, angle, fs, IR_N), id: ++seq.current };
        if (snapCache.current.size > 12) snapCache.current.clear();   // ~400 kB per entry
        snapCache.current.set(key, hit);
      } catch { return null; }
    }
    return hit;
  }, [snap, whatNow, angle, fs, prep]);

  const weights: UnitWeights = useMemo(() => {
    const w = {} as UnitWeights;
    for (const u of UNIT_IDS) w[u] = on[u] ? (inv[u] ? -1 : 1) : 0;
    return w;
  }, [on, inv]);

  const loaded = useMemo(() => {
    if (whatNow === "flat") return { ir: flatIr(IR_N), key: "flat", offsetDb: 0 };
    const s = whatNow === "snapshot" ? snapSet : designSet;
    if (!s) return null;
    const wk = UNIT_IDS.map(u => weights[u]).join(",");
    return { ir: mixIr(s.set, weights), key: `${whatNow}|${s.id}|${wk}`, offsetDb: s.set.offsetDb };
  }, [whatNow, snapSet, designSet, weights]);

  useEffect(() => {
    if (loaded) player.current?.setIr(Float32Array.from(loaded.ir), loaded.key);
  }, [loaded]);

  // ---------------------------------------------------------------- source settings follow the design
  const bandHz = source === "band-mt" ? bandCentre(results.metrics, profile?.limits, "mt") : bandCentre(results.metrics, profile?.limits, "wm");
  useEffect(() => {
    try { player.current?.setSource({ kind: source, bandHz, toneHz: probe, track: track?.buffer ?? null }); }
    catch (e) { setAudioError(e instanceof Error ? e.message : String(e)); }
  }, [source, bandHz, probe, track]);
  useEffect(() => { player.current?.setVolumeDb(volume); }, [volume]);

  // ---------------------------------------------------------------- transport
  const toggle = useCallback(async () => {
    const p = player.current;
    if (!p) return;
    if (p.playing) { p.stop(); setPlaying(false); return; }
    if (source === "track" && !track) { setTrackMsg({ tone: "info", text: "Choose or drop an audio file first." }); return; }
    try {
      const fresh = !p.ctx;
      await p.play();
      setAudioError(null);
      setPlaying(true);
      if (fresh && p.ctx) {
        const ctx = p.ctx;
        setAudioState(ctx.state);
        ctx.onstatechange = () => setAudioState(ctx.state);
        if (ctx.sampleRate !== fs) setFs(ctx.sampleRate);   // the IRs are rebuilt at the device rate
      }
    } catch (e) { setAudioError(e instanceof Error ? e.message : String(e)); p.stop(); setPlaying(false); }
  }, [source, track, fs]);

  // Space = play/stop, A = design, B = snapshot (while this view is open)
  const keyState = useRef({ toggle, hasSnap: !!snap });
  keyState.current = { toggle, hasSnap: !!snap };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTyping(e.target) || layerOpen()) return;
      if (e.key === " ") {
        if (ownsSpace(e.target)) return;
        e.preventDefault(); void keyState.current.toggle();
      } else if (e.key === "a" || e.key === "A") { e.preventDefault(); setWhat("design"); }
      else if (e.key === "b" || e.key === "B") { if (keyState.current.hasSnap) { e.preventDefault(); setWhat("snapshot"); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------------------------------------------------------------- meter and sweep read-out
  const meterFill = useRef<HTMLDivElement>(null);
  const meterText = useRef<HTMLSpanElement>(null);
  const sweepText = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!playing) {
      if (meterFill.current) meterFill.current.style.transform = "scaleX(0)";
      if (meterText.current) meterText.current.textContent = "−∞ dBFS";
      return;
    }
    let raf = 0, held = -Infinity;
    const tick = () => {
      const p = player.current;
      if (p) {
        const pk = p.peakDb();
        held = Math.max(pk, held - 0.6);                          // ~36 dB/s fall at 60 frames/s
        const t = Number.isFinite(held) ? Math.min(1, Math.max(0, (held - METER_FLOOR_DB) / -METER_FLOOR_DB)) : 0;
        if (meterFill.current) {
          meterFill.current.style.transform = `scaleX(${t})`;
          meterFill.current.dataset.level = held > -3 ? "hot" : held > -12 ? "warm" : "ok";
        }
        if (meterText.current) meterText.current.textContent = Number.isFinite(held) && held > METER_FLOOR_DB ? `${held.toFixed(1)} dBFS` : "−∞ dBFS";
        if (sweepText.current) {
          const fNow = sweepFrequency(p.elapsed() % (SWEEP_S + 0.5), SWEEP_S);
          sweepText.current.textContent = fNow ? fmtFreq(fNow) : "pause";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ---------------------------------------------------------------- own track
  const fileInput = useRef<HTMLInputElement>(null);
  const loadFile = useCallback(async (file: File) => {
    setTrackMsg({ tone: "info", text: `Decoding ${file.name}…` });
    try {
      const buf = await player.current!.decode(await file.arrayBuffer());
      setTrack({ name: file.name, buffer: buf });
      setTrackMsg(null);
      setSource("track");
    } catch (e) {
      const why = e instanceof Error && e.message ? e.message : "the format is not supported here";
      setTrackMsg({ tone: "bad", text: `Could not decode ${file.name}: ${why}. WAV always works; MP3 and OGG need the codecs of this system.` });
    }
  }, []);
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void loadFile(f);
  };

  // ---------------------------------------------------------------- the plot of what is loaded
  const [plotRef, plotSize] = useSize<HTMLDivElement>();
  const series = useMemo<PlotSeries[]>(() => {
    if (!loaded) return [];
    const m = irMagnitude(loaded.ir, fs);
    let label = whatNow === "flat" ? "Flat (bypass)" : whatNow === "snapshot" ? snap?.name ?? "Snapshot" : "Design";
    if (whatNow !== "flat") {
      // say what the unit switches changed, so the curve is never mistaken for the design's sum
      const name = (u: UnitId) => TRACE_META[u].name.toLowerCase();
      const live = UNIT_IDS.filter(u => weights[u] !== 0), flipped = UNIT_IDS.filter(u => weights[u] < 0);
      if (live.length === 0) label += " · all units muted";
      else if (live.length < UNIT_IDS.length) label += ` · ${live.map(name).join(" + ")} only`;
      if (flipped.length) label += ` · ${flipped.map(name).join(", ")} inverted`;
    }
    return [{ id: "heard", label, x: m.f, y: m.db, color: whatNow === "snapshot" ? snap?.color ?? "ref" : "sum", width: 2 }];
  }, [loaded, fs, whatNow, snap, weights]);

  if (!audioSupported())
    return (
      <div className="vw-view">
        <ViewHeader title="Listen" />
        <EmptyState icon={Headphones} title="No audio output in this window"
          description="This webview has no Web Audio support, so the design cannot be played. Every other view works as usual." />
      </div>
    );

  const unitsMuted = UNIT_IDS.filter(u => !on[u]).length;
  const [edgeLo, edgeHi] = octaveEdges(bandHz);
  const bandIsCrossing = source === "band-mt" ? !!results.metrics.x_mt : !!results.metrics.x_wm;

  return (
    <div className="vw-view ls-view" data-audio-state={audioState} data-playing={playing ? "true" : "false"}>
      <ViewHeader title="Listen">
        Hear the design before you build it: the measured units through your crossover, convolved in real time.
        Mute, solo or invert a unit to hear what it adds; the design itself is not changed here.
      </ViewHeader>

      <div className="ls-grid">
        <div className="ls-side">
          {/* (a) transport */}
          <Card title="Transport">
            <div className="ls-transport">
              <Button variant="primary" size="lg" className="ls-play" icon={playing ? Square : Play} onClick={() => void toggle()}
                      aria-pressed={playing} disabled={!loaded}>
                {playing ? "Stop" : "Play"}
              </Button>
              <div className="ls-meter" aria-label="Output peak level">
                <div className="ls-meter-rail"><div className="ls-meter-fill" ref={meterFill} /></div>
                <span className="ls-meter-text mono" ref={meterText}>−∞ dBFS</span>
              </div>
            </div>
            <div className="ls-row">
              <span className="ls-label">Volume</span>
              <Slider label="Master volume" value={volume} min={VOLUME_MIN_DB} max={VOLUME_MAX_DB} step={0.5} unit="dB" digits={1}
                      defaultValue={DEFAULT_VOLUME_DB} onInput={setVolume} onCommit={setVolume} className="ls-grow" />
            </div>
            <p className="ls-hint"><span className="vw-kbd">Space</span> plays and stops. Starts at −20 dBFS; a limiter at −3 dBFS protects your ears and speakers.
              {audioState === "suspended" && playing && " The audio device is suspended: click Play again or check the system output."}</p>
            {audioError && <p className="ls-msg is-bad" role="alert">{audioError}</p>}
          </Card>

          {/* (b) source */}
          <Card title="Source">
            <Segmented<SourceKind> label="Test signal" size="sm" block options={SOURCES} value={source} onChange={setSource} className="ls-sources" />
            <div className="ls-detail">
              {source === "pink" && <span>Pink noise, −3 dB per octave, at −12 dBFS RMS: the overall tonal balance.</span>}
              {(source === "band-wm" || source === "band-mt") && (
                <span>One octave of pink noise around <b className="mono">{fmtFreq(bandHz)}</b>
                  {bandIsCrossing ? " (the acoustic crossover)" : " (no crossing found: the middle of the search window)"},{" "}
                  <span className="mono">{fmtFreq(edgeLo)}–{fmtFreq(edgeHi)}</span>. Listen for a hole or a hump as you change the crossover.</span>
              )}
              {source === "tone" && (
                <span>Sine at the probe, <b className="mono">{fmtFreq(probe)}</b>. Click the plot (or press P) to move it.</span>
              )}
              {source === "sweep" && (
                <span>20 Hz to 20 kHz in 10 s, then 0.5 s of silence. Now: <b className="mono" ref={sweepText}>{playing ? "" : "stopped"}</b></span>
              )}
              {source === "track" && (
                <div className={"ls-drop" + (dragOver ? " is-over" : "")}
                     onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
                  <FileAudio size={18} strokeWidth={1.75} aria-hidden />
                  <span className="ls-drop-text">
                    {track ? <><b>{track.name}</b> · <span className="mono">{track.buffer.duration.toFixed(1)} s</span>, loops</>
                           : isTauri() ? "Choose a WAV, MP3 or OGG file" : "Drop a WAV, MP3 or OGG file here, or choose one"}
                  </span>
                  <Button size="sm" icon={Upload} onClick={() => fileInput.current?.click()}>{track ? "Replace" : "Choose file"}</Button>
                  <input ref={fileInput} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac" hidden
                         onChange={e => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ""; }} />
                </div>
              )}
              {trackMsg && <p className={"ls-msg is-" + trackMsg.tone} role={trackMsg.tone === "bad" ? "alert" : undefined}>{trackMsg.text}</p>}
            </div>
          </Card>

          {/* (c) what plays */}
          <Card title="What plays">
            <Segmented<What> label="What plays" size="sm" block value={whatNow} onChange={setWhat} options={[
              { value: "design", label: "Design", hint: "The current design (A)" },
              { value: "snapshot", label: "Snapshot", disabled: !snap, hint: snap ? "The chosen snapshot (B)" : "Take a snapshot (S) to compare with it" },
              { value: "flat", label: "Flat", hint: "No speaker: the signal as it is (bypass)" },
            ]} />
            <div className="ls-row">
              <span className="ls-label">Snapshot</span>
              <span className="ls-select">
                <select aria-label="Snapshot to compare with" disabled={!snapshots.length} value={snap?.id ?? ""}
                        onChange={e => { setSnapId(e.target.value); setWhat("snapshot"); }}>
                  {!snapshots.length && <option value="">No snapshots yet</option>}
                  {snapshots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </span>
            </div>
            <p className="ls-hint"><span className="vw-kbd">A</span> design · <span className="vw-kbd">B</span> snapshot ·{" "}
              <span className="vw-kbd">S</span> takes a snapshot. Switching cross-fades over 40 ms, at the same level and delay.</p>
          </Card>

          {/* (d) units */}
          <Card title="Units" actions={<Segmented label="Angle" size="sm" value={angle}
              onChange={a => setUi({ angle: a })} options={angles.map(a => ({ value: a, label: `${a}°` }))} />}>
            <ul className="ls-units">
              {UNIT_IDS.map(u => (
                <li key={u} className="ls-unit" style={{ ["--unit" as string]: `var(--${TRACE_META[u].color})` }}>
                  <Checkbox checked={on[u]} color={`var(--${TRACE_META[u].color})`} onChange={v => setOn({ ...on, [u]: v })}>
                    {TRACE_META[u].name}
                  </Checkbox>
                  <Button size="sm" variant="ghost" aria-pressed={on[u] && UNIT_IDS.every(o => o === u || !on[o])}
                          onClick={() => setOn({ woof: u === "woof", mid: u === "mid", tw: u === "tw" })}>Solo</Button>
                  <Switch size="sm" checked={inv[u]} onChange={v => setInv({ ...inv, [u]: v })}>Invert</Switch>
                </li>
              ))}
            </ul>
            <div className="ls-unit-foot">
              <span className="ls-hint">{unitsMuted ? `${unitsMuted} muted: the others keep their real level.` : "All units on."}</span>
              {(unitsMuted > 0 || UNIT_IDS.some(u => inv[u])) && (
                <Button size="sm" variant="ghost" onClick={() => { setOn({ woof: true, mid: true, tw: true }); setInv({ woof: false, mid: false, tw: false }); }}>Reset</Button>
              )}
            </div>
          </Card>
        </div>

        {/* (e) response strip */}
        <div className="ls-main">
          <Card title={`What you hear · ${angle}°`} className="ls-plot-card">
            <div className="ls-plot" ref={plotRef}>
              {irError ? (
                <EmptyState compact icon={Headphones} tone="bad" title="Cannot build the listening filter" description={irError} />
              ) : plotSize.height > 0 && (
                <Plot height={plotSize.height} xRange={[20, 20000]} yRange={[-36, 12]} yLabel="Level" yUnit="dB"
                      series={series} probeHz={probe} onProbe={setProbe}
                      vLines={whatNow === "flat" ? [] : crossoverLines((whatNow === "snapshot" && snap ? snap.results : results).metrics)}
                      ariaLabel="Magnitude of the impulse response being played" />
              )}
            </div>
            <p className="ls-note">
              Anechoic response of your measurements, without the room. Headphones or a flat speaker give the fairest comparison.
              Level: 0 dB is the design&apos;s median over 300 Hz–3 kHz; below 50 Hz the woofer follows the box model.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
