// Listening-test kit, part 6: the printable session sheets. One sheet per listener (instructions, the
// attribute descriptors with their scale ends, and per trial the play order and a box per label and
// attribute to write a rating in), then the test leader's key (which letter is which variant). Plain
// HTML with its own print stylesheet: the app prints it through the browser's print dialog (Save as
// PDF), and the same HTML can be saved as a standalone file. Black on white, whatever the app theme.

import { BLIND_LETTERS, SCALE_MAX, SCALE_MIN, type Protocol } from "./model";
import { makePlan, type Session } from "./random";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The print stylesheet. Scoped under .lt-sheets so it can sit inside the app page as well. */
export const SHEET_CSS = `
.lt-sheets { font: 10.5pt/1.4 "Barlow", "Helvetica Neue", Arial, sans-serif; color: #111; background: #fff; }
.lt-sheets .lt-page { break-after: page; page-break-after: always; }
@media screen { .lt-sheets .lt-page { padding: 14mm; } }
.lt-sheets .lt-page:last-child { break-after: auto; page-break-after: auto; }
.lt-sheets h1 { font-size: 15pt; margin: 0 0 2mm; letter-spacing: .02em; }
.lt-sheets h2 { font-size: 11.5pt; margin: 5mm 0 2mm; text-transform: uppercase; letter-spacing: .08em; }
.lt-sheets .lt-meta { display: flex; gap: 8mm; margin: 0 0 3mm; font-size: 10pt; }
.lt-sheets .lt-meta span { flex: 1; border-bottom: 1px solid #333; padding-bottom: 1mm; }
.lt-sheets .lt-meta b { font-weight: 600; }
.lt-sheets ol, .lt-sheets ul { margin: 0 0 2mm; padding-left: 5mm; }
.lt-sheets table { border-collapse: collapse; width: 100%; box-sizing: border-box; }
.lt-sheets th, .lt-sheets td { border: 1px solid #555; padding: 1.2mm 2mm; text-align: left; vertical-align: top; }
.lt-sheets th { background: #eee; font-weight: 600; }
.lt-sheets .lt-attrs td:first-child { width: 28%; font-weight: 600; }
.lt-sheets .lt-ends { color: #444; font-size: 9pt; white-space: nowrap; }
.lt-sheets .lt-trial { break-inside: avoid; page-break-inside: avoid; margin: 0 0 4mm; }
.lt-sheets .lt-trial-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 4mm; margin: 0 0 1mm; font-weight: 600; }
.lt-sheets .lt-trial-head > span:last-child { white-space: nowrap; }
.lt-sheets .lt-order { font-family: "JetBrains Mono", Menlo, monospace; letter-spacing: .12em; }
.lt-sheets .lt-grid td { padding: 1mm 2mm; }
.lt-sheets .lt-grid td.lt-box { width: 11mm; height: 6mm; }
.lt-sheets .lt-grid th.lt-l { text-align: center; width: 13mm; font-family: "JetBrains Mono", Menlo, monospace; }
.lt-sheets .lt-key { color: #7a0000; }
.lt-sheets .lt-small { font-size: 9pt; color: #444; }
.lt-sheets .lt-mono { font-family: "JetBrains Mono", Menlo, monospace; }
.lt-sheets .lt-trials.is-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 5mm; }
.lt-sheets .lt-trials.is-two .lt-grid td:first-child { font-size: 9pt; }
@page { size: A4; margin: 12mm 13mm; }
`;

const letters = (n: number) => BLIND_LETTERS.slice(0, n).split("");

function instructions(n: number): string {
  const ls = letters(n).join(", ");
  return `<ol>
<li>You will hear ${n > 1 ? `${n} versions of the same music, labelled <b>${ls}</b>. The labels mean nothing and change between listeners.` : "one version of each piece of music."}</li>
<li>In each trial the versions play in the order printed. Ask for any version again as often as you like.</li>
<li>Rate every version on every attribute: write a whole number from <b>${SCALE_MIN}</b> to <b>${SCALE_MAX}</b> in its box. Use the whole scale; there are no right answers.</li>
<li>Judge only what you hear. Keep your head at the marked listening position, and do not talk to the other listeners until the test is over.</li>
</ol>`;
}

function attributeTable(p: Protocol): string {
  const rows = p.attributes.map(a =>
    `<tr><td>${esc(a.name)}</td><td>${esc(a.descriptor)}<div class="lt-ends">${SCALE_MIN} = ${esc(a.low)} · ${SCALE_MAX} = ${esc(a.high)}</div></td></tr>`).join("");
  return `<table class="lt-attrs"><tbody>${rows}</tbody></table>`;
}

function listenerPage(p: Protocol, s: Session, total: number): string {
  const L = letters(p.variants.length);
  const item = (id: string) => p.items.find(i => i.id === id);
  const trials = s.trials.map(t => {
    const head = L.map(l => `<th class="lt-l">${l}</th>`).join("");
    const rows = p.attributes.map(a => `<tr><td>${esc(a.name)}</td>${L.map(() => `<td class="lt-box"></td>`).join("")}</tr>`).join("");
    const order = t.order.map(v => s.labels[v]).join(" ");
    return `<div class="lt-trial"><div class="lt-trial-head"><span>Trial ${t.n} of ${s.trials.length} · ${esc(item(t.item)?.name ?? "")}</span>` +
      `<span>Play order <span class="lt-order">${order}</span></span></div>` +
      `<table class="lt-grid"><thead><tr><th>Attribute</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");
  return `<section class="lt-page">
<h1>${esc(p.title)} · Listener ${s.listener + 1} of ${total}</h1>
<div class="lt-meta"><span><b>Name</b></span><span><b>Date</b></span><span><b>Seat</b></span></div>
<div class="lt-small">${esc(p.venue)}</div>
<h2>Instructions</h2>${instructions(p.variants.length)}
<h2>Attributes</h2>${attributeTable(p)}
<h2>Ratings</h2><div class="lt-trials${L.length <= 4 ? " is-two" : ""}">${trials}</div>
</section>`;
}

function keyPage(p: Protocol, plan: Session[]): string {
  const L = letters(p.variants.length);
  const head = `<tr><th>Listener</th>${L.map(l => `<th class="lt-l">${l}</th>`).join("")}</tr>`;
  const rows = plan.map(s => {
    const byLetter = new Map(Object.entries(s.labels).map(([v, l]) => [l, p.variants.find(x => x.id === v)?.name ?? v]));
    return `<tr><td>${s.listener + 1}</td>${L.map(l => `<td>${esc(byLetter.get(l) ?? "")}</td>`).join("")}</tr>`;
  }).join("");
  const items = p.items.map(i => `<li><b>${esc(i.name)}</b>${i.kind === "signal" ? " (in-app test signal)" : ""}${i.note ? `: ${esc(i.note)}` : ""}</li>`).join("");
  return `<section class="lt-page">
<h1 class="lt-key">Test leader's key: do not show to listeners</h1>
<p class="lt-small">${esc(p.title)} · seed <span class="lt-mono">${p.seed}</span> · ${p.listeners} listeners × ${p.reps} repetitions. The order comes from a Williams balanced Latin square (Bech &amp; Zacharov, <i>Perceptual Audio Evaluation</i>), so every version takes every position equally often; the same seed always gives these sheets.</p>
<h2>Which letter is which</h2><table>${head}${rows}</table>
<h2>Before the test</h2><ul><li>${esc(p.levelNote)}</li><li>Room: ${esc(p.venue)}. Close the door during the test.</li>
<li>Switch between the versions with the same delay and no hint (no visible screen, the same click), so the listener cannot tell them apart by anything but the sound.</li></ul>
<h2>Programme</h2><ul>${items}</ul>
${p.notes ? `<h2>Notes</h2><p>${esc(p.notes)}</p>` : ""}
</section>`;
}

/** The sheets' body: one page per listener (or only `only`), then the key unless left out. */
export function sheetsHtml(p: Protocol, opts: { only?: number; key?: boolean } = {}): string {
  const plan = makePlan(p);
  const pages = plan.filter(s => opts.only === undefined || s.listener === opts.only).map(s => listenerPage(p, s, plan.length));
  if (opts.key !== false) pages.push(keyPage(p, plan));
  return `<div class="lt-sheets">${pages.join("\n")}</div>`;
}

/** A standalone HTML document of the sheets (to save, open in any browser and print). */
export function sheetsDocument(p: Protocol): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(p.title)}: session sheets</title>
<style>body{margin:0;background:#fff}${SHEET_CSS}</style></head>
<body>${sheetsHtml(p)}</body></html>
`;
}
