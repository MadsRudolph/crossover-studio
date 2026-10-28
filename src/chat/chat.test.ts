// The AI chat without the network: the design summary, the tools on the bundled System D design
// (patch validation, snapping to the basket, try_change determinism), the streamed tool loop against a
// fake transport, the plain-language errors and the Markdown renderer.
import { describe, expect, it } from "vitest";
import { assess, compute, fitBox, prepare } from "../engine";
import { BUNDLED_PROFILES, defaultDesign, useStore } from "../state/store";
import type { Design } from "../types";
import { buildContext, contextText, starterQuestions, type ChatEnv } from "./context";
import { applyChange, bandTool, evaluateChange, executeTool, probeTool, snapToStock, TOOL_DEFS, type Proposal, type ToolHooks } from "./tools";
import { ChatError, mergeChunk, plainError, runChat, SseParser, toChatError, type ChatMessage, type Transport, type Turn } from "./client";
import { parseInline, parseMarkdown } from "./markdown";
import { useChat } from "./chatState";

const profile = BUNDLED_PROFILES[0];
const fit = fitBox(profile);
const prep = prepare(profile, fit);
const design = defaultDesign(profile);
const envFor = (d: Design): ChatEnv => ({ profile, fit, prep, design: d, results: compute(prep, d), probe: 2000, view: "system" });
const env = envFor(design);
const noHooks: ToolHooks = { show() {}, propose() {} };

describe("context", () => {
  const ctx = buildContext(env);

  it("summarises the design in display units, with the verdict and the probe", () => {
    expect(ctx.profile.name).toBe(profile.name);
    expect(ctx.design.digital).toEqual({ fc_hz: design.digital.fc, alignment: design.digital.align, woofer_gain_db: design.digital.g_woof_dB });
    // 0.82 mH and 6.8 µF, as the inspector shows them
    expect(ctx.design.mid.parts.L1).toBe(`${+(design.mid.vals.L1 * 1e3).toPrecision(3)} mH`);
    expect(ctx.design.tw.parts.C1).toBe(`${+(design.tw.vals.C1 * 1e6).toPrecision(3)} µF`);
    const a = assess(prep, design, env.results);
    expect(ctx.verdict.score).toBe(Math.round(a.score));
    expect(ctx.verdict.criteria.map(c => c.id)).toEqual(a.criteria.map(c => c.id));
    expect(ctx.checks.length).toBe(env.results.checks.length);
    expect(ctx.probe.freq_hz).toBeGreaterThan(1900);
    expect(ctx.probe.freq_hz).toBeLessThan(2100);
    expect(ctx.current_view).toBe("system");
    expect(ctx.profile.parts_basket.R_ohm).toContain(4.7);
  });

  it("stays compact enough to send with every question", () => {
    const text = contextText(env);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text.length).toBeLessThan(16000);
  });

  it("offers starter questions, at most four", () => {
    const qs = starterQuestions([{ id: "x", severity: "warn", title: "The tweeter arrives early.", detail: "", view: "time", at: 2500 }], assess(prep, design, env.results));
    expect(qs[0]).toBe("Explain: The tweeter arrives early (2.5 kHz)");
    expect(qs.length).toBeLessThanOrEqual(4);
    expect(starterQuestions([], null).length).toBeGreaterThan(0);
  });
});

describe("design changes", () => {
  const C = profile.components;

  it("snaps part values to the nearest basket value on a log scale", () => {
    expect(snapToStock([1, 1.5, 2.2], 1.2)).toBe(1);
    expect(snapToStock([1, 1.5, 2.2], 1.3)).toBe(1.5);
    const r = applyChange(prep, design, { tw: { parts: { C1: 4.9 } } });
    expect(C.C).toContain(r.design.tw.vals.C1);
    expect(r.notes.join(" ")).toMatch(/not in the basket/);
    // an exact basket value passes without a note
    const exact = applyChange(prep, design, { mid: { parts: { L1: C.L[2] * 1e3 } } });
    expect(exact.design.mid.vals.L1).toBe(C.L[2]);
    expect(exact.notes).toEqual([]);
  });

  it("rejects what does not exist and applies the rest", () => {
    const r = applyChange(prep, design, { mid: { parts: { C9: 4.7 } }, tw: { topology: "LP2" }, alignment: "XX" as never, polarity: { tw: -1 } });
    expect(r.errors.length).toBe(3);
    expect(r.design.pol.tw).toBe(-1);
    expect(r.design.mid).toEqual(design.mid);
    expect(r.design.tw.topo).toBe(design.tw.topo);
  });

  it("clamps the digital and box settings to their ranges, and removes pads on null", () => {
    const r = applyChange(prep, design, { fc_hz: 5000, woofer_gain_db: -30, fill: 3, tw: { Rs: null, Rp: null } });
    expect(r.design.digital.fc).toBe(1000);
    expect(r.design.digital.g_woof_dB).toBe(-12);
    expect(r.design.box.fill).toBe(1.5);
    expect(r.design.tw.pad?.Rs).toBeUndefined();
    expect(r.design.tw.pad?.Rp).toBeNull();
    expect(r.notes.length).toBe(3);
  });

  it("gives a new topology values for every part, and never touches the input design", () => {
    const before = JSON.stringify(design);
    const r = applyChange(prep, design, { mid: { topology: "LP3" } });
    expect(r.design.mid.topo).toBe("LP3");
    for (const k of ["L1", "C1", "L2"]) expect(r.design.mid.vals[k]).toBeGreaterThan(0);
    expect(JSON.stringify(design)).toBe(before);
  });

  it("try_change is deterministic and changes nothing in the app", () => {
    const store = JSON.stringify(useStore.getState().design);
    const change = { tw: { Rs: 3.3 }, polarity: { mid: -1 as const } };
    const a = executeTool(env, "try_change", JSON.stringify({ changes: change }), noHooks);
    const b = executeTool(env, "try_change", JSON.stringify({ changes: change }), noHooks);
    expect(a).toBe(b);
    const ev = JSON.parse(a);
    expect(ev.score_before).toBeCloseTo(assess(prep, design, env.results).score, 0);
    expect(ev.score_after).not.toBe(ev.score_before);
    expect(JSON.stringify(useStore.getState().design)).toBe(store);
  });

  it("evaluates an inverted tweeter as worse, and lists what changed", () => {
    const ev = evaluateChange(env, { polarity: { tw: -1 } });
    expect(ev.score_after).toBeLessThan(ev.score_before);
    expect(ev.summary).toEqual(["Tweeter inverted"]);
    expect(ev.changed.length).toBeGreaterThan(0);
  });

  it("propose_change hands the card to the panel; an empty change is refused", () => {
    const got: Omit<Proposal, "id">[] = [];
    const hooks: ToolHooks = { show() {}, propose: p => got.push(p) };
    const out = JSON.parse(executeTool(env, "propose_change", JSON.stringify({ changes: { tw: { Rs: 3.3 } }, why: "less tweeter" }), hooks));
    expect(out.shown).toBe(true);
    expect(got).toHaveLength(1);
    expect(got[0].design.tw.pad?.Rs).toBe(3.3);
    expect(got[0].base).toBe(design);
    const none = JSON.parse(executeTool(env, "propose_change", JSON.stringify({ changes: {}, why: "" }), hooks));
    expect(none.error).toMatch(/nothing to propose/);
    expect(got).toHaveLength(1);
  });
});

describe("read-only tools", () => {
  it("probe reports every unit at the nearest grid point", () => {
    const p = probeTool(env, 2000);
    expect(p.freq_hz).toBeGreaterThan(1900);
    for (const u of ["woof", "mid", "tw", "sum"] as const) expect(Number.isFinite(p[u].level_db)).toBe(true);
    // at the mid/tweeter crossover both units contribute within a few dB of each other
    const x = env.results.metrics.x_mt!;
    const q = probeTool(env, x);
    expect(Math.abs(q.mid.level_db - q.tw.level_db)).toBeLessThan(1.5);
  });

  it("response_band finds the extremes inside the band", () => {
    const b = bandTool(env, 1000, 5000);
    expect(b.band_hz[0]).toBeGreaterThan(900);
    expect(b.sum.min_db).toBeLessThanOrEqual(b.sum.mean_db);
    expect(b.sum.max_db).toBeGreaterThanOrEqual(b.sum.mean_db);
    expect(b.sum.min_at_hz).toBeGreaterThanOrEqual(b.band_hz[0]);
    expect(b.sum.max_at_hz).toBeLessThanOrEqual(b.band_hz[1]);
  });

  it("show moves the app through the hook; bad input comes back as an error the model can read", () => {
    let shown: [string, number | undefined] | null = null;
    const out = JSON.parse(executeTool(env, "show", '{"view":"phase","freq_hz":2500}', { show: (v, f) => { shown = [v, f]; }, propose() {} }));
    expect(shown).toEqual(["phase", 2500]);
    expect(out.shown).toBe("phase");
    expect(JSON.parse(executeTool(env, "show", '{"view":"nope"}', noHooks)).error).toBeTruthy();
    expect(JSON.parse(executeTool(env, "probe", "{not json", noHooks)).error).toMatch(/JSON/);
    expect(JSON.parse(executeTool(env, "probe", '{"freq_hz":-3}', noHooks)).error).toBeTruthy();
    expect(JSON.parse(executeTool(env, "nope", "{}", noHooks)).error).toMatch(/Unknown tool/);
  });

  it("every tool definition has a schema and an executor", () => {
    for (const t of TOOL_DEFS) {
      expect(t.function.parameters.type).toBe("object");
      const out = JSON.parse(executeTool(env, t.function.name, "{}", noHooks));
      expect(String(out.error ?? "")).not.toMatch(/Unknown tool/);
    }
  });
});

// ---------------------------------------------------------------- the client, with a fake network
/** A transport that replays scripted SSE payloads, one script per request, and records the bodies. */
function fakeTransport(scripts: string[][]): Transport & { bodies: any[] } {
  const bodies: any[] = [];
  return {
    bodies,
    async send(body, onData) {
      bodies.push(JSON.parse(body));
      for (const d of scripts[bodies.length - 1] ?? []) onData(d);
    },
  };
}
const chunk = (delta: object, finish: string | null = null) => JSON.stringify({ choices: [{ delta, finish_reason: finish }] });

describe("client", () => {
  it("parses server-sent events across chunk boundaries", () => {
    const p = new SseParser();
    expect(p.feed(": OPENROUTER PROCESSING\n\ndata: {\"a\"")).toEqual([]);
    expect(p.feed(":1}\r\n\ndata: [DONE]\n")).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("assembles streamed tool calls piece by piece", () => {
    const t: Turn = { content: "", toolCalls: [], finish: null };
    mergeChunk(t, chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "probe", arguments: '{"freq' } }] }));
    mergeChunk(t, chunk({ tool_calls: [{ index: 0, function: { arguments: '_hz":2000}' } }] }));
    mergeChunk(t, chunk({}, "tool_calls"));
    expect(t.toolCalls).toEqual([{ id: "c1", type: "function", function: { name: "probe", arguments: '{"freq_hz":2000}' } }]);
    expect(t.finish).toBe("tool_calls");
    expect(() => mergeChunk(t, JSON.stringify({ error: { code: 402, message: "no credit" } }))).toThrow(ChatError);
  });

  it("runs the tool loop: tool call, local result, final answer", async () => {
    const tr = fakeTransport([
      [chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "probe", arguments: '{"freq_hz":2000}' } }] }), chunk({}, "tool_calls")],
      [chunk({ content: "At 2 kHz the " }), chunk({ content: "sum is fine." }), chunk({}, "stop")],
    ]);
    let text = "";
    const calls: string[] = [];
    const sys: ChatMessage = { role: "system", content: "sys" };
    const added = await runChat({
      model: "m", tools: TOOL_DEFS, transport: tr, signal: new AbortController().signal,
      messages: [sys, { role: "user", content: "dip?" }],
      exec: (name, args) => { calls.push(name); return executeTool(env, name, args, noHooks); },
      onText: t => { text += t; },
    });
    expect(calls).toEqual(["probe"]);
    expect(text).toBe("At 2 kHz the sum is fine.");
    expect(added.map(m => m.role)).toEqual(["assistant", "tool", "assistant"]);
    // the second request carries the tool result back to the model
    expect(tr.bodies[1].messages.at(-1).role).toBe("tool");
    expect(tr.bodies[1].messages.at(-1).tool_call_id).toBe("c1");
    expect(tr.bodies[0].stream).toBe(true);
    expect(tr.bodies[0].tools.length).toBe(TOOL_DEFS.length);
  });

  it("stops offering tools after the last round", async () => {
    const loop = [chunk({ tool_calls: [{ index: 0, id: "x", function: { name: "probe", arguments: '{"freq_hz":100}' } }] })];
    const tr = fakeTransport([loop, loop, [chunk({ content: "done" })]]);
    await runChat({ model: "m", tools: TOOL_DEFS, transport: tr, signal: new AbortController().signal, maxRounds: 2,
                    messages: [{ role: "user", content: "?" }], exec: () => "{}", onText: () => {} });
    expect(tr.bodies).toHaveLength(3);
    expect(tr.bodies[2].tools).toBeUndefined();
  });

  it("puts every failure in plain words", () => {
    expect(plainError(new ChatError("http", "No auth credentials found", 401))).toMatch(/did not accept the API key/);
    expect(plainError({ kind: "http", status: 402, message: "Insufficient credits" })).toMatch(/out of credit/);
    expect(plainError(new ChatError("http", "slow down", 429))).toMatch(/Too many requests/);
    expect(plainError(new TypeError("Failed to fetch"))).toMatch(/internet connection/);
    expect(plainError({ kind: "offline", message: "could not connect: dns error" })).toMatch(/internet connection/);
    expect(plainError(new ChatError("no-key", "No API key saved yet."))).toMatch(/Paste your OpenRouter key/);
    expect(toChatError({ kind: "http", status: 500, message: "boom" }).status).toBe(500);
  });
});

describe("chat session", () => {
  it("asks, streams, records the exchange, and reports a refused key plainly", async () => {
    useStore.getState().loadProfile(profile);
    const tr = fakeTransport([[chunk({ content: "Hello" })]]);
    await useChat.getState().ask("hi", tr);
    const items = useChat.getState().items;
    expect(items.map(i => i.kind)).toEqual(["user", "assistant"]);
    expect(items[1].kind === "assistant" && items[1].text).toBe("Hello");
    expect(useChat.getState().history).toHaveLength(1);
    // the request carries the instructions and a fresh design summary
    const sys = JSON.stringify(tr.bodies[0].messages.slice(0, 2));
    expect(sys).toMatch(/loudspeaker-engineering tutor/);
    expect(sys).toMatch(/verdict/);

    const refused: Transport = { async send() { throw { kind: "http", status: 401, message: "No auth credentials found" }; } };
    await useChat.getState().ask("again", refused);
    const last = useChat.getState().items.at(-1)!;
    expect(last.kind).toBe("error");
    expect(last.kind === "error" && last.text).toMatch(/did not accept the API key/);
    expect(last.kind === "error" && last.settings).toBe(true);
    expect(useChat.getState().busy).toBe(false);
    useChat.getState().clear();
    useChat.getState().setSettings(false);
  });
});

describe("markdown", () => {
  it("parses inline marks and keeps unsafe links as text", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { t: "text", v: "a " }, { t: "b", c: [{ t: "text", v: "b" }] }, { t: "text", v: " " },
      { t: "i", c: [{ t: "text", v: "c" }] }, { t: "text", v: " " }, { t: "code", v: "d" },
    ]);
    expect(parseInline("[x](https://openrouter.ai)")).toEqual([{ t: "a", href: "https://openrouter.ai", c: [{ t: "text", v: "x" }] }]);
    expect(parseInline("[x](javascript:alert(1))")[0]).toEqual({ t: "text", v: "x" });
    expect(parseInline("<b>no html</b>")).toEqual([{ t: "text", v: "<b>no html</b>" }]);
    expect(parseInline("2 * 3 * 4")).toEqual([{ t: "text", v: "2 * 3 * 4" }]);
    expect(parseInline("snake_case_name")).toEqual([{ t: "text", v: "snake_case_name" }]);
  });

  it("parses lists, headings, paragraphs and code blocks", () => {
    const b = parseMarkdown("## Why\nThe dip is\nat 2 kHz.\n\n- one\n- two\n\n1. first\n2. second\n\n```\nL1 = 0.82 mH\n```");
    expect(b.map(x => x.t)).toEqual(["h", "p", "ul", "ol", "pre"]);
    expect(b[1]).toEqual({ t: "p", c: [{ t: "text", v: "The dip is at 2 kHz." }] });
    expect(b[2].t === "ul" && b[2].items.length).toBe(2);
    expect(b[4]).toEqual({ t: "pre", v: "L1 = 0.82 mH" });
  });
});
