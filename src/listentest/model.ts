// Listening-test kit (project Task 4), part 1: the data model. A protocol says what is compared (the
// variants), on which programme items, which attributes are rated on a 1-7 scale, by how many listeners
// and how often; the ratings are stored one per (listener, repetition, item, variant, attribute).
//
// Method choices follow IEC 60268-13 (listening tests on loudspeakers: the room, level matching, the
// listener position, programme material) and Bech & Zacharov, "Perceptual Audio Evaluation" (2006):
// attributes with a written descriptor and labelled scale ends, blind and balanced presentation order,
// repetitions to check each listener's consistency, and the listener (not the single answer) as the
// unit of analysis.

import type { Design } from "../types";
import type { ViewId } from "../state/store";

export const SCALE_MIN = 1;
export const SCALE_MAX = 7;
/** At most this many variants in one protocol (A-H): more is too much for one listener to keep apart. */
export const MAX_VARIANTS = 8;
export const BLIND_LETTERS = "ABCDEFGH";

// ---------------------------------------------------------------- variants, items, attributes
/** What is compared. "design" (a frozen copy of a design) and "flat" can be played in the app; "room"
 *  is a physical loudspeaker in the listening room (your built speaker, a reference speaker). */
export type VariantKind = "design" | "flat" | "room";

export interface Variant {
  id: string;
  /** The name the test leader sees ("Design 26 Oct", "Our speaker", "Reference: Genelec 8030"). Never shown to listeners. */
  name: string;
  kind: VariantKind;
  /** The design that plays (kind "design"): copied when the variant is added, so later edits do not change the test. */
  design?: Design;
  /** Where the design came from, for the leader: "current design" or the snapshot's name. */
  origin?: string;
  /** This is the group's own design or speaker: its ratings drive the advice. */
  ours?: boolean;
}

/** In-app test signals a programme item can use (the Listen view's sources). */
export type SignalKind = "pink" | "band-wm" | "band-mt" | "sweep";

export interface Item {
  id: string;
  name: string;
  kind: "track" | "signal";
  signal?: SignalKind;
  /** What it reveals, for the sheet: "voice: midrange and the M/T crossover". */
  note?: string;
}

export interface Attribute {
  id: string;
  name: string;
  /** One line the listener reads before rating. */
  descriptor: string;
  /** Scale end labels (1 and 7). */
  low: string;
  high: string;
  /** Which end is the good one ("harshness" is better low). */
  better: "high" | "low";
}

/** Where an attribute lives in frequency, which control changes it most and which view shows it. */
export interface AttributeLink {
  band: [number, number];
  /** Inspector control id (store.ui.focus). */
  focus?: string;
  /** In words: "tweeter L-pad Rs". */
  control: string;
  view: ViewId;
  /** What to try when the rating is on the bad side. */
  advice: string;
}

export interface Protocol {
  title: string;
  /** Room or setting: printed on the sheet. */
  venue: string;
  variants: Variant[];
  items: Item[];
  attributes: Attribute[];
  listeners: number;
  /** Times each listener hears every item (a repeat checks their consistency). */
  reps: number;
  /** Seed of the randomised order: the same seed always gives the same sessions. */
  seed: number;
  /** How the level is matched before the test (printed on the sheet). */
  levelNote: string;
  /** Free notes for the leader (printed on the key page). */
  notes: string;
}

export interface Rating {
  /** 0-based listener and repetition. */
  listener: number;
  rep: number;
  item: string;
  variant: string;
  attr: string;
  value: number;
}

/** What is stored per profile and what export/import moves. */
export interface ListenTestDoc {
  version: 1;
  profileId: string;
  protocol: Protocol;
  ratings: Rating[];
}

// ---------------------------------------------------------------- defaults
export const DEFAULT_ATTRIBUTES: Attribute[] = [
  { id: "bass-ext", name: "Bass extension", descriptor: "How deep the bass goes: can you hear and feel the lowest notes?",
    low: "thin, no deep bass", high: "deep, full bass", better: "high" },
  { id: "bass-tight", name: "Bass tightness", descriptor: "How controlled the bass is: notes start and stop cleanly, no boom or overhang.",
    low: "boomy, slow", high: "tight, precise", better: "high" },
  { id: "clarity", name: "Voice clarity", descriptor: "How clear and natural voices sound: words easy to follow, not boxy, nasal or muffled.",
    low: "muffled, boxy", high: "clear, natural", better: "high" },
  { id: "harsh", name: "Harshness / sibilance", descriptor: "How sharp the treble is: hissing S sounds, piercing cymbals, listening fatigue.",
    low: "smooth", high: "harsh, sibilant", better: "low" },
  { id: "image", name: "Spatial image / width", descriptor: "How well sounds are placed: a stable, focused image with a sense of width and depth.",
    low: "vague, narrow", high: "focused, wide", better: "high" },
  { id: "pref", name: "Overall preference", descriptor: "How much you like the sound overall, taking everything into account.",
    low: "dislike", high: "like very much", better: "high" },
];

/** The frequency region and control behind each default attribute. Custom attributes have no link. */
export const ATTRIBUTE_LINKS: Record<string, AttributeLink> = {
  "bass-ext": { band: [20, 80], focus: "box.L", control: "box tuning (vent length) and woofer gain", view: "box",
    advice: "lower the box tuning (a longer vent) or raise the woofer gain by 1 dB" },
  "bass-tight": { band: [40, 150], focus: "box.L", control: "box tuning (vent length)", view: "box",
    advice: "tune the box for less bass ripple (vent length) and check the W/M crossover for a hump" },
  clarity: { band: [300, 3000], focus: "digital.fc", control: "midrange band: W/M and M/T crossovers", view: "response",
    advice: "look for a dip or hump between 300 Hz and 3 kHz: the W/M crossover frequency and the midrange filter" },
  harsh: { band: [2000, 6000], focus: "tw.pad.Rs", control: "tweeter L-pad Rs", view: "response",
    advice: "lower the tweeter level with a larger series resistor Rs (about 1 dB per basket step)" },
  image: { band: [1000, 10000], focus: "tw.C1", control: "M/T crossover and off-axis response", view: "directivity",
    advice: "smooth the M/T crossover so the 30° response follows the on-axis one" },
  pref: { band: [20, 20000], control: "the whole design", view: "verdict",
    advice: "look at the attribute with the lowest rating first" },
};

export const DEFAULT_ITEMS: Item[] = [
  { id: "it-pink", name: "Pink noise", kind: "signal", signal: "pink", note: "overall tonal balance" },
  { id: "it-voice", name: "Solo voice (name the track)", kind: "track", note: "voice: midrange and the M/T crossover" },
  { id: "it-bass", name: "Acoustic bass line (name the track)", kind: "track", note: "box tuning and the W/M crossover" },
  { id: "it-cymbal", name: "Cymbals and brushes (name the track)", kind: "track", note: "tweeter level and harshness" },
];

/** Quick-add suggestions for programme items (Bech & Zacharov: material that reveals the attributes). */
export const ITEM_SUGGESTIONS: Omit<Item, "id">[] = [
  { name: "Solo voice", kind: "track", note: "voice: midrange and the M/T crossover" },
  { name: "Acoustic bass line", kind: "track", note: "box tuning and the W/M crossover" },
  { name: "Cymbals and brushes", kind: "track", note: "tweeter level and harshness" },
  { name: "A track you know very well", kind: "track", note: "overall impression" },
  { name: "W/M band noise", kind: "signal", signal: "band-wm", note: "woofer/midrange crossover" },
  { name: "M/T band noise", kind: "signal", signal: "band-mt", note: "midrange/tweeter crossover" },
];

export const DEFAULT_LEVEL_NOTE =
  "Match every speaker to the same level at the listening position before the test: pink noise, 78 dB C-weighted (slow), within ±0.5 dB. Keep the volume fixed during the test.";
export const DEFAULT_VENUE = "IEC listening room (IEC 60268-13), listener at the reference position";

export const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export function defaultProtocol(seed = 1 + Math.floor(Math.random() * 99999)): Protocol {
  return {
    title: "Task 4 listening test",
    venue: DEFAULT_VENUE,
    variants: [],
    items: DEFAULT_ITEMS.map(i => ({ ...i })),
    attributes: DEFAULT_ATTRIBUTES.map(a => ({ ...a })),
    listeners: 6,
    reps: 2,
    seed,
    levelNote: DEFAULT_LEVEL_NOTE,
    notes: "",
  };
}

export const emptyDoc = (profileId: string, seed?: number): ListenTestDoc =>
  ({ version: 1, profileId, protocol: defaultProtocol(seed), ratings: [] });

/** A variant can be played in the app (a design or the flat reference), not only in the room. */
export const playable = (v: Variant) => v.kind === "flat" || (v.kind === "design" && !!v.design);

/** The variant whose ratings drive the advice: the one marked "ours", else the first design or room speaker. */
export function oursVariant(p: Protocol): Variant | undefined {
  return p.variants.find(v => v.ours) ?? p.variants.find(v => v.kind !== "flat");
}

// ---------------------------------------------------------------- validation (import, storage)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const int = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;

/** A document read from storage or a file, cleaned up; null when it is not a listening-test document. */
export function readDoc(raw: unknown, profileId: string): ListenTestDoc | null {
  if (!isObj(raw) || !isObj(raw.protocol)) return null;
  const p = raw.protocol, base = defaultProtocol(1);
  const variants: Variant[] = (Array.isArray(p.variants) ? p.variants : []).filter(isObj).slice(0, MAX_VARIANTS).map(v => ({
    id: str(v.id, newId("v")), name: str(v.name, "Variant"),
    kind: v.kind === "design" || v.kind === "flat" || v.kind === "room" ? v.kind : "room",
    ...(isObj(v.design) ? { design: v.design as unknown as Design } : {}),
    ...(typeof v.origin === "string" ? { origin: v.origin } : {}),
    ...(v.ours === true ? { ours: true } : {}),
  }));
  const items: Item[] = (Array.isArray(p.items) ? p.items : []).filter(isObj).map(i => ({
    id: str(i.id, newId("it")), name: str(i.name, "Item"), kind: i.kind === "signal" ? "signal" : "track",
    ...(["pink", "band-wm", "band-mt", "sweep"].includes(i.signal as string) ? { signal: i.signal as SignalKind } : {}),
    ...(typeof i.note === "string" ? { note: i.note } : {}),
  }));
  const attributes: Attribute[] = (Array.isArray(p.attributes) ? p.attributes : []).filter(isObj).map(a => ({
    id: str(a.id, newId("at")), name: str(a.name, "Attribute"), descriptor: str(a.descriptor),
    low: str(a.low, "low"), high: str(a.high, "high"), better: a.better === "low" ? "low" : "high",
  }));
  const ids = { v: new Set(variants.map(v => v.id)), i: new Set(items.map(i => i.id)), a: new Set(attributes.map(a => a.id)) };
  const protocol: Protocol = {
    title: str(p.title, base.title), venue: str(p.venue, base.venue), variants, items, attributes,
    listeners: int(p.listeners, 1, 40, base.listeners), reps: int(p.reps, 1, 5, base.reps),
    seed: int(p.seed, 0, 2 ** 31 - 1, base.seed), levelNote: str(p.levelNote, base.levelNote), notes: str(p.notes),
  };
  const ratings: Rating[] = (Array.isArray(raw.ratings) ? raw.ratings : []).filter(isObj).flatMap(r => {
    const value = Number(r.value), listener = Number(r.listener), rep = Number(r.rep);
    const item = str(r.item), variant = str(r.variant), attr = str(r.attr);
    if (!ids.v.has(variant) || !ids.i.has(item) || !ids.a.has(attr)) return [];
    if (!Number.isInteger(listener) || listener < 0 || listener >= protocol.listeners) return [];
    if (!Number.isInteger(rep) || rep < 0 || rep >= protocol.reps) return [];
    if (!(value >= SCALE_MIN && value <= SCALE_MAX)) return [];
    return [{ listener, rep, item, variant, attr, value }];
  });
  return { version: 1, profileId: str(raw.profileId, profileId), protocol, ratings };
}
