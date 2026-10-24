import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InterestPanelProps } from "../ui-contract";
import type { MytError, ParticipantSummary } from "../types";
import { Button, Chip, Panel, cx } from "./ui";

/*
 * MYT interest panel (S6). Prop-driven: no host, repository, room or storage access.
 *
 * "I'd go with someone" records interest only. It never marks anyone as going and never votes for a
 * time. Withdrawing writes `withdrawn` to the current person's own record through `onSetInterest`.
 *
 * Only the people in `interestedPeople` are listed. Sample profiles belong to S10's CompanionList and
 * are filtered out here again as a guard, so a sample ID can never be shown or counted as interested.
 *
 * There is no optimistic write. The persisted `interest` prop is the source of truth. After a write
 * succeeds, the confirmed target is held for a few seconds (`bridge`) only to cover the gap before the
 * data subscription delivers the new record. A failed write never changes what is shown as persisted.
 */

type Target = "interested" | "withdrawn";

const BRIDGE_MS = 5000;
const SAVED_NOTE_MS = 6000;

interface Bridge {
  scope: string;
  target: Target;
}

interface Failure {
  scope: string;
  target: Target;
  error: MytError;
}

interface SavedNote {
  scope: string;
  target: Target;
}

interface PersonRow {
  userId: string;
  name: string;
  hasName: boolean;
  university: string | null;
  isMe: boolean;
  /** 1-based position among people sharing this display name, or null when the name is unique. */
  ordinal: number | null;
  ordinalOf: number;
}

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function nameKey(name: string): string {
  return name.toLocaleLowerCase();
}

/** Samples are never attendees. Preview fixtures are allowed only while the app is in preview mode. */
function isListable(userId: string, mode: "live" | "preview"): boolean {
  if (userId.trim() === "") return false;
  if (userId.startsWith("sample:")) return false;
  if (mode === "live" && userId.startsWith("preview:")) return false;
  return true;
}

/**
 * Deduplicates by user ID (never by display name), keeps the first record seen for an ID, and
 * orders people stably: you first, then by name, then by ID. People who share a display name get an
 * ordinal so they stay visibly separate.
 */
function buildRows(people: ParticipantSummary[], currentUserId: string | null, mode: "live" | "preview"): PersonRow[] {
  const seen = new Set<string>();
  const unique: ParticipantSummary[] = [];
  for (const person of people) {
    if (typeof person.userId !== "string" || !isListable(person.userId, mode)) continue;
    if (seen.has(person.userId)) continue;
    seen.add(person.userId);
    unique.push(person);
  }

  const drafts = unique.map((person) => {
    const name = normalise(person.displayName);
    return {
      userId: person.userId,
      name,
      hasName: name !== "",
      university: normalise(person.university) || null,
      isMe: currentUserId !== null && person.userId === currentUserId,
    };
  });

  drafts.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    const byName = nameKey(a.name).localeCompare(nameKey(b.name));
    if (byName !== 0) return byName;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });

  const totals = new Map<string, number>();
  for (const draft of drafts) {
    if (!draft.hasName) continue;
    const key = nameKey(draft.name);
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const running = new Map<string, number>();
  return drafts.map((draft) => {
    const key = nameKey(draft.name);
    const total = draft.hasName ? (totals.get(key) ?? 1) : 1;
    if (!draft.hasName || total < 2) return { ...draft, ordinal: null, ordinalOf: 1 };
    const next = (running.get(key) ?? 0) + 1;
    running.set(key, next);
    return { ...draft, ordinal: next, ordinalOf: total };
  });
}

function initialOf(row: PersonRow): string {
  return Array.from(row.name)[0]?.toUpperCase() ?? "?";
}

function errorMessage(error: MytError): string {
  switch (error.code) {
    case "not-signed-in":
      return "You need to be signed in to change your interest.";
    case "not-allowed":
      return "That change isn't allowed right now.";
    case "preview":
      return "Preview mode doesn't save anything.";
    case "id-invalid":
      return "Your account ID couldn't be used for a file name, so nothing was saved.";
    default:
      return error.message.trim() || "Your interest couldn't be saved.";
  }
}

function PersonItem({ row }: { row: PersonRow }) {
  const displayName = row.hasName ? row.name : "Name not shared";
  const meta = row.university ?? (row.hasName ? "University not shared" : "Profile not filled in yet");
  return (
    <li className={cx("myt-person", row.isMe && "myt-person--me")}>
      <span className="myt-avatar" aria-hidden="true">
        {initialOf(row)}
      </span>
      <span className="myt-person__text">
        <span className="myt-person__name myt-wrap-anywhere">
          {displayName}
          {row.ordinal !== null ? (
            <>
              <span className="myt-subtle" aria-hidden="true">
                {" "}
                #{row.ordinal}
              </span>
              <span className="myt-visually-hidden">
                {" "}
                (person {row.ordinal} of {row.ordinalOf} with this name)
              </span>
            </>
          ) : null}
        </span>
        <span className="myt-person__meta myt-wrap-anywhere">{meta}</span>
      </span>
      {row.isMe ? (
        <span className="myt-person__trail">
          <Chip tone="accent">You</Chip>
        </span>
      ) : null}
    </li>
  );
}

function PeopleSkeleton() {
  return (
    <ul className="myt-people" aria-hidden="true">
      {[0, 1].map((index) => (
        <li key={index} className="myt-person">
          <span className="myt-skeleton myt-skeleton--mark" />
          <span className="myt-person__text">
            <span className="myt-skeleton myt-skeleton--title" />
            <span className="myt-skeleton myt-skeleton--short" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function InterestPanel({
  mode,
  currentUser,
  activityId,
  activityAvailable,
  planExists,
  interest,
  interestedPeople,
  actionState,
  onSetInterest,
  onExitPreview,
}: InterestPanelProps) {
  const currentUserId = currentUser?.id ?? null;
  const scope = `${activityId}\u0000${currentUserId ?? ""}`;

  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [savedNote, setSavedNote] = useState<SavedNote | null>(null);
  const [busyScope, setBusyScope] = useState<string | null>(null);

  const inFlight = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A different activity or person starts from a clean slate. A write still in flight for the old
  // scope finishes on its own and is ignored here through the generation check.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setBusyScope(null);
  }, [scope]);

  const persisted = interest.state === "ready" ? interest.value : undefined;

  // The bridge ends as soon as the persisted record matches, or after a short time.
  useEffect(() => {
    if (bridge === null) return;
    if (bridge.scope !== scope || persisted === bridge.target) {
      setBridge(null);
      return;
    }
    const timer = setTimeout(() => setBridge(null), BRIDGE_MS);
    return () => clearTimeout(timer);
  }, [bridge, persisted, scope]);

  useEffect(() => {
    if (savedNote === null) return;
    if (savedNote.scope !== scope) {
      setSavedNote(null);
      return;
    }
    const timer = setTimeout(() => setSavedNote(null), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [savedNote, scope]);

  // The stored record changed underneath a failed attempt (for example from another tab): the old
  // failure no longer describes what is on disk.
  useEffect(() => {
    setFailure((current) => (current !== null && current.scope === scope ? null : current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persisted]);

  const activeBridge = bridge !== null && bridge.scope === scope ? bridge : null;
  const shown: Target | null | undefined = activeBridge?.target ?? persisted;
  const activeFailure = failure !== null && failure.scope === scope ? failure : null;
  const activeSaved = savedNote !== null && savedNote.scope === scope ? savedNote : null;

  const busy = busyScope === scope || actionState.status === "pending";
  const canWrite = mode === "live" && currentUser !== null && onSetInterest !== undefined;
  const interestKnown = interest.state === "ready";

  const people = useMemo(
    () => (interestedPeople.state === "ready" ? buildRows(interestedPeople.value, currentUserId, mode) : []),
    [interestedPeople, currentUserId, mode],
  );

  const run = useCallback(
    async (target: Target) => {
      if (onSetInterest === undefined || inFlight.current) return;
      inFlight.current = true;
      const myGeneration = generation.current;
      const myScope = scope;
      setBusyScope(myScope);
      setFailure(null);
      setSavedNote(null);

      let outcome: { ok: true } | { ok: false; error: MytError };
      try {
        const result = await onSetInterest(target);
        outcome = result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (thrown) {
        outcome = {
          ok: false,
          error: {
            code: "io",
            message: thrown instanceof Error && thrown.message.trim() ? thrown.message : "Your interest couldn't be saved.",
          },
        };
      }

      if (!mounted.current || myGeneration !== generation.current) return;
      inFlight.current = false;
      setBusyScope(null);
      if (outcome.ok) {
        setBridge({ scope: myScope, target });
        setSavedNote({ scope: myScope, target });
      } else {
        setFailure({ scope: myScope, target, error: outcome.error });
      }
    },
    [onSetInterest, scope],
  );

  // ---- What the single action button does ----------------------------------------------------
  const locked = planExists;
  const isInterested = shown === "interested";
  const joinTarget: Target = isInterested ? "withdrawn" : "interested";
  // Withdrawing stays possible for an unavailable activity: it is not a new interest. A confirmed
  // plan freezes both directions.
  const blockedByState = locked || (!isInterested && !activityAvailable) || !interestKnown;
  const actionDisabled = !canWrite || blockedByState;

  const onAction = () => {
    if (actionDisabled || busy) return;
    void run(joinTarget);
  };

  const onRetry = () => {
    if (busy) return;
    if (activeFailure !== null) {
      void run(activeFailure.target);
    } else if (actionState.status === "error") {
      actionState.retry();
    }
  };

  const shownError: MytError | null =
    activeFailure?.error ?? (actionState.status === "error" ? actionState.error : null);
  const retryTarget: Target | null = activeFailure?.target ?? null;

  // ---- Copy ------------------------------------------------------------------------------------
  let headline: string;
  let detail: string | null = null;

  if (interest.state === "loading") {
    headline = "Checking your interest…";
  } else if (interest.state === "error") {
    headline = "We couldn't load your interest.";
    detail = "Joining and withdrawing are paused until it loads, so nothing gets overwritten by mistake.";
  } else if (shown === "interested") {
    headline = "You're interested";
    detail = "This only tells people you'd go. It doesn't mark you as going or pick a time for you.";
  } else if (shown === "withdrawn") {
    headline = "You withdrew your interest";
    detail = "You can say you'd go again any time before a plan is confirmed.";
  } else {
    headline = "Would you go to this?";
    detail = "Say you'd go with someone. It isn't a commitment: you aren't marked as going and you don't pick a time.";
  }

  let gate: string | null = null;
  if (planExists) {
    gate = "A plan is already confirmed, so interest is locked. Use the plan to say whether you're going.";
  } else if (!activityAvailable && !isInterested) {
    gate = "This activity isn't available right now, so you can't add interest.";
  } else if (!activityAvailable && isInterested) {
    gate = "This activity isn't available right now. You can still withdraw.";
  }

  let access: string | null = null;
  if (!canWrite) {
    if (mode === "preview") access = "Preview only: nothing you do here is saved, and preview people aren't real participants.";
    else if (currentUser === null) access = "Sign in to say you'd go. Your interest is saved under your own account.";
    else access = "Saving isn't available right now.";
  }
  const exitLabel = mode === "preview" ? "Leave preview to join" : "Sign in to join";

  const savedText =
    activeSaved === null
      ? null
      : activeSaved.target === "interested"
        ? "Saved on this device. Others will see you once it syncs."
        : "Withdrawal saved on this device. Others will see it once it syncs.";

  const actionLabel = isInterested ? "Withdraw interest" : "I'd go with someone";
  const showWithdrawNote = canWrite && (isInterested || shown === "withdrawn");

  return (
    <Panel
      title="Who's interested"
      actions={
        interestedPeople.state === "ready" ? (
          <span className="myt-count">
            {people.length} {people.length === 1 ? "person" : "people"} interested
          </span>
        ) : undefined
      }
    >
      <div className="myt-stack">
        <div className="myt-stack myt-stack--xs">
          <p className="myt-strong" aria-live="polite">
            {headline}
          </p>
          {detail !== null ? <p className="myt-small myt-muted">{detail}</p> : null}
          {gate !== null ? <p className="myt-small myt-muted">{gate}</p> : null}
          {access !== null ? <p className="myt-small myt-muted">{access}</p> : null}
        </div>

        {canWrite ? (
          <div className="myt-actions">
            <Button
              variant={isInterested ? "danger" : "primary"}
              pending={busy}
              disabled={actionDisabled && !busy}
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          </div>
        ) : onExitPreview !== undefined && (mode === "preview" || currentUser === null) ? (
          <div className="myt-actions">
            <Button variant="primary" onClick={onExitPreview}>
              {exitLabel}
            </Button>
          </div>
        ) : null}

        <p className="myt-visually-hidden" role="status" aria-live="polite">
          {busy ? "Saving your interest…" : (savedText ?? "")}
        </p>
        {busy ? (
          <p className="myt-small myt-muted" aria-hidden="true">
            Saving…
          </p>
        ) : savedText !== null ? (
          <p className="myt-small myt-muted" aria-hidden="true">
            {savedText}
          </p>
        ) : null}

        {shownError !== null ? (
          <div className="myt-banner" data-tone="danger" role="alert">
            <div className="myt-banner__text">
              <p className="myt-banner__title">
                {retryTarget === "withdrawn"
                  ? "Your withdrawal wasn't saved"
                  : retryTarget === "interested"
                    ? "Your interest wasn't saved"
                    : "That change wasn't saved"}
              </p>
              <p className="myt-wrap-anywhere">
                {errorMessage(shownError)}{" "}
                {shown === "interested"
                  ? "You're still shown as interested."
                  : shown === "withdrawn"
                    ? "You're still shown as withdrawn."
                    : "Nothing changed."}
              </p>
            </div>
            {canWrite && (retryTarget !== null || actionState.status === "error") ? (
              <Button size="sm" pending={busy} onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}

        {showWithdrawNote ? (
          <p className="myt-small myt-muted">
            Withdrawing only changes your own interest and never touches anyone else's. If you chose a time, your choice is
            kept but stops counting while you aren't interested, and counts again if you rejoin.
          </p>
        ) : null}

        {interestedPeople.state === "loading" ? (
          <PeopleSkeleton />
        ) : interestedPeople.state === "error" ? (
          <p className="myt-small myt-muted" role="status">
            We couldn't load who's interested. {errorMessage(interestedPeople.error)}
          </p>
        ) : people.length === 0 ? (
          <p className="myt-small myt-muted">
            {canWrite && !isInterested && !planExists && activityAvailable
              ? "No one has said they'd go yet. You could be the first."
              : "No one has said they'd go yet."}
          </p>
        ) : (
          <ul className="myt-people" aria-label="People who are interested">
            {people.map((row) => (
              <PersonItem key={row.userId} row={row} />
            ))}
          </ul>
        )}

        {interestedPeople.state === "ready" && interestedPeople.issues.length > 0 ? (
          <p className="myt-small myt-muted">
            {interestedPeople.issues.length === 1 ? "One record" : `${interestedPeople.issues.length} records`} couldn't be
            read, so this list may be incomplete.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
