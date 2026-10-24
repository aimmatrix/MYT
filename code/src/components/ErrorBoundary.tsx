import { Component, type ReactNode } from "react";
import { Button, Panel } from "./ui";

export interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  private retry = (): void => {
    this.setState({ failed: false });
    this.props.onRetry?.();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Panel title="This view could not be displayed" description="Your saved files have not been changed. Try opening the view again.">
        <div className="myt-actions">
          <Button onClick={this.retry}>Try again</Button>
        </div>
      </Panel>
    );
  }
}
