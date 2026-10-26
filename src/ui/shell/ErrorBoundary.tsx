import { Component, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "../Button";
import { EmptyState } from "../EmptyState";

interface Props { children: ReactNode; label: string; resetKey?: unknown }
interface State { error: Error | null; key: unknown }

/** Keeps one broken view or panel from taking the whole app down; Retry remounts it. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // switching to another view (or design) clears the error
    return props.resetKey !== state.key ? { key: props.resetKey, error: null } : null;
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cs-fill-center">
        <EmptyState
          tone="bad"
          icon={TriangleAlert}
          title={`${this.props.label} ran into a problem`}
          description={<span className="mono cs-error-text">{this.state.error.message}</span>}
          action={<Button icon={RotateCcw} onClick={() => this.setState({ error: null })}>Try again</Button>}
        />
      </div>
    );
  }
}
