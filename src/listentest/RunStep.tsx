// Step 3 of the listening-test view: run a listener's session, trial by trial. "Play in the app" plays the
// blind variants through the Listen view's auralisation (src/listen: the same IRs, the same player),
// each scaled to the same pink-noise level over 150 Hz-15 kHz so level cannot bias the answer; the
// listener presses A, B, C... and rates. "Enter from sheets" walks the same trials without sound, to
// type in a printed sheet: the seed decodes the letters.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileAudio, Play, Square, Upload } from "lucide-react";
import { Button, ProgressBar, Segmented, Slider, fmtDb, fmtFreq, layerOpen } from "../ui";
import { useStore } from "../state/store";
import { compute } from "../engine";
import { Card } from "../views/common";
import { IR_N, flatIr, irsFromResults, mixIr } from "../listen/ir";
import { bandCentre } from "../listen/noise";
import { ListenPlayer, VOLUME_MAX_DB, VOLUME_MIN_DB, audioSupported, type SourceKind } from "../listen/player";
import { BLIND_LETTERS, playable, type Protocol, type Rating } from "./model";
import { MATCH_BAND, matchGains, withGain } from "./level";
import { makePlan } from "./random";
import { useListenTest } from "./store";
import { ScaleInput, Select } from "./parts";

type Mode = "app" | "sheet";

const key = (r: Omit<Rating, "value">) => `${r.listener}|${r.rep}|${r.item}|${r.variant}|${r.attr}`;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox";
}

export function RunStep({ protocol, ratings, onDone }: { protocol: Protocol; ratings: Rating[]; onDone(): void }) {
  const p = protocol;
  const rate = useListenTest(s => s.rate);
  const prep = useStore(s => s.prep);
  const results = useStore(s => s.results);
  const profile = useStore(s => s.profile);
  const plan = useMemo(() => makePlan(p), [p]);
  const allPlayable = p.variants.length > 0 && p.variants.every(playable);
  const [mode, setMode] = useState<Mode>(allPlayable && audioSupported() ? "app" : "sheet");
  const modeNow: Mode = allPlayable && audioSupported() ? mode : "sheet";
  const [who, setWho] = useState(0);
  const listener = Math.min(who, Math.max(0, plan.length - 1));
  const session = plan[listener];
  const [ti, setTi] = useState(0);
  const trial = session?.trials[Math.min(ti, session.trials.length - 1)];
  const letters = BLIND_LETTERS.slice(0, p.variants.length).split("");
  const byLetter = useMemo(() => new Map(Object.entries(session?.labels ?? {}).map(([v, l]) => [l, v])), [session]);
  const have = useMemo(() => new Map(ratings.map(r => [key(r), r.value])), [ratings]);

  // ---------------------------------------------------------------- completeness per trial
  const status = (l: number, t: { rep: number; item: string }) => {
    let n = 0;
    for (const v of p.variants) for (const a of p.attributes) if (have.has(key({ listener: l, rep: t.rep, item: t.item, variant: v.id, attr: a.id }))) n++;
    return n === 0 ? "none" : n === p.variants.length * p.attributes.length ? "done" : "part";
  };
  const doneTrials = session ? session.trials.filter(t => status(listener, t) === "done").length : 0;

  // ---------------------------------------------------------------- audio: blinded, level-matched variants
  const player = useRef<ListenPlayer | null>(null);
  if (!player.current) player.current = new ListenPlayer();
  useEffect(() => () => { void player.current?.close(); player.current = null; }, []);
  const [fs, setFs] = useState(player.current.sampleRate);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(-20);
  const [active, setActive] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Record<string, { name: string; buffer: AudioBuffer }>>({});

  const irSeq = useRef(0);
  const irs = useMemo(() => {
    if (modeNow !== "app" || !prep) return null;
    try {
      const raw = p.variants.map(v => v.kind === "flat" ? flatIr(IR_N) : mixIr(irsFromResults(prep, v.design!, compute(prep, v.design!), "0", fs, IR_N)));
      const gains = matchGains(raw, fs);
      return { map: new Map(p.variants.map((v, i) => [v.id, withGain(raw[i], gains[i])])), gains, id: ++irSeq.current };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e), map: null, gains: null, id: 0 }; }
  }, [modeNow, prep, p.variants, fs]);

  const item = trial ? p.items.find(i => i.id === trial.item) : undefined;
  const source: SourceKind = item?.kind === "signal" ? item.signal ?? "pink" : "track";
  const bandHz = bandCentre(results?.metrics, profile?.limits, source === "band-mt" ? "mt" : "wm");
  const track = item ? tracks[item.id] ?? null : null;
  useEffect(() => {
    try { player.current?.setSource({ kind: source, bandHz, toneHz: 1000, track: track?.buffer ?? null }); }
    catch (e) { setAudioError(e instanceof Error ? e.message : String(e)); }
  }, [source, bandHz, track]);
  useEffect(() => { player.current?.setVolumeDb(volume); }, [volume]);
  // a new trial starts silent, so the first variant heard is the one the listener picks
  useEffect(() => { player.current?.stop(); setPlaying(false); setActive(null); }, [listener, ti, modeNow]);

  const pick = useCallback(async (variant: string) => {
    setActive(variant);
    if (modeNow !== "app" || !irs?.map) return;
    const pl = player.current!, ir = irs.map.get(variant);
    if (!ir) return;
    pl.setIr(ir, `lt|${irs.id}|${variant}`);
    if (!pl.playing) {
      try {
        const fresh = !pl.ctx;
        await pl.play();
        setPlaying(true); setAudioError(null);
        if (fresh && pl.ctx && pl.ctx.sampleRate !== fs) setFs(pl.ctx.sampleRate);   // IRs rebuilt at the device rate
      } catch (e) { setAudioError(e instanceof Error ? e.message : String(e)); }
    }
  }, [modeNow, irs, fs]);
  const stop = () => { player.current?.stop(); setPlaying(false); };

  const fileInput = useRef<HTMLInputElement>(null);
  const loadTrack = async (file: File) => {
    if (!item) return;
    try {
      const buffer = await player.current!.decode(await file.arrayBuffer());
      setTracks(t => ({ ...t, [item.id]: { name: file.name, buffer } }));
      setAudioError(null);
    } catch { setAudioError(`Could not decode ${file.name}. WAV always works; MP3 and OGG need the codecs of this system.`); }
  };

  // keys: a letter plays (or marks) that variant, Space stops, arrows move between trials
  const keys = useRef({ pick, stop, playing, byLetter, next: () => {}, prev: () => {} });
  const total = session?.trials.length ?? 0;
  const next = () => { if (ti + 1 < total) setTi(ti + 1); else onDone(); };
  const prev = () => setTi(Math.max(0, ti - 1));
  keys.current = { pick, stop, playing, byLetter, next, prev };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target) || layerOpen()) return;
      const k = keys.current, v = k.byLetter.get(e.key.toUpperCase());
      if (v && e.key.length === 1) { e.preventDefault(); void k.pick(v); }
      else if (e.key === " " && k.playing && !(e.target as HTMLElement | null)?.closest?.("button, [role=radio]")) { e.preventDefault(); k.stop(); }
      else if (e.key === "ArrowRight" && !(e.target as HTMLElement | null)?.closest?.("[role=radiogroup]")) { e.preventDefault(); k.next(); }
      else if (e.key === "ArrowLeft" && !(e.target as HTMLElement | null)?.closest?.("[role=radiogroup]")) { e.preventDefault(); k.prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!p.variants.length || !session || !trial)
    return <Card title="Run"><p className="lt-msg">Add the variants to compare in step 1 first.</p></Card>;

  const trialStatus = status(listener, trial);
  const gainOf = (id: string) => irs?.gains?.[p.variants.findIndex(v => v.id === id)] ?? 0;

  return (
    <div className="lt-cols is-run">
      <div className="lt-col">
        <Card>
          <div className="lt-trial-head">
            <span className="lt-trial-title">Trial {trial.n} of {total} · {item?.name}</span>
            <span className="lt-trial-meta">Listener {listener + 1} · repetition {trial.rep + 1} of {p.reps}</span>
          </div>
          <div className="lt-labels" role="group" aria-label="Variants in play order">
            {trial.order.map((v, i) => {
              const l = session.labels[v];
              return (
                <button key={v} type="button" className={"lt-label-btn" + (active === v ? " is-on" : "")} aria-pressed={active === v}
                        title={modeNow === "app" ? `Play ${l} (key ${l})` : `Version ${l}`} onClick={() => void pick(v)}>
                  <span className="lt-label-letter">{l}</span>
                  <span className="lt-label-pos">{i + 1}{i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}</span>
                </button>
              );
            })}
          </div>
          {modeNow === "app" && item?.kind === "track" && (
            <div className="lt-inline lt-msg">
              <FileAudio size={14} aria-hidden />
              {track ? <span><b>{track.name}</b> · <span className="mono">{track.buffer.duration.toFixed(1)} s</span>, loops</span>
                     : <span>Choose the audio file for “{item.name}” (WAV always works).</span>}
              <Button size="sm" icon={Upload} onClick={() => fileInput.current?.click()}>{track ? "Replace" : "Choose file"}</Button>
              <input ref={fileInput} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac" hidden
                     onChange={e => { const f = e.target.files?.[0]; if (f) void loadTrack(f); e.target.value = ""; }} />
            </div>
          )}
          {audioError && <p className="lt-msg is-bad" role="alert">{audioError}</p>}

          <table className="lt-rate">
            <thead><tr><th>Attribute</th>{letters.map(l => <th key={l} className="mono">{l}</th>)}</tr></thead>
            <tbody>
              {p.attributes.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="lt-rate-name">{a.name}</div>
                    <div className="lt-rate-desc">1 {a.low} · 7 {a.high}</div>
                  </td>
                  {letters.map(l => {
                    const v = byLetter.get(l)!, k = { listener, rep: trial.rep, item: trial.item, variant: v, attr: a.id };
                    const val = have.get(key(k)) ?? null;
                    return (
                      <td key={l} className={"lt-scale-cell" + (val === null ? " is-empty" : "")}>
                        <ScaleInput label={`${a.name}, version ${l}`} value={val} onChange={x => rate(k, x)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="lt-nav">
            <Button icon={ChevronLeft} disabled={ti === 0} onClick={prev}>Previous</Button>
            <span className="lt-trial-meta">{trialStatus === "done" ? "All rated" : trialStatus === "part" ? "Some ratings missing" : "Not rated yet"}</span>
            <Button variant={trialStatus === "done" ? "primary" : "subtle"} iconRight={ChevronRight} onClick={next}>
              {ti + 1 < total ? "Next trial" : "See results"}
            </Button>
          </div>
        </Card>
      </div>

      <div className="lt-col">
        <Card title="Session">
          <div className="lt-fields">
            <span className="lt-label">Listener</span>
            <Select<string> label="Listener" value={String(listener)} onChange={v => { setWho(+v); setTi(0); }}
                    options={plan.map(s => ({ value: String(s.listener), label: `Listener ${s.listener + 1}` }))} />
            <span className="lt-label">Mode</span>
            <Segmented<Mode> size="sm" label="Run mode" value={modeNow} onChange={setMode} options={[
              { value: "app", label: "Play in app", disabled: !allPlayable || !audioSupported(),
                hint: allPlayable ? "The listener hears the design variants here, blind and level matched" : "Room speakers cannot play here: use the printed sheets" },
              { value: "sheet", label: "Enter from sheet", hint: "Type in a printed sheet: the same trials, no sound" },
            ]} />
          </div>
          <div className="lt-progress">
            <ProgressBar value={total ? doneTrials / total : 0} label={`${doneTrials} of ${total} trials rated`} />
            <span className="lt-trial-meta">{doneTrials} of {total} trials rated</span>
            <div className="lt-dots">
              {session.trials.map((t, i) => {
                const st = status(listener, t);
                return <button key={t.n} type="button" className={"lt-dot" + (st === "done" ? " is-done" : st === "part" ? " is-part" : "") + (i === ti ? " is-on" : "")}
                               aria-label={`Trial ${t.n}`} aria-current={i === ti} onClick={() => setTi(i)}>{t.n}</button>;
              })}
            </div>
          </div>
        </Card>

        {modeNow === "app" ? (
          <Card title="Playback">
            <div className="lt-inline">
              <Button size="sm" variant={playing ? "subtle" : "primary"} icon={playing ? Square : Play}
                      onClick={() => (playing ? stop() : void pick(active ?? trial.order[0]))}>{playing ? "Stop" : "Play first"}</Button>
              <Slider label="Volume" value={volume} min={VOLUME_MIN_DB} max={VOLUME_MAX_DB} step={0.5} unit="dB" digits={1} defaultValue={-20}
                      onInput={setVolume} onCommit={setVolume} className="ls-grow" />
            </div>
            <p className="lt-help">
              <b>Level matched:</b> every variant plays at the same pink-noise level over {fmtFreq(MATCH_BAND[0])}–{fmtFreq(MATCH_BAND[1])}, so loudness cannot
              decide the answer. Corrections now: {p.variants.map(v => `${session.labels[v.id]} ${fmtDb(gainOf(v.id), { sign: true })}`).sort().join(", ")}.
              Switching cross-fades over 40 ms. Keys: the letters play, Space stops, ← → change trial.
            </p>
            {irs && "error" in irs && <p className="lt-msg is-bad">Cannot build the listening filters: {irs.error}</p>}
            <p className="lt-help">Anechoic, without the room: headphones or a flat speaker give the fairest comparison. The IEC room test with the built speaker is still the verdict.</p>
          </Card>
        ) : (
          <Card title="Entering a sheet">
            <p className="lt-help">
              {allPlayable ? "Typing in a printed sheet." : "This protocol has room speakers, so it runs with the printed sheets."} Pick the listener, then copy
              each trial&apos;s numbers into the grid: the columns are the letters on the sheet, and the seed ({p.seed}) tells the app which variant each letter was.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
