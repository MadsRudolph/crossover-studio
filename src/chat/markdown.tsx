// A small, safe Markdown renderer for chat answers: paragraphs, bullet and numbered lists, headings,
// code blocks, and inline **bold**, *italic*, `code` and [links](https://…). It builds React elements
// from a parsed tree and never injects HTML, so whatever the model writes is shown as text. Links open
// in the system browser (http and https only); anything else stays plain text.

import { Fragment, type ReactNode } from "react";
import { isTauri } from "../platform";

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "a"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "pre"; v: string };

const SAFE_URL = /^https?:\/\/[^\s<>"]+$/i;

/** Inline markup of one line or paragraph. Unclosed markers stay as typed. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
  for (let i = 0; i < s.length;) {
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) { flush(); out.push({ t: "code", v: m[1] }); i += m[0].length; continue; }
    if ((m = /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest)) || (m = /^__(?=\S)([\s\S]*?\S)__/.exec(rest))) {
      flush(); out.push({ t: "b", c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if ((m = /^\*(?=[^\s*])([^*]*?[^\s*])\*/.exec(rest)) || (/[^\w]$|^$/.test(s.slice(0, i)) && (m = /^_(?=\S)([^_]*?\S)_(?!\w)/.exec(rest)))) {
      flush(); out.push({ t: "i", c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      if (SAFE_URL.test(m[2])) out.push({ t: "a", href: m[2], c: parseInline(m[1]) });
      else out.push(...parseInline(m[1]));
      i += m[0].length; continue;
    }
    text += s[i++];
  }
  flush();
  return out;
}

/** Block structure of a whole answer. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const endPara = () => { if (para.length) { out.push({ t: "p", c: parseInline(para.join(" ")) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      endPara();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push({ t: "pre", v: code.join("\n") });
      continue;
    }
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (h) { endPara(); out.push({ t: "h", c: parseInline(h[1].replace(/\s#+\s*$/, "")) }); continue; }
    const li = /^\s*(?:([-*+•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      endPara();
      const kind = li[1] ? "ul" : "ol";
      const prev = out[out.length - 1];
      const item = parseInline(li[3]);
      if (prev && prev.t === kind) prev.items.push(item);
      else out.push({ t: kind, items: [item] });
      continue;
    }
    if (!line.trim()) { endPara(); continue; }
    // a continuation line of a list item joins that item
    const prev = out[out.length - 1];
    if (!para.length && prev && (prev.t === "ul" || prev.t === "ol") && /^\s+\S/.test(line)) {
      prev.items[prev.items.length - 1].push({ t: "text", v: " " }, ...parseInline(line.trim()));
      continue;
    }
    para.push(line.trim());
  }
  endPara();
  return out;
}

function openLink(href: string) {
  if (isTauri()) void import("@tauri-apps/plugin-opener").then(m => m.openUrl(href)).catch(() => {});
  else window.open(href, "_blank", "noopener,noreferrer");
}

function renderInline(c: Inline[]): ReactNode {
  return c.map((n, k) => {
    switch (n.t) {
      case "text": return <Fragment key={k}>{n.v}</Fragment>;
      case "code": return <code key={k}>{n.v}</code>;
      case "b": return <strong key={k}>{renderInline(n.c)}</strong>;
      case "i": return <em key={k}>{renderInline(n.c)}</em>;
      case "a": return (
        <a key={k} href={n.href} title={n.href} onClick={e => { e.preventDefault(); openLink(n.href); }}>{renderInline(n.c)}</a>
      );
    }
  });
}

export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((b, k) => {
        switch (b.t) {
          case "p": return <p key={k}>{renderInline(b.c)}</p>;
          case "h": return <p key={k} className="cs-md-h">{renderInline(b.c)}</p>;
          case "pre": return <pre key={k}>{b.v}</pre>;
          case "ul": return <ul key={k}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ul>;
          case "ol": return <ol key={k}>{b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}</ol>;
        }
      })}
    </>
  );
}
