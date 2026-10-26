// The design score as a small pill that opens the Verdict view (System view, inspector, status bar).
import { useStore } from "../state/store";
import { RATING_TONE, useAssessment } from "./assessment";
import "./verdict.css";

export function ScoreBadge({ withRating = true }: { withRating?: boolean }) {
  const a = useAssessment();
  const setView = useStore(s => s.setView);
  if (!a) return null;
  return (
    <button type="button" className={`vd-mini-score is-${RATING_TONE[a.rating]}`} onClick={() => setView("verdict")}
            title={`${a.headline} Open the verdict to see why.`}>
      Score <b>{a.score}</b>{withRating && <span>{a.rating}</span>}
    </button>
  );
}
