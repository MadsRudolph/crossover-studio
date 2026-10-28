// View registry: the workspace shows one of these, in this order (keys 1-9 switch between them).
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, AudioWaveform, Box, ClipboardCheck, Gauge, GitCompareArrows, Orbit, Radar, Spline } from "lucide-react";
import type { ViewId } from "../state/store";
import { SystemView } from "./SystemView";
import { ResponseView } from "./ResponseView";
import { PhaseView } from "./PhaseView";
import { ImpedanceView } from "./ImpedanceView";
import { FiltersView } from "./FiltersView";
import { BoxView } from "./BoxView";
import { DirectivityView } from "./DirectivityView";
import { CompareView } from "./CompareView";
import { ListenView } from "./ListenView";
import { Headphones } from "lucide-react";
import { VerdictView } from "./VerdictView";
import { AsBuiltView } from "./AsBuiltView";
import { FlaskConical } from "lucide-react";
import { Compass, Timer, SlidersVertical, Volume2, ListChecks } from "lucide-react";
import { GuideView } from "./GuideView";
import { TimeView } from "./TimeView";
import { SensitivityView } from "./SensitivityView";
import { LimitsView } from "./LimitsView";
import { ListeningTestView } from "./ListeningTestView";

/** Tab-bar groups: the Guide on its own, then designing, analysing, and building/testing the speaker. */
export type ViewGroup = "guide" | "design" | "analyse" | "build";
export const VIEW_GROUPS: { id: ViewGroup; title: string }[] = [
  { id: "guide", title: "Guide" }, { id: "design", title: "Design" }, { id: "analyse", title: "Analyse" }, { id: "build", title: "Build & test" },
];

export interface ViewDef { id: ViewId; title: string; icon: LucideIcon; component: ComponentType; group: ViewGroup }

export const VIEWS: ViewDef[] = [
  { id: "guide", title: "Guide", icon: Compass, component: GuideView, group: "guide" },
  { id: "system", title: "System", icon: Orbit, component: SystemView, group: "design" },
  { id: "verdict", title: "Verdict", icon: ClipboardCheck, component: VerdictView, group: "design" },
  { id: "response", title: "Response", icon: Activity, component: ResponseView, group: "design" },
  { id: "phase", title: "Phase", icon: AudioWaveform, component: PhaseView, group: "design" },
  { id: "impedance", title: "Impedance", icon: Gauge, component: ImpedanceView, group: "design" },
  { id: "filters", title: "Filters", icon: Spline, component: FiltersView, group: "design" },
  { id: "box", title: "Box", icon: Box, component: BoxView, group: "design" },
  { id: "directivity", title: "Directivity", icon: Radar, component: DirectivityView, group: "analyse" },
  { id: "time", title: "Time", icon: Timer, component: TimeView, group: "analyse" },
  { id: "sensitivity", title: "Sensitivity", icon: SlidersVertical, component: SensitivityView, group: "analyse" },
  { id: "limits", title: "Limits", icon: Volume2, component: LimitsView, group: "analyse" },
  { id: "compare", title: "Compare", icon: GitCompareArrows, component: CompareView, group: "analyse" },
  { id: "listen", title: "Listen", icon: Headphones, component: ListenView, group: "build" },
  { id: "built", title: "As built", icon: FlaskConical, component: AsBuiltView, group: "build" },
  { id: "listentest", title: "Listening test", icon: ListChecks, component: ListeningTestView, group: "build" },
];
