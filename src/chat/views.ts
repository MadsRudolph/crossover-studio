// The views the chat's show() tool can open, with one line on what each shows (the model picks from
// these). Typed against ViewId, so a view added to the store without a line here fails the type check.
import type { ViewId } from "../state/store";

export const VIEW_INFO: Record<ViewId, string> = {
  guide: "the ranked insights: what to look at next",
  system: "the speaker in 3D, per-unit level and phase at the probe, the checks",
  verdict: "the score out of 100, criterion by criterion, with tested fixes",
  response: "each unit and the sum, on axis and off axis",
  phase: "the units' phase; neighbours should overlap in each crossover region",
  impedance: "the load amplifier channel 2 sees, and each driver's impedance",
  filters: "the digital and passive filter transfer functions, and the voltage at each driver",
  box: "woofer box SPL, cone excursion and vent air speed",
  directivity: "every measured angle side by side",
  time: "group delay, step response and arrival times",
  sensitivity: "how much each part value moves the result (tolerances)",
  limits: "how loud it can play before excursion, vent or power limits",
  compare: "the design against saved snapshots",
  listen: "listen to the design through the measured drivers",
  built: "the measured finished speaker against the prediction",
  listentest: "the listening-test kit",
};
