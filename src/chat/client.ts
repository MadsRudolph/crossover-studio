// The AI chat's connection to OpenRouter: key storage, the streamed request, and the tool loop.
// The desktop app sends the request from Rust (src-tauri/src/ai.rs), so the webview's CORS rules do not
// matter and the key never sits in the webview after it is saved. The browser dev build (`npm run dev`)
// calls fetch() directly with a key kept in sessionStorage for the tab only.
// Nothing here touches the network until the user sends a message or tests a key.

import { aiCancel, aiChat, aiKeyStatus, aiSetKey, aiTestKey, isTauri, type AiKeyStatus } from "../platform";

export const OPENROUTER = "https://openrouter.ai/api/v1";

// ---------------------------------------------------------------- messages (OpenAI chat format)
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export type ChatMessage =
  | { role: "system"; content: string | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// ---------------------------------------------------------------- errors
export type ChatErrorKind = "no-key" | "http" | "offline" | "cancelled" | "storage" | "bad-key" | "other";

export class ChatError extends Error {
  constructor(public kind: ChatErrorKind, message: string, public status?: number) { super(message); }
}

/** Any thrown value as a ChatError: the Rust commands reject with {kind, status, message}. */
export function toChatError(e: unknown): ChatError {
  if (e instanceof ChatError) return e;
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    const o = e as { kind: ChatErrorKind; message: string; status?: number };
    return new ChatError(o.kind, String(o.message), o.status ?? undefined);
  }
  if (e instanceof DOMException && e.name === "AbortError") return new ChatError("cancelled", "Stopped.");
  // fetch() rejects with a TypeError when there is no connection
  if (e instanceof TypeError) return new ChatError("offline", e.message);
  return new ChatError("other", e instanceof Error ? e.message : String(e));
}

/** What went wrong, for the user: one or two plain sentences and what to do. */
export function plainError(e: unknown): string {
  const err = toChatError(e);
  switch (err.kind) {
    case "no-key": return "No API key yet. Paste your OpenRouter key in the chat settings.";
    case "bad-key": return err.message;
    case "offline": return "Could not reach OpenRouter. Check your internet connection and try again.";
    case "cancelled": return "Stopped.";
    case "storage": return `Could not store the key: ${err.message}`;
    case "http":
      switch (err.status) {
        case 401: return "OpenRouter did not accept the API key. Check that you pasted the whole key, or make a new one at openrouter.ai/keys.";
        case 402: return "Your OpenRouter account is out of credit. Add credit at openrouter.ai/credits, or pick a cheaper model.";
        case 403: return `OpenRouter refused the request${err.message ? `: ${err.message}` : "."}`;
        case 404: return "That model is not available on OpenRouter any more. Pick another one in the chat settings.";
        case 408: case 504: return "The model took too long to answer. Try again, or pick a faster model.";
        case 429: return "Too many requests right now. Wait a minute and try again.";
        case 502: case 503: return "The model's provider is down or overloaded. Try again in a moment, or pick another model.";
        default: return `OpenRouter answered with an error${err.status ? ` (${err.status})` : ""}${err.message ? `: ${err.message}` : "."}`;
      }
    default: return `Something went wrong: ${err.message}`;
  }
}

// ---------------------------------------------------------------- key storage
const SESSION_KEY = "crossover-studio:openrouter-key";

const sessionGet = () => { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } };
const sessionSet = (k: string | null) => {
  try { if (k) sessionStorage.setItem(SESSION_KEY, k); else sessionStorage.removeItem(SESSION_KEY); } catch { /* not kept */ }
};
const maskKey = (k: string) => `${k.startsWith("sk-or-v1-") ? "sk-or-v1-" : k.slice(0, 3)}…${k.slice(-4)}`;

/** Where the key is kept on this build, for the settings note. */
export const keyStorageNote = (): string => isTauri()
  ? "Saved on this computer only, in the app's settings folder (readable by your user account only)."
  : "Browser preview: the key is kept for this tab only and forgotten when you close it.";

export async function keyStatus(): Promise<AiKeyStatus> {
  if (isTauri()) return aiKeyStatus().catch(e => { throw toChatError(e); });
  const k = sessionGet();
  return { stored: !!k, hint: k ? maskKey(k) : null };
}

export async function saveKey(key: string | null): Promise<AiKeyStatus> {
  const k = key?.trim() || null;
  if (k && /\s/.test(k)) throw new ChatError("bad-key", "That does not look like an API key: paste the whole key, on one line.");
  if (isTauri()) return aiSetKey(k).catch(e => { throw toChatError(e); });
  sessionSet(k);
  return keyStatus();
}

/** Checks a key (the stored one when null) and describes its credit in one line. */
export async function testKey(key: string | null): Promise<string> {
  let info: any;
  try {
    if (isTauri()) info = await aiTestKey(key?.trim() || null);
    else {
      const k = key?.trim() || sessionGet();
      if (!k) throw new ChatError("no-key", "No API key saved yet.");
      const r = await fetch(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${k}` } });
      if (!r.ok) throw new ChatError("http", errorMessage(await r.text()), r.status);
      info = await r.json();
    }
  } catch (e) { throw toChatError(e); }
  const d = info?.data ?? {};
  const usd = (x: unknown) => (typeof x === "number" ? `$${x.toFixed(2)}` : null);
  const used = usd(d.usage), left = usd(d.limit_remaining);
  return ["The key works.", used && `${used} used so far`, left && `${left} left on this key`].filter(Boolean).join(" ").replace(/far \$/, "far, $") + ".";
}

/** The human part of an OpenRouter error body ({"error": {"message": ...}}). */
export function errorMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    const m = j?.error?.message ?? (typeof j?.error === "string" ? j.error : null);
    if (m) return String(m).slice(0, 300);
  } catch { /* not JSON */ }
  return body.trim().slice(0, 300);
}

// ---------------------------------------------------------------- transport
/** Sends one request body and passes every server-sent `data:` payload to onData. */
export interface Transport {
  send(body: string, onData: (data: string) => void, signal: AbortSignal): Promise<void>;
}

/** Splits a server-sent event stream into its `data:` payloads, across arbitrary chunk boundaries. */
export class SseParser {
  private buf = "";
  feed(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, "");
      this.buf = this.buf.slice(nl + 1);
      if (line.startsWith("data:")) out.push(line.slice(5).trimStart());
    }
    return out;
  }
}

/** The desktop app: the request goes out from Rust. */
export const desktopTransport: Transport = {
  async send(body, onData, signal) {
    const stop = () => { void aiCancel().catch(() => {}); };
    signal.addEventListener("abort", stop, { once: true });
    try { await aiChat(body, d => { if (!signal.aborted && d !== "[DONE]") onData(d); }); }
    catch (e) { throw toChatError(e); }
    finally { signal.removeEventListener("abort", stop); }
    if (signal.aborted) throw new ChatError("cancelled", "Stopped.");
  },
};

/** The browser dev build: fetch() straight to OpenRouter with the tab's key. */
export const browserTransport: Transport = {
  async send(body, onData, signal) {
    const key = sessionGet();
    if (!key) throw new ChatError("no-key", "No API key saved yet.");
    let r: Response;
    try {
      r = await fetch(`${OPENROUTER}/chat/completions`, {
        method: "POST", body, signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Crossover Studio" },
      });
    } catch (e) { throw toChatError(e); }
    if (!r.ok) throw new ChatError("http", errorMessage(await r.text()), r.status);
    if (!r.body) throw new ChatError("offline", "The answer had no body.");
    const reader = r.body.getReader(), dec = new TextDecoder(), sse = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const d of sse.feed(dec.decode(value, { stream: true }))) { if (d === "[DONE]") return; onData(d); }
      }
    } catch (e) { throw toChatError(e); }
  },
};

export const defaultTransport = (): Transport => (isTauri() ? desktopTransport : browserTransport);

// ---------------------------------------------------------------- one streamed turn
export interface Turn { content: string; toolCalls: ToolCall[]; finish: string | null }

/** Folds one streamed chunk into the turn. A mid-stream error payload is thrown as a ChatError. */
export function mergeChunk(turn: Turn, data: string): string {
  let j: any;
  try { j = JSON.parse(data); } catch { return ""; }
  if (j?.error) throw new ChatError("http", String(j.error.message ?? "error"), Number(j.error.code) || undefined);
  const ch = j?.choices?.[0];
  if (!ch) return "";
  if (ch.finish_reason) turn.finish = ch.finish_reason;
  const delta = ch.delta ?? {};
  for (const tc of delta.tool_calls ?? []) {
    const i = typeof tc.index === "number" ? tc.index : turn.toolCalls.length;
    const cur = turn.toolCalls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.function.name += tc.function.name;
    if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
  }
  const text = typeof delta.content === "string" ? delta.content : "";
  turn.content += text;
  return text;
}

// ---------------------------------------------------------------- the tool loop
export interface RunOptions {
  model: string;
  /** The conversation so far, system messages first. */
  messages: ChatMessage[];
  tools: readonly unknown[];
  /** Runs one tool call locally and returns its JSON answer. */
  exec(name: string, args: string): string;
  /** Streamed answer text, piece by piece (a new round continues the same answer). */
  onText(text: string): void;
  onTool?(name: string, args: string): void;
  signal: AbortSignal;
  transport?: Transport;
  /** Tool rounds before the model must answer in words. */
  maxRounds?: number;
}

/** Sends the conversation, runs the tools the model calls, and repeats until it answers. Returns the
 *  messages this exchange added (assistant turns with tool calls, tool results, the final answer). */
export async function runChat(o: RunOptions): Promise<ChatMessage[]> {
  const transport = o.transport ?? defaultTransport(), max = o.maxRounds ?? 8;
  const added: ChatMessage[] = [];
  for (let round = 0; ; round++) {
    const last = round >= max;
    const body = JSON.stringify({
      model: o.model, stream: true, max_tokens: 1500,
      messages: [...o.messages, ...added],
      // the last round has no tools, so the model has to answer with what it found
      ...(last ? {} : { tools: o.tools, tool_choice: "auto" }),
    });
    const turn: Turn = { content: "", toolCalls: [], finish: null };
    await transport.send(body, d => { const t = mergeChunk(turn, d); if (t) o.onText(t); }, o.signal);
    if (o.signal.aborted) throw new ChatError("cancelled", "Stopped.");
    const calls = turn.toolCalls.filter(c => c.function.name);
    calls.forEach((c, i) => { if (!c.id) c.id = `call_${round}_${i}`; });
    added.push({ role: "assistant", content: turn.content || null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length || last) return added;
    if (turn.content) o.onText("\n\n");
    for (const c of calls) {
      o.onTool?.(c.function.name, c.function.arguments);
      added.push({ role: "tool", tool_call_id: c.id, content: o.exec(c.function.name, c.function.arguments) });
    }
  }
}
