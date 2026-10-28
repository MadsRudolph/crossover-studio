/// <reference types="node" />
// The printable session sheets: one page per listener plus the key, the play order printed with the
// listener's own letters, every text escaped, and the key decoding the letters. Writes the standalone
// HTML to <tmp>/xs-listening-sheets.html for a look in a browser.
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BUNDLED_PROFILES, defaultDesign } from "../state/store";
import { demoDoc } from "./demo";
import { makePlan } from "./random";
import { sheetsDocument, sheetsHtml } from "./sheet";

const profile = BUNDLED_PROFILES[0];
const doc = demoDoc(profile, defaultDesign(profile));
const p = doc.protocol;

describe("session sheets", () => {
  const html = sheetsHtml(p);

  it("has one page per listener and the key last", () => {
    expect((html.match(/class="lt-page"/g) ?? []).length).toBe(p.listeners + 1);
    expect(html.lastIndexOf("Test leader's key")).toBeGreaterThan(html.lastIndexOf(`Listener ${p.listeners} of ${p.listeners}`));
  });

  it("prints each trial's order in the listener's letters, and a box per letter and attribute", () => {
    const s = makePlan(p)[0];
    const first = sheetsHtml(p, { only: 0, key: false });
    for (const t of s.trials) expect(first).toContain(`<span class="lt-order">${t.order.map(v => s.labels[v]).join(" ")}</span>`);
    expect((first.match(/class="lt-box"/g) ?? []).length).toBe(s.trials.length * p.attributes.length * p.variants.length);
    expect(first).not.toContain("Test leader");
    // the variant names never appear on a listener's page
    for (const v of p.variants) expect(first).not.toContain(v.name);
  });

  it("escapes user text", () => {
    const q = structuredClone(p);
    q.title = `<script>alert("x")</script> & co`;
    const h = sheetsHtml(q);
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
  });

  it("is a standalone document with its print stylesheet", () => {
    const d = sheetsDocument(p);
    expect(d.startsWith("<!doctype html>")).toBe(true);
    expect(d).toContain("@page { size: A4");
    writeFileSync(join(tmpdir(), "xs-listening-sheets.html"), d);
  });
});
