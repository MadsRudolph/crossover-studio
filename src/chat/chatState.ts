// The AI chat's own state (Zustand, apart from the app store, which only holds whether the panel is
// open): what the panel shows, the transcript the model gets, and the actions that send a question,
// stop an answer and apply or dismiss a proposed change.

import { create } from "zustand";
import { useStore } from "../state/store";
import { contextText, type ChatEnv } from "./context";
import { plainError, runChat, toChatError, type ChatMessage, type Transport } from "./client";
import { contextMessage, loadModel, saveModel, SYSTEM_PROMPT } from "./settings";
import { executeTool, TOOL_DEFS, toolLabel, type Proposal } from "./tools";

export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; tools: string[]; done: boolean }
  | { kind: "proposal"; id: string; proposal: Proposal; state: "open" | "applied" | "dismissed" }
  | { kind: "error"; id: string; text: string; /** The fix is in the settings (no key, refused key): offer the way there. */ settings?: boolean };

interface ChatState {
  items: ChatItem[];
  /** Earlier exchanges as the model saw them (user question, tool rounds, answer), oldest first. */
  history: ChatMessage[][];
  busy: boolean;
  model: string;
  /** Set when the settings card is open over the conversation. */
  settings: boolean;
  setModel(id: string): void;
  setSettings(open: boolean): void;
  ask(question: string, transport?: Transport): Promise<void>;
  stop(): void;
  clear(): void;
  apply(id: string): void;
  dismiss(id: string): void;
}

/** Exchanges kept for follow-up questions; older ones are dropped (the design summary is always fresh). */
const KEEP_EXCHANGES = 10;
let abort: AbortController | null = null;
let seq = 0;
const nid = () => `c${++seq}`;

/** The app's current state for the context and the tools, or null while no profile is computed. */
export function currentEnv(): ChatEnv | null {
  const s = useStore.getState();
  if (!s.profile || !s.fit || !s.prep || !s.results) return null;
  return { profile: s.profile, fit: s.fit, prep: s.prep, design: s.design, results: s.results, probe: s.probe, view: s.view };
}

const isAnthropic = (model: string) => model.startsWith("anthropic/");

export const useChat = create<ChatState>()((set, get) => {
  const patch = (id: string, fn: (it: ChatItem) => ChatItem) => set({ items: get().items.map(it => (it.id === id ? fn(it) : it)) });

  return {
    items: [], history: [], busy: false, model: loadModel(), settings: false,
    setModel(id) { saveModel(id); set({ model: id }); },
    setSettings(open) { set({ settings: open }); },

    async ask(question, transport) {
      const q = question.trim();
      if (!q || get().busy) return;
      const env = currentEnv();
      const user: ChatItem = { kind: "user", id: nid(), text: q };
      if (!env) { set({ items: [...get().items, user, { kind: "error", id: nid(), text: "Load a profile first: there is no design to talk about yet." }] }); return; }
      const reply = nid();
      set({ busy: true, items: [...get().items, user, { kind: "assistant", id: reply, text: "", tools: [], done: false }] });
      abort = new AbortController();

      // the instructions and the design summary; the summary is cached by Anthropic models between rounds
      const summary = contextMessage(contextText(env));
      const system: ChatMessage[] = isAnthropic(get().model)
        ? [{ role: "system", content: [{ type: "text", text: SYSTEM_PROMPT }, { type: "text", text: summary, cache_control: { type: "ephemeral" } }] }]
        : [{ role: "system", content: SYSTEM_PROMPT }, { role: "system", content: summary }];
      const userMsg: ChatMessage = { role: "user", content: q };
      try {
        const added = await runChat({
          model: get().model, tools: TOOL_DEFS, signal: abort.signal, transport,
          messages: [...system, ...get().history.flat(), userMsg],
          onText: t => patch(reply, it => (it.kind === "assistant" ? { ...it, text: it.text + t } : it)),
          onTool: (name, args) => {
            let a: Record<string, unknown> = {};
            try { a = JSON.parse(args || "{}"); } catch { /* label without arguments */ }
            patch(reply, it => (it.kind === "assistant" ? { ...it, tools: [...it.tools, toolLabel(name, a)] } : it));
          },
          // each tool call reads the app as it is at that moment (a show() may have moved the probe)
          exec: (name, args) => executeTool(currentEnv() ?? env, name, args, {
            show: (view, f) => { const s = useStore.getState(); s.setView(view); if (f) s.setProbe(f); },
            propose: p => set({ items: [...get().items, { kind: "proposal", id: nid(), proposal: { ...p, id: nid() }, state: "open" }] }),
          }),
        });
        set({ history: [...get().history, [userMsg, ...added]].slice(-KEEP_EXCHANGES) });
        patch(reply, it => (it.kind === "assistant" ? { ...it, done: true } : it));
      } catch (e) {
        const err = toChatError(e);
        patch(reply, it => (it.kind === "assistant" ? { ...it, done: true } : it));
        // an empty, stopped answer is removed rather than left as a blank bubble
        set({ items: get().items.filter(it => !(it.id === reply && it.kind === "assistant" && !it.text && !it.tools.length)) });
        const keyProblem = err.kind === "no-key" || (err.kind === "http" && (err.status === 401 || err.status === 402 || err.status === 404));
        if (err.kind !== "cancelled") set({ items: [...get().items, { kind: "error", id: nid(), text: plainError(err), settings: keyProblem }] });
      } finally {
        abort = null;
        set({ busy: false });
      }
    },

    stop() { abort?.abort(); },
    clear() { abort?.abort(); set({ items: [], history: [] }); },

    apply(id) {
      const it = get().items.find(x => x.id === id);
      if (!it || it.kind !== "proposal" || it.state !== "open") return;
      useStore.getState().setDesign(it.proposal.design);
      patch(id, x => ({ ...x, state: "applied" }) as ChatItem);
    },
    dismiss(id) { patch(id, x => (x.kind === "proposal" ? { ...x, state: "dismissed" } : x)); },
  };
});
