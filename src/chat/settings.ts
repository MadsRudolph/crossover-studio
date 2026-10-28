// AI chat settings and the instructions the model gets. The model choice is not secret and is kept in
// localStorage; the API key never is (client.ts stores it). The model slugs and prices are OpenRouter's
// (https://openrouter.ai/api/v1/models, October 2026); the cost line assumes a typical question with
// a few tool calls, about 15 000 tokens in and 1 000 out.

export interface ModelChoice { id: string; name: string; note: string; /** USD per million tokens, in / out. */ price: [number, number] }

export const MODELS: ModelChoice[] = [
  { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", note: "Best answers", price: [4, 20] },
  { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", note: "Nearly as good, half the price", price: [2, 10] },
  { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5", note: "Fast and very cheap, simpler answers", price: [0.1, 0.5] },
  { id: "anthropic/claude-fable-5.1", name: "Claude Fable 5.1", note: "Most capable, slowest and dearest", price: [10, 50] },
];
export const DEFAULT_MODEL = MODELS[0].id;

/** Rough cost of one question, "≈ $0.08". */
export function costPerQuestion(m: ModelChoice): string {
  const usd = (15000 * m.price[0] + 1000 * m.price[1]) / 1e6;
  return usd < 0.01 ? "under $0.01" : `≈ $${usd.toFixed(2)}`;
}

const STORE_KEY = "crossover-studio:chat";

export function loadModel(): string {
  try {
    const id = JSON.parse(localStorage.getItem(STORE_KEY) || "{}").model;
    return MODELS.some(m => m.id === id) ? id : DEFAULT_MODEL;
  } catch { return DEFAULT_MODEL; }
}

export function saveModel(id: string) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ model: id })); } catch { /* not remembered */ }
}

export const SYSTEM_PROMPT = `You are a loudspeaker-engineering tutor inside Crossover Studio, the design app for the three-way loudspeaker project of DTU course 34870 Electroacoustics. The student's speaker: a woofer in a vented box behind a MiniDSP low-pass; a midrange and a tweeter behind the MiniDSP high-pass and a passive crossover (low-pass for the midrange, high-pass for the tweeter, optional L-pads and Zobel). All responses come from the group's own Lab D and Lab E measurements, run through the app's engine.

How to answer:
- Plain language, short: a few sentences or a short list. Explain the why (phase, levels, impedance) in words a second-year student follows. British English.
- Answer from this design's numbers, never from general guesses. Check every number you state with a tool (probe, response_band, try_change) before you claim it, and quote the values you got.
- Never invent measurements. The app only knows what was measured (the responses at the measured angles, the impedances, the box fit). If a question needs something that was not measured (distortion, power handling, room effects, a value at an angle that was not measured), say so and say what to measure.
- To suggest a change, test it with try_change first; only then offer it with propose_change, which shows the user an Apply button. Part values must come from the course parts basket; the tools snap to it. Never say a change was made: the user applies it.
- When it helps, use show to open the view and frequency you are talking about.
- Use **bold** sparingly, \`code\` for part names, and units always (Hz, kHz, dB, Ω, mH, µF, mm).`;

/** The second system message: the design as it is now (rebuilt for every question). */
export const contextMessage = (summary: string) =>
  `The current design, from the app's engine (JSON; values in mH, µF, Ω, mm, Hz, dB; levels relative to the system level unless named otherwise):\n${summary}`;
