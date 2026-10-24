import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ActionResult, AvailabilityKey, TimeOption } from "../types";
import type { TimeVotePanelProps } from "../ui-contract";
import { formatLondonDateTime, formatLondonTimeRange } from "../domain/londonTime";
import { Button, Chip, Panel } from "./ui";

/*
 * Time voting (S7). Presentation only: no storage, no clock, no presence, no host connection.
 *
 * - Which options can be chosen comes from the parent (`validFutureOptionIds`).
 * - The counts, the leader and any tie come from the parent's T4 consensus. This file never
 *   tallies votes; the only arithmetic is a bar width derived from the supplied counts.
 * - A vote is advisory and is not an RSVP. Nothing here announces an agreed time.
 */

const AVAILABILITY_LABELS: Record<AvailabilityKey, string> = {
  "weekday-evening": "Weekday evening",
  "weekend-day": "Weekend day",
  "weekend-evening": "Weekend evening",
};

type Feedback =
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string; optionId: string | null };

function describeOption(option: TimeOption): string {
  return option.endAt !== null
    ? formatLondonTimeRange(option.startAt, option.endAt)
    : formatLondonDateTime(option.startAt);
}

function votesText(count: number): string {
  return `${count} ${count === 1 ? "vote" : "votes"}`;
}

function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function Notice({ tone, children, action, role }: { tone: "neutral" | "accent" | "warn" | "danger"; children: ReactNode; action?: ReactNode; role?: "alert" }) {
  return (
    <div className="myt-banner" data-tone={tone} role={role}>
      <div className="myt-banner__text">{children}</div>
      {action}
    </div>
  );
}

export function TimeVotePanel({
  mode,
  currentUser,
  activityId,
  options,
  validFutureOptionIds,
  myInterest,
  myVote,
  consensus,
  planExists,
  actionState,
  onSetVote,
  onGoToInterest,
}: TimeVotePanelProps) {
  const groupName = useId();
  const statusId = useId();
  const inFlight = useRef(false);
  const generation = useRef(0);
  /** The choice being saved right now. Shown as selected until the callback settles. */
  const [pendingChoice, setPendingChoice] = useState<{ optionId: string | null } | null>(null);
  /** The choice that last saved successfully, held until the saved vote prop catches up. */
  const [lastSaved, setLastSaved] = useState<{ optionId: string | null } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const userKey = currentUser?.id ?? "";
  useEffect(() => {
    // New activity or a different person: forget local save state, and ignore any save still in flight.
    generation.current += 1;
    inFlight.current = false;
    setPendingChoice(null);
    setLastSaved(null);
    setFeedback(null);
    return () => {
      generation.current += 1;
    };
  }, [activityId, userKey]);

  const savedOptionId = myVote.state === "ready" ? (myVote.value?.optionId ?? null) : null;
  const savedUpdatedAt = myVote.state === "ready" ? (myVote.value?.updatedAt ?? null) : null;
  useEffect(() => {
    // The persisted vote changed, so it is the source of truth again.
    setLastSaved(null);
  }, [savedOptionId, savedUpdatedAt]);

  const signedIn = mode === "live" && currentUser !== null;
  const interested = myInterest.state === "ready" && myInterest.value === "interested";
  const canVote = signedIn && onSetVote !== undefined && !planExists && interested && myVote.state === "ready";
  const busy = pendingChoice !== null || actionState.status === "pending";

  const displayedOptionId = pendingChoice ? pendingChoice.optionId : lastSaved ? lastSaved.optionId : savedOptionId;

  const byId = new Map<string, TimeOption>();
  for (const option of options) if (!byId.has(option.id)) byId.set(option.id, option);

  const consensusValue = consensus.state === "ready" ? consensus.value : null;
  const countById = consensusValue ? new Map(consensusValue.counts.map((entry) => [entry.optionId, entry.count])) : null;
  const voterCount = consensusValue?.voterCount ?? 0;
  const suggestedId = consensusValue?.suggestedOptionId ?? null;
  const tiedIds = new Set(consensusValue?.tiedOptionIds ?? []);

  // Valid options in the consensus order, then any valid option it did not list, then unavailable ones.
  const ordered: TimeOption[] = [];
  const placed = new Set<string>();
  if (consensusValue) {
    for (const entry of consensusValue.counts) {
      const option = byId.get(entry.optionId);
      if (option && validFutureOptionIds.has(option.id) && !placed.has(option.id)) {
        ordered.push(option);
        placed.add(option.id);
      }
    }
  }
  for (const option of byId.values()) {
    if (validFutureOptionIds.has(option.id) && !placed.has(option.id)) {
      ordered.push(option);
      placed.add(option.id);
    }
  }
  const hasValidOption = ordered.length > 0;
  for (const option of byId.values()) {
    if (!placed.has(option.id)) ordered.push(option);
  }

  const displayedIsStale = displayedOptionId !== null && !validFutureOptionIds.has(displayedOptionId);
  const staleOption = displayedIsStale && displayedOptionId !== null ? byId.get(displayedOptionId) : undefined;
  const staleLabel = staleOption ? describeOption(staleOption) : null;

  async function choose(optionId: string | null): Promise<void> {
    if (!canVote || !onSetVote || inFlight.current) return;
    if (optionId !== null && !validFutureOptionIds.has(optionId)) return;
    const run = generation.current;
    inFlight.current = true;
    setPendingChoice({ optionId });
    setFeedback(null);

    let result: ActionResult<unknown>;
    try {
      result = await onSetVote(optionId);
    } catch {
      result = { ok: false, error: { code: "io", message: "Something went wrong while saving." } };
    }
    if (run !== generation.current) return; // The activity or person changed while this was saving.

    inFlight.current = false;
    setPendingChoice(null);
    if (result.ok) {
      setLastSaved({ optionId });
      const label = optionId !== null && byId.has(optionId) ? describeOption(byId.get(optionId) as TimeOption) : null;
      setFeedback({
        kind: "saved",
        message: label ? `Saved. You chose ${label}. It can take a moment to show up for others.` : "Saved. Your choice is cleared.",
      });
    } else {
      setFeedback({ kind: "error", message: result.error.message, optionId });
    }
  }

  /* ----------------------------------------------------------- gate notice */

  let gate: ReactNode = null;
  if (planExists) {
    gate = (
      <Notice tone="neutral">
        A plan has already been confirmed for this activity, so time voting is closed.
      </Notice>
    );
  } else if (mode === "preview") {
    gate = <Notice tone="neutral">You are previewing MYT, so voting is switched off.</Notice>;
  } else if (currentUser === null) {
    gate = <Notice tone="neutral">Sign in to Lightfern to vote on a time.</Notice>;
  } else if (!onSetVote) {
    gate = <Notice tone="neutral">Voting is not available right now.</Notice>;
  } else if (myInterest.state === "loading") {
    gate = <Notice tone="neutral">Checking whether you have joined…</Notice>;
  } else if (myInterest.state === "error") {
    gate = (
      <Notice tone="danger" role="alert">
        We could not check your interest, so voting is paused. {myInterest.error.message}
      </Notice>
    );
  } else if (!interested) {
    const hadChoice = savedOptionId !== null;
    gate = (
      <Notice
        tone="accent"
        action={
          <Button size="sm" onClick={onGoToInterest}>
            Go to interest
          </Button>
        }
      >
        <span className="myt-banner__title">{myInterest.value === "withdrawn" ? "Rejoin to vote." : "Join first to vote."}</span> Only people who are interested count toward the time.
        {hadChoice ? " Your earlier choice is kept, but it is not counted while you are not interested." : ""}
      </Notice>
    );
  } else if (myVote.state === "loading") {
    gate = <Notice tone="neutral">Loading your saved choice…</Notice>;
  } else if (myVote.state === "error") {
    gate = (
      <Notice tone="danger" role="alert">
        We could not load your saved choice, so voting is paused. {myVote.error.message}
      </Notice>
    );
  }

  const staleNotice =
    displayedIsStale && !planExists ? (
      <Notice
        tone="warn"
        action={
          canVote ? (
            <Button size="sm" variant="quiet" onClick={() => void choose(null)}>
              Clear my choice
            </Button>
          ) : undefined
        }
      >
        <span className="myt-banner__title">Your saved choice is no longer available.</span>{" "}
        {staleLabel ? `${staleLabel} has passed or been withdrawn` : "That time is no longer listed"}, so it is not counted. Pick another time or clear your choice.
      </Notice>
    ) : null;

  /* --------------------------------------------------------------- results */

  const labelFor = (id: string): string => (byId.has(id) ? describeOption(byId.get(id) as TimeOption) : "another time");
  let result: ReactNode;
  if (consensus.state === "loading") {
    result = "Counting votes…";
  } else if (consensus.state === "error") {
    result = `Votes cannot be shown right now. ${consensus.error.message}`;
  } else if (!consensusValue || voterCount === 0) {
    result = canVote ? "No votes yet. Be the first to pick a time." : "No votes yet.";
  } else if (tiedIds.size >= 2) {
    const tiedCount = consensusValue.counts.find((entry) => tiedIds.has(entry.optionId))?.count ?? 0;
    result = `It is a tie: ${listText([...tiedIds].map(labelFor))} have ${votesText(tiedCount)} each.${planExists ? "" : " The organiser decides."}`;
  } else if (suggestedId !== null) {
    const leadCount = countById?.get(suggestedId) ?? 0;
    result = `${labelFor(suggestedId)} has the most votes${planExists ? "" : " so far"} (${leadCount}).${planExists ? "" : " The organiser still chooses the final time."}`;
  } else {
    result = `${votesText(voterCount)}${planExists ? "" : " so far. The organiser chooses the final time"}.`;
  }

  /* ----------------------------------------------------------------- feeds */

  let errorBlock: ReactNode = null;
  if (feedback?.kind === "error") {
    const retryFor = feedback.optionId;
    errorBlock = (
      <Notice
        tone="danger"
        role="alert"
        action={
          canVote ? (
            <Button size="sm" onClick={() => void choose(retryFor)}>
              Try again
            </Button>
          ) : undefined
        }
      >
        <span className="myt-banner__title">Your choice was not saved.</span> Your previous choice is still in place. {feedback.message}
      </Notice>
    );
  } else if (feedback === null && !busy && actionState.status === "error") {
    errorBlock = (
      <Notice
        tone="danger"
        role="alert"
        action={
          <Button size="sm" onClick={actionState.retry}>
            Try again
          </Button>
        }
      >
        <span className="myt-banner__title">Your choice was not saved.</span> Your previous choice is still in place. {actionState.error.message}
      </Notice>
    );
  }

  const statusText = busy ? "Saving your choice…" : feedback?.kind === "saved" ? feedback.message : "";

  return (
    <Panel title="Pick a time" description="Times are London time. Choose the one that suits you best.">
      <div className="myt-stack">
        {gate}
        {staleNotice}

        {ordered.length === 0 ? (
          <div className="myt-empty">
            <p className="myt-empty__title">No times to choose from yet</p>
            <p className="myt-empty__body">This activity has no proposed times to vote on yet.</p>
          </div>
        ) : (
          <fieldset className="myt-fieldset" aria-busy={busy || undefined}>
            <legend className="myt-visually-hidden">Time choices</legend>
            <div className="myt-options" role="radiogroup" aria-label="Time choices">
              {ordered.map((option) => {
                const valid = validFutureOptionIds.has(option.id);
                const selected = displayedOptionId === option.id;
                const count = countById?.get(option.id);
                const labels = option.availabilityKeys.map((key) => AVAILABILITY_LABELS[key]).filter(Boolean);
                const leading = valid && suggestedId === option.id;
                const tied = valid && tiedIds.has(option.id);
                const width = voterCount > 0 && count !== undefined ? `${Math.round((count / voterCount) * 100)}%` : "0%";
                return (
                  <label className="myt-option" key={option.id}>
                    <input
                      className="myt-option__input"
                      type="radio"
                      name={groupName}
                      value={option.id}
                      checked={selected}
                      disabled={!canVote || !valid}
                      aria-describedby={statusId}
                      onChange={() => void choose(option.id)}
                    />
                    <span className="myt-option__body">
                      <span className="myt-option__title">{describeOption(option)}</span>
                      {labels.length > 0 ? <span className="myt-option__meta">{labels.join(" · ")}</span> : null}
                      {selected || leading || tied || !valid ? (
                        <span className="myt-badges">
                          {selected ? <Chip tone="accent">Your choice</Chip> : null}
                          {selected && valid && !interested ? <Chip tone="warn">Not counted</Chip> : null}
                          {!valid ? <Chip tone="warn">No longer available</Chip> : null}
                          {leading ? <Chip tone="neutral">Most votes</Chip> : null}
                          {tied ? <Chip tone="neutral">Tied</Chip> : null}
                        </span>
                      ) : null}
                    </span>
                    {valid ? (
                      <span className="myt-option__tally">
                        {count !== undefined ? (
                          <>
                            <span className="myt-bar" aria-hidden="true">
                              <span style={{ width }} />
                            </span>
                            {votesText(count)}
                          </>
                        ) : consensus.state === "loading" ? (
                          "Counting…"
                        ) : (
                          "Votes unavailable"
                        )}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {canVote && displayedOptionId !== null && !displayedIsStale ? (
          <div className="myt-actions">
            <Button size="sm" variant="quiet" pending={pendingChoice !== null && pendingChoice.optionId === null} onClick={() => void choose(null)}>
              Clear my choice
            </Button>
          </div>
        ) : null}

        <div id={statusId} className="myt-small myt-muted" role="status" aria-live="polite">
          {statusText}
        </div>
        {errorBlock}

        {hasValidOption || consensus.state !== "ready" ? <p className="myt-muted">{result}</p> : null}
        <p className="myt-small myt-subtle">
          A vote is a nudge, not a booking or an RSVP. The organiser chooses and confirms the final time and place, and you say whether you are going afterwards.
        </p>
      </div>
    </Panel>
  );
}
