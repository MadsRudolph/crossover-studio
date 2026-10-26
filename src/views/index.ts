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
import { VerdictView } from "./VerdictView";

export interface ViewDef { id: ViewId; title: string; icon: LucideIcon; component: ComponentType }

export const VIEWS: ViewDef[] = [
  { id: "system", title: "System", icon: Orbit, component: SystemView },
  { id: "verdict", title: "Verdict", icon: ClipboardCheck, component: VerdictView },
  { id: "response", title: "Response", icon: Activity, component: ResponseView },
  { id: "phase", title: "Phase", icon: AudioWaveform, component: PhaseView },
  { id: "impedance", title: "Impedance", icon: Gauge, component: ImpedanceView },
  { id: "filters", title: "Filters", icon: Spline, component: FiltersView },
  { id: "box", title: "Box", icon: Box, component: BoxView },
  { id: "directivity", title: "Directivity", icon: Radar, component: DirectivityView },
  { id: "compare", title: "Compare", icon: GitCompareArrows, component: CompareView },
];
