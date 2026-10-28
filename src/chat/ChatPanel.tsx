// The optional AI chat panel (right of the workspace): ask questions about this design in plain words.
// The first time it opens, or whenever no key is saved, it shows the settings card instead of the
// conversation. Answers stream in, tool calls show as a quiet activity line, and a proposed change is
// a card with its before/after score and Apply / Dismiss.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Check, ExternalLink, KeyRound, MessagesSquare, Settings2, Square, Trash2, Wrench, X } from "lucide-react";
import { useStore } from "../state/store";
import { assess } from "../engine";
import { useInsights } from "../insights/useInsights";
import { Button, IconButton } from "../ui";
import type { AiKeyStatus } from "../platform";
import { isTauri } from "../platform";
import { useChat, type ChatItem } from "./chatState";
import { keyStatus, keyStorageNote, plainError, saveKey, testKey } from "./client";
import { starterQuestions } from "./context";
import { Markdown } from "./markdown";
import { costPerQuestion, MODELS } from "./settings";
import type { Proposal } from "./tools";
import "./chat.css";

const KEYS_URL = "https://openrouter.ai/keys";

function openExternal(href: string) {
  if (isTauri()) void import("@tauri-apps/plugin-opener").then(m => m.openUrl(href)).catch(() => {});
  else window.open(href, "_blank", "noopener,noreferrer");
}

export function ChatPanel() {
  const chat = useChat();
  const setUi = useStore(s => s.setUi);
  const [key, setKey] = useState<AiKeyStatus | null>(null);
  useEffect(() => { keyStatus().then(setKey, () => setKey({ stored: false, hint: null })); }, []);
  const showSettings = chat.settings || (key !== null && !key.stored);

  return (
    <aside className="cs-chat" aria-label="Ask about this design">
      <header className="cs-chat-head">
        <MessagesSquare size={14} strokeWidth={1.75} aria-hidden />
        <span className="label-caps">Ask about this design</span>
        <span className="cs-chat-spacer" />
        {!showSettings && chat.items.length > 0 && (
          <IconButton icon={Trash2} size="sm" label="Clear the conversation" onClick={chat.clear} />
        )}
        <IconButton icon={Settings2} size="sm" label="Chat settings" active={showSettings} disabled={!key?.stored && showSettings}
                    hint="API key, model and what is sent." onClick={() => chat.setSettings(!chat.settings)} />
        <IconButton icon={X} size="sm" label="Close the chat" onClick={() => setUi({ chat: false })} />
      </header>
      {key === null ? null : showSettings
        ? <SettingsCard status={key} onStatus={setKey} onDone={() => chat.setSettings(false)} />
        : <Conversation />}
    </aside>
  );
}

// ---------------------------------------------------------------- conversation
function Conversation() {
  const { items, busy, ask, stop } = useChat();
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // follow the answer as it streams in, unless the user has scrolled up to read
  const stick = useRef(true);
  useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items]);
  useEffect(() => { input.current?.focus(); }, []);

  const send = (q = draft) => {
    if (!q.trim() || busy) return;
    stick.current = true;
    void ask(q);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    if (e.key === "Escape" && busy) { e.preventDefault(); stop(); }
  };

  return (
    <>
      <div className="cs-chat-list" ref={list}
           onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {items.length === 0 ? <Starters onPick={send} /> : items.map(it => <Item key={it.id} item={it} />)}
      </div>
      <div className="cs-chat-compose">
        <textarea
          ref={input}
          className="cs-chat-input"
          rows={2}
          value={draft}
          placeholder="Why is there a dip at 2 kHz?"
          aria-label="Your question"
          maxLength={2000}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        {busy
          ? <IconButton icon={Square} variant="subtle" label="Stop the answer" shortcut="Escape" onClick={stop} tooltipSide="top" />
          : <IconButton icon={ArrowUp} variant="primary" label="Send" shortcut="Enter" disabled={!draft.trim()} onClick={() => send()} tooltipSide="top" />}
      </div>
    </>
  );
}

function Starters({ onPick }: { onPick(q: string): void }) {
  const insights = useInsights();
  const prep = useStore(s => s.prep), design = useStore(s => s.design), results = useStore(s => s.results);
  const verdict = useMemo(() => (prep && results ? assess(prep, design, results) : null), [prep, design, results]);
  const qs = starterQuestions(insights, verdict);
  return (
    <div className="cs-chat-empty">
      <p className="cs-chat-empty-title">Ask anything about your design</p>
      <p className="cs-chat-empty-desc">
        Answers come from your own measurements: the model checks its numbers with the app's engine, and it can propose a change for you to apply.
      </p>
      <div className="cs-chat-starters">
        {qs.map(q => <button key={q} type="button" className="cs-chat-starter" onClick={() => onPick(q)}>{q}</button>)}
      </div>
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user": return <div className="cs-chat-msg is-user">{item.text}</div>;
    case "error": return (
      <div className="cs-chat-msg is-error" role="alert">
        {item.text}
        {item.settings && <Button size="sm" variant="subtle" icon={Settings2} onClick={() => useChat.getState().setSettings(true)}>Chat settings</Button>}
      </div>
    );
    case "proposal": return <ProposalCard id={item.id} proposal={item.proposal} state={item.state} />;
    case "assistant": return (
      <div className="cs-chat-msg is-assistant" aria-busy={!item.done}>
        {item.tools.length > 0 && (
          <ul className="cs-chat-tools" aria-label="What the assistant checked">
            {item.tools.map((t, i) => <li key={i}><Wrench size={11} strokeWidth={1.75} aria-hidden />{t}</li>)}
          </ul>
        )}
        {item.text ? <div className="cs-md"><Markdown text={item.text} /></div>
          : !item.done && <span className="cs-chat-typing" aria-label="Thinking"><i /><i /><i /></span>}
      </div>
    );
  }
}

function ProposalCard({ id, proposal: p, state }: { id: string; proposal: Proposal; state: "open" | "applied" | "dismissed" }) {
  const { apply, dismiss } = useChat();
  const current = useStore(s => s.design);
  const stale = state === "open" && JSON.stringify(current) !== JSON.stringify(p.base);
  const ev = p.evaluation, delta = ev.score_after - ev.score_before;
  const tone = delta > 0.05 ? "good" : delta < -0.05 ? "bad" : "neutral";
  return (
    <section className={`cs-chat-proposal is-${state}`} aria-label="Proposed change">
      <header className="cs-chat-proposal-head">
        <span className="label-caps">Proposed change</span>
        <span className={`cs-chat-score mono is-${tone}`}>
          {ev.score_before.toFixed(0)} → {ev.score_after.toFixed(0)}
        </span>
      </header>
      {p.why && <p className="cs-chat-proposal-why">{p.why}</p>}
      <ul className="cs-chat-proposal-list mono">{ev.summary.map(s => <li key={s}>{s}</li>)}</ul>
      {ev.changed.length > 0 && (
        <ul className="cs-chat-proposal-effects">
          {ev.changed.slice(0, 4).map(c => (
            <li key={c.id} title={`${c.before.value} → ${c.after.value}`}>
              <span>{c.title}</span>
              <span className={`mono is-${c.points > 0 ? "good" : c.points < 0 ? "bad" : "neutral"}`}>{c.after.value}</span>
            </li>
          ))}
        </ul>
      )}
      {ev.notes.length > 0 && <p className="cs-chat-proposal-note">{ev.notes.join(" ")}</p>}
      <footer className="cs-chat-proposal-actions">
        {state === "open" ? (
          stale ? <span className="cs-chat-proposal-note">The design has changed since: ask again for an up-to-date proposal.</span> : (
            <>
              <Button size="sm" variant="primary" icon={Check} onClick={() => apply(id)}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(id)}>Dismiss</Button>
            </>
          )
        ) : (
          <span className="cs-chat-proposal-note">{state === "applied" ? "Applied. Undo with Ctrl+Z." : "Dismissed."}</span>
        )}
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------- settings
function SettingsCard({ status, onStatus, onDone }: { status: AiKeyStatus; onStatus(s: AiKeyStatus): void; onDone(): void }) {
  const { model, setModel } = useChat();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  const save = async () => {
    setBusy("save"); setResult(null);
    try { onStatus(await saveKey(draft)); setDraft(""); }
    catch (e) { setResult({ tone: "bad", text: plainError(e) }); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy("test"); setResult(null);
    try { setResult({ tone: "good", text: await testKey(draft || null) }); }
    catch (e) { setResult({ tone: "bad", text: plainError(e) }); }
    finally { setBusy(null); }
  };
  const forget = async () => {
    setResult(null);
    try { onStatus(await saveKey(null)); } catch (e) { setResult({ tone: "bad", text: plainError(e) }); }
  };

  return (
    <div className="cs-chat-settings">
      <div className="cs-chat-settings-intro">
        <span className="cs-chat-settings-icon" aria-hidden><KeyRound size={18} strokeWidth={1.75} /></span>
        <div>
          <p className="cs-chat-empty-title">Optional AI chat</p>
          <p className="cs-chat-empty-desc">
            Ask questions about your design in plain words. It uses an AI model through OpenRouter, paid with your own API key, and needs an internet connection.
          </p>
        </div>
      </div>

      <div className="cs-chat-block">
        <label className="cs-chat-label" htmlFor="cs-chat-key">OpenRouter API key</label>
        {status.stored && (
          <div className="cs-chat-keyrow">
            <span className="mono cs-chat-keyhint">{status.hint}</span>
            <Button size="sm" variant="ghost" onClick={forget}>Remove</Button>
          </div>
        )}
        <div className="cs-chat-keyrow">
          <input id="cs-chat-key" className="cs-chat-field mono" type="password" autoComplete="off" spellCheck={false}
                 placeholder={status.stored ? "Paste a new key to replace it" : "sk-or-v1-…"} value={draft}
                 onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && draft.trim()) void save(); }} />
          <Button size="sm" variant="primary" disabled={!draft.trim()} loading={busy === "save"} onClick={save}>Save</Button>
        </div>
        <div className="cs-chat-keyrow">
          <Button size="sm" variant="subtle" disabled={!draft.trim() && !status.stored} loading={busy === "test"} onClick={test}>Test key</Button>
          <button type="button" className="cs-chat-link" onClick={() => openExternal(KEYS_URL)}>
            Get a key at openrouter.ai <ExternalLink size={11} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        {result && <p className={`cs-chat-result is-${result.tone}`} role="status">{result.text}</p>}
        <p className="cs-chat-note">{keyStorageNote()}</p>
      </div>

      <div className="cs-chat-block" role="radiogroup" aria-label="Model">
        <span className="cs-chat-label">Model</span>
        {MODELS.map(m => (
          <label key={m.id} className={"cs-chat-model" + (m.id === model ? " is-on" : "")}>
            <input type="radio" name="cs-chat-model" checked={m.id === model} onChange={() => setModel(m.id)} />
            <span className="cs-chat-model-text">
              <span className="cs-chat-model-name">{m.name}</span>
              <span className="cs-chat-model-note">{m.note}</span>
            </span>
            <span className="cs-chat-model-cost mono">{costPerQuestion(m)}</span>
          </label>
        ))}
        <p className="cs-chat-note">Rough cost of one question, charged by OpenRouter to your key.</p>
      </div>

      <div className="cs-chat-block">
        <span className="cs-chat-label">What is sent</span>
        <p className="cs-chat-note">
          When you send a question, the app sends a summary of your design (drivers, box, parts, results, verdict and hints) and your question to OpenRouter, which passes them to the model's maker. Your measurement files are not sent. Nothing leaves your computer until you send a question.
        </p>
      </div>

      {status.stored && <Button variant="subtle" block onClick={onDone}>Done</Button>}
    </div>
  );
}
