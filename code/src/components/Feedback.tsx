import type { ActionState, AppMode } from "../types";
import { Button } from "./ui";

export type FeedbackKind = "loading" | "success" | "warning" | "failure";

export interface FeedbackProps {
  kind: FeedbackKind;
  message: string;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function Feedback({ kind, message, title, actionLabel, onAction }: FeedbackProps) {
  const tone = kind === "failure" ? "danger" : kind === "warning" ? "warn" : kind === "success" ? "success" : "neutral";
  return (
    <div
      className="myt-banner"
      data-tone={tone}
      role={kind === "failure" ? "alert" : "status"}
      aria-live={kind === "failure" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={kind === "loading" || undefined}
    >
      <div className="myt-banner__text">
        {title ? <strong className="myt-banner__title">{title} </strong> : null}
        <span>{message}</span>
      </div>
      {actionLabel && onAction ? <Button size="sm" onClick={onAction}>{actionLabel}</Button> : null}
    </div>
  );
}

export interface ActionFeedbackProps {
  state: ActionState;
  mode: AppMode;
  successMessage?: string;
}

export function ActionFeedback({ state, mode, successMessage }: ActionFeedbackProps) {
  if (mode === "preview") {
    return <Feedback kind="warning" message="Preview only. Nothing is saved." />;
  }
  switch (state.status) {
    case "idle":
      return null;
    case "pending":
      return <Feedback kind="loading" message="Saving on this device…" />;
    case "saved":
      return <Feedback kind="success" message={successMessage ?? "Saved on this device. Other participants will see the change after sync."} />;
    case "error":
      return (
        <Feedback
          kind="failure"
          title="Not saved."
          message={state.error.message}
          actionLabel="Retry"
          onAction={state.retry}
        />
      );
  }
}
