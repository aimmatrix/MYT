import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ActivityMark, Button, Chip, Field, Panel, SectionHeader } from "../components/ui";
import { planIdForActivity } from "../domain/identifiers";
import { MEETING_POINT_MAX_LENGTH } from "../domain/planRules";
import type {
  Activity,
  AvailabilityKey,
  CreatePlanResult,
  MytError,
  ParticipantSummary,
  Plan,
  PlanCreationDecision,
  TimeConsensus,
  TimeOption,
} from "../types";
import type { ConfirmPlanProps } from "../ui-contract";

/*
 * S8: the organiser's final step from a proposed activity to one saved, immutable plan.
 * Prop-driven only: no host, repository, room or clock-of-record. Eligibility always comes from the
 * parent's `evaluateDraft` (T5's rules); this screen never re-implements the thresholds. A tally
 * recommendation is shown as advice and never selects or confirms anything.
 */

/* ------------------------------------------------------------ London time */

// Display only. C2's formatter is not in the library yet; swap this for it when it lands.
const LONDON = "Europe/London";
const dayParts = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" });
const timeParts = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hour12: false });

function partsOf(formatter: Intl.DateTimeFormat, ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(ms)) out[part.type] = part.value;
  return out;
}

function dayLabel(ms: number): string {
  const p = partsOf(dayParts, ms);
  return `${p.weekday ?? ""} ${p.day ?? ""} ${p.month ?? ""}`.trim();
}

function timeLabel(ms: number): string {
  const p = partsOf(timeParts, ms);
  return `${p.hour ?? "--"}:${p.minute ?? "--"}`;
}

/** "Sat 14 Nov, 14:00 to 16:00" in London time, or a plain fallback when the instant cannot be read. */
function formatWhen(startAt: string, endAt: string | null): string {
  const start = Date.parse(startAt);
  if (!Number.isFinite(start)) return "Time unavailable";
  const base = `${dayLabel(start)}, ${timeLabel(start)}`;
  if (endAt === null) return base;
  const end = Date.parse(endAt);
  if (!Number.isFinite(end) || end <= start) return base;
  return dayLabel(end) === dayLabel(start) ? `${base} to ${timeLabel(end)}` : `${base} to ${dayLabel(end)}, ${timeLabel(end)}`;
}

const AVAILABILITY_LABEL: Record<AvailabilityKey, string> = {
  "weekday-evening": "Weekday evening",
  "weekend-day": "Weekend day",
  "weekend-evening": "Weekend evening",
};

function optionMeta(option: TimeOption): string {
  const label = option.availabilityKeys.map((key) => AVAILABILITY_LABEL[key]).join(", ");
  return `${label || "Time option"} · London time`;
}

/* --------------------------------------------------------------- helpers */

function initialsOf(name: string): string {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

function isOptionCode(code: string): boolean {
  return code.startsWith("option-");
}

function isMeetingPointCode(code: string): boolean {
  return code.startsWith("meeting-point-");
}

const INTEREST_CODES = new Set(["organiser-not-interested", "insufficient-real-interest", "activity-unavailable"]);

function tallyFor(consensus: TimeConsensus | null, optionId: string): number {
  return consensus?.counts.find((entry) => entry.optionId === optionId)?.count ?? 0;
}

function openPlanIdFor(activityId: string): string | null {
  try {
    return planIdForActivity(activityId);
  } catch {
    return null;
  }
}

function failureFromThrown(): MytError {
  return { code: "io", message: "The plan could not be saved." };
}

type Outcome =
  | { kind: "created"; plan: Plan }
  | { kind: "existing"; plan: Plan };

/* ------------------------------------------------------------ small views */

function Notice({ tone, title, children, actions }: { tone: "danger" | "warn" | "success" | "accent"; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="myt-banner" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <div className="myt-banner__text">
        <div className="myt-banner__title">{title}</div>
        {children !== undefined ? <div className="myt-small">{children}</div> : null}
      </div>
      {actions}
    </div>
  );
}

function StatusChip({ met }: { met: boolean }) {
  return <Chip tone={met ? "success" : "warn"}>{met ? "Done" : "Needed"}</Chip>;
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <Button variant="quiet" size="sm" className="myt-back" onClick={onBack}>
      {label}
    </Button>
  );
}

function PlanFacts({ plan, organiserLabel }: { plan: Pick<Plan, "startAt" | "endAt" | "meetingPoint">; organiserLabel?: string }) {
  return (
    <dl className="myt-facts">
      <dt>When</dt>
      <dd>{formatWhen(plan.startAt, plan.endAt)} (London time)</dd>
      <dt>Meeting point</dt>
      <dd className="myt-wrap-anywhere">{plan.meetingPoint}</dd>
      {organiserLabel !== undefined ? (
        <>
          <dt>Organiser</dt>
          <dd>{organiserLabel}</dd>
        </>
      ) : null}
    </dl>
  );
}

function InterestedList({ people, organiserUserId, currentUserId }: { people: ParticipantSummary[]; organiserUserId: string | null; currentUserId: string | null }) {
  if (people.length === 0) {
    return <p className="myt-muted myt-small">Nobody has joined yet.</p>;
  }
  return (
    <ul className="myt-people">
      {people.map((person) => {
        const isMe = currentUserId !== null && person.userId === currentUserId;
        return (
          <li key={person.userId} className={isMe ? "myt-person myt-person--me" : "myt-person"}>
            <span className="myt-avatar" aria-hidden="true">
              {initialsOf(person.displayName)}
            </span>
            <span className="myt-person__text">
              <span className="myt-person__name">{person.displayName}</span>
              {person.university !== null ? <span className="myt-person__meta">{person.university}</span> : null}
            </span>
            <span className="myt-person__trail">
              {person.userId === organiserUserId ? <Chip tone="neutral">Organiser</Chip> : null}
              {isMe ? <Chip tone="accent">You</Chip> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LoadingView() {
  return (
    <div className="myt-stack myt-stack--lg" aria-busy="true" aria-live="polite">
      <span className="myt-visually-hidden">Loading the confirmation step</span>
      <div className="myt-skeleton myt-skeleton--title" aria-hidden="true" />
      <div className="myt-skeleton myt-skeleton--block" aria-hidden="true" />
      <div className="myt-skeleton myt-skeleton--short" aria-hidden="true" />
    </div>
  );
}

function MessageView({ onBack, tone, title, children }: { onBack: () => void; tone: "danger" | "warn"; title: string; children: ReactNode }) {
  return (
    <div className="myt-stack myt-stack--lg">
      <BackButton onBack={onBack} label="← Back" />
      <Notice tone={tone} title={title}>
        {children}
      </Notice>
    </div>
  );
}

/* ----------------------------------------------------------------- screen */

export function ConfirmPlan(props: ConfirmPlanProps) {
  const {
    mode,
    currentUser,
    activity,
    existingPlan,
    interestedPeople,
    organiserUserId,
    consensus,
    initialOptionId,
    evaluateDraft,
    confirmState,
    onConfirm,
    onOpenPlan,
    onNavigate,
    onBack,
  } = props;

  const activityValue: Activity | null = activity.state === "ready" ? activity.value : null;
  const activityId = activityValue?.id ?? null;
  const suggestion = activityValue?.suggestedMeetingPoint?.trim() || "";

  const [optionId, setOptionId] = useState<string | null>(initialOptionId);
  const [meetingPoint, setMeetingPoint] = useState<string>(suggestion);
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<MytError | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [, setTick] = useState(0);
  const radioName = useId();

  // A fresh draft per activity. Edits survive refreshes of the same activity and any failed save.
  useEffect(() => {
    if (activityId === null) return;
    setOptionId(initialOptionId);
    setMeetingPoint(suggestion);
    setTouched(false);
    setAttempted(false);
    setFailure(null);
    setOutcome(null);
    // Only the activity changing resets the draft; a later prefill or tally must not overwrite edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  // Time options expire while the screen is open, so re-run the parent's rules every half minute.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  /* ------------------------------------------------ states without a form */

  if (outcome !== null) {
    const { plan } = outcome;
    return (
      <div className="myt-stack myt-stack--lg">
        {outcome.kind === "created" ? (
          <Panel
            tone="success"
            title="Plan saved"
            description="Saved on this device. Others see it once the shared files sync."
            actions={
              <Button variant="primary" onClick={() => onOpenPlan(plan.id)}>
                Open plan and mark I'm going
              </Button>
            }
          >
            <PlanFacts plan={plan} organiserLabel={currentUser?.name ?? "You"} />
            <p className="myt-muted myt-small">
              Nobody is marked as going yet, not even you. Each person says so themselves from the plan page. The time and meeting point are now fixed in this version.
            </p>
          </Panel>
        ) : (
          <Panel
            tone="warn"
            title="A plan was already confirmed"
            description="Another confirmation was saved first, so nothing new was created and the saved plan was not changed."
            actions={
              <Button variant="primary" onClick={() => onOpenPlan(plan.id)}>
                Open the saved plan
              </Button>
            }
          >
            <PlanFacts plan={plan} />
          </Panel>
        )}
        <div className="myt-actions">
          <Button variant="quiet" onClick={onBack}>
            Back to the activity
          </Button>
        </div>
      </div>
    );
  }

  if (activity.state === "loading" || existingPlan.state === "loading") return <LoadingView />;

  if (activity.state === "error") {
    return (
      <MessageView onBack={onBack} tone="danger" title="This activity could not be loaded">
        {activity.error.message}
      </MessageView>
    );
  }
  if (existingPlan.state === "error") {
    return (
      <MessageView onBack={onBack} tone="danger" title="Saved plans could not be checked">
        {existingPlan.error.message} Confirming is paused so a second plan is never created by mistake.
      </MessageView>
    );
  }
  if (activity.value === null) {
    return (
      <MessageView onBack={onBack} tone="warn" title="Activity not found">
        This activity is no longer in the catalogue, so there is nothing to confirm.
      </MessageView>
    );
  }

  const act = activity.value;

  // An existing plan wins: route to it rather than overwrite or duplicate. It comes from the plan map,
  // not from T5's result, because T5 reports `not-organiser` before `plan-exists` for other people.
  if (existingPlan.value !== null) {
    const plan = existingPlan.value;
    return (
      <div className="myt-stack myt-stack--lg">
        <BackButton onBack={onBack} label="← Back to the activity" />
        <Panel
          tone="success"
          title={`${act.title} already has a plan`}
          description="Its time and meeting point are fixed in this version. Open it to see who is going."
          actions={
            <Button variant="primary" onClick={() => onOpenPlan(plan.id)}>
              Open the plan
            </Button>
          }
        >
          <PlanFacts plan={plan} />
        </Panel>
      </div>
    );
  }

  /* ----------------------------------------------------- shared derivations */

  const people = interestedPeople.state === "ready" ? interestedPeople.value : [];
  const peopleReady = interestedPeople.state === "ready";
  const consensusValue = consensus.state === "ready" ? consensus.value : null;
  const currentUserId = currentUser?.id ?? null;
  const isOrganiser = currentUserId !== null && organiserUserId !== null && currentUserId === organiserUserId;
  const organiserPerson = people.find((person) => person.userId === organiserUserId) ?? null;

  const header = (
    <>
      <BackButton onBack={onBack} label="← Back to the activity" />
      <div className="myt-detail__hero">
        <ActivityMark interestId={act.interestId} title={act.title} size="lg" />
        <SectionHeader
          level={1}
          eyebrow="Confirm plan"
          title={act.title}
          description="Turn the group's interest into one saved plan with a time and a public meeting point."
        />
      </div>
    </>
  );

  const interestedPanel = (
    <Panel
      title="Who's interested"
      description="Real people who have joined. Fictional example students and people just viewing are not counted."
      as="aside"
    >
      {interestedPeople.state === "loading" ? <p className="myt-muted myt-small">Loading who has joined…</p> : null}
      {interestedPeople.state === "error" ? (
        <p className="myt-field__error" role="alert">
          {interestedPeople.error.message}
        </p>
      ) : null}
      {peopleReady ? <InterestedList people={people} organiserUserId={organiserUserId} currentUserId={currentUserId} /> : null}
    </Panel>
  );

  /* ----------------------------------------- explanatory states, no controls */

  let blockedTitle: string | null = null;
  let blockedBody: ReactNode = null;
  let blockedActions: ReactNode = null;
  let blockedTone: "warn" | "accent" = "warn";

  if (mode === "preview") {
    blockedTone = "accent";
    blockedTitle = "Preview mode: nothing can be confirmed";
    blockedBody = "Preview shows how the flow looks. Confirming a plan needs a real, signed-in session with a saved organiser.";
  } else if (currentUser === null) {
    blockedTitle = "Sign in to confirm a plan";
    blockedBody = "Only the organiser can confirm, and that needs a signed-in account.";
  } else if (organiserUserId === null) {
    blockedTitle = "No organiser is set yet";
    blockedBody = "Someone has to be chosen as the organiser before a plan can be confirmed.";
    blockedActions = (
      <Button size="sm" onClick={() => onNavigate({ name: "setup" })}>
        Go to setup
      </Button>
    );
  } else if (!isOrganiser) {
    blockedTitle = "Only the organiser confirms the plan";
    blockedBody = (
      <>
        {organiserPerson !== null ? `${organiserPerson.displayName} is the organiser for this group. ` : "Another person is the organiser for this group. "}
        You can keep your interest and time vote up to date on the activity page, and the plan will appear here and in My plans once they confirm it. This is a convention for the prototype, not a lock on the shared files.
      </>
    );
  } else if (onConfirm === undefined) {
    blockedTitle = "Confirming is not available right now";
    blockedBody = "The app cannot save plans in this state. Reload and try again, or check that you are signed in.";
  }

  if (blockedTitle !== null) {
    return (
      <div className="myt-stack myt-stack--lg">
        {header}
        <Notice tone={blockedTone} title={blockedTitle} actions={blockedActions}>
          {blockedBody}
        </Notice>
        <div className="myt-detail">
          <div className="myt-detail__main">
            <Panel title="What gets confirmed" variant="quiet">
              <ul className="myt-hero__points">
                <li>The organiser picks one future time. A vote count is only a suggestion.</li>
                <li>The organiser adds a public meeting point, such as a station entrance, not a home address.</li>
                <li>At least two real people, including the organiser, must be interested.</li>
                <li>Confirming does not mark anyone as going. Everyone says that for themselves.</li>
              </ul>
            </Panel>
          </div>
          <div className="myt-detail__aside">{interestedPanel}</div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------ organiser's form */

  const decision: PlanCreationDecision = evaluateDraft(optionId, meetingPoint);
  const denied = decision.allowed ? null : decision;
  const deniedCode = denied?.code ?? null;

  const optionNotes = new Map<string, string>();
  for (const option of act.timeOptions) {
    const result = evaluateDraft(option.id, meetingPoint);
    if (!result.allowed && isOptionCode(result.code) && result.code !== "option-not-selected") {
      optionNotes.set(option.id, result.message);
      continue;
    }
    // T5 checks interest before time, so an earlier failure hides an expired option. Show it anyway;
    // this is display only and the parent's rules still decide whether a plan can be saved.
    const startMs = Date.parse(option.startAt);
    if (Number.isFinite(startMs) && startMs <= Date.now()) {
      optionNotes.set(option.id, "This time has already started or passed.");
    }
  }

  const selectedOption = act.timeOptions.find((option) => option.id === optionId) ?? null;
  const showOptionError = denied !== null && deniedCode !== null && isOptionCode(deniedCode) && (optionId !== null || attempted);
  const showPointError = denied !== null && deniedCode !== null && isMeetingPointCode(deniedCode) && (touched || attempted);
  const trimmedPoint = meetingPoint.trim();
  const pointLength = Array.from(trimmedPoint).length;
  const pointIsSuggestion = suggestion !== "" && meetingPoint === suggestion;

  const busy = submitting || confirmState.status === "pending";

  const interestMet = deniedCode === null || !INTEREST_CODES.has(deniedCode);
  const timeMet = optionId !== null && selectedOption !== null && !optionNotes.has(optionId) && !(deniedCode !== null && isOptionCode(deniedCode));
  const pointMet = trimmedPoint !== "" && !(deniedCode !== null && isMeetingPointCode(deniedCode));

  async function handleConfirm() {
    if (submittingRef.current || onConfirm === undefined) return;
    setAttempted(true);
    const latest = evaluateDraft(optionId, meetingPoint);
    if (!latest.allowed) {
      setFailure({ code: "not-allowed", message: latest.message });
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    let result: CreatePlanResult;
    try {
      result = await onConfirm({ activityId: act.id, optionId: latest.chosenOptionId, meetingPoint: latest.meetingPoint });
    } catch {
      result = { ok: false, error: failureFromThrown() };
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    if (!result.ok) {
      // Nothing is reported as saved. The draft stays exactly as typed so the organiser can reconsider.
      setFailure(result.error);
      return;
    }
    setOutcome({ kind: result.kind, plan: result.plan });
    if (result.kind === "existing") onOpenPlan(result.plan.id);
  }

  const savedPlanId = openPlanIdFor(act.id);
  const showFailure = failure ?? (confirmState.status === "error" ? confirmState.error : null);
  const conflictExists = showFailure?.code === "already-exists";

  return (
    <div className="myt-stack myt-stack--lg">
      {header}

      {showFailure !== null ? (
        <Notice
          tone="danger"
          title={conflictExists ? "A different plan was saved first" : showFailure.code === "io" ? "The plan could not be saved" : "The plan was not saved"}
          actions={
            conflictExists && savedPlanId !== null ? (
              <Button size="sm" onClick={() => onOpenPlan(savedPlanId)}>
                Open the saved plan
              </Button>
            ) : undefined
          }
        >
          {showFailure.message}{" "}
          {conflictExists
            ? "The saved plan's time and meeting point cannot be overwritten."
            : "Nothing was saved. Your choices are still below, so you can change them and confirm again."}
        </Notice>
      ) : null}

      <div className="myt-detail">
        <div className="myt-detail__main">
          <Panel
            title="1. Choose the time"
            description="You decide. Votes below are advice from the group and never confirm anything on their own."
          >
            {act.timeOptions.length === 0 ? (
              <p className="myt-muted">This activity has no time options to choose from.</p>
            ) : (
              <fieldset className="myt-fieldset">
                <legend className="myt-visually-hidden">Time choices</legend>
                <div className="myt-options" role="radiogroup" aria-label="Time choices">
                  {act.timeOptions.map((option) => {
                    const note = optionNotes.get(option.id) ?? null;
                    const votes = tallyFor(consensusValue, option.id);
                    const isTop = consensusValue !== null && consensusValue.suggestedOptionId === option.id;
                    const isTied = consensusValue !== null && consensusValue.tiedOptionIds.length > 1 && consensusValue.tiedOptionIds.includes(option.id);
                    return (
                      <label key={option.id} className="myt-option">
                        <input
                          className="myt-option__input"
                          type="radio"
                          name={radioName}
                          checked={optionId === option.id}
                          disabled={note !== null || busy}
                          onChange={() => {
                            setOptionId(option.id);
                            setFailure(null);
                          }}
                        />
                        <span className="myt-option__body">
                          <span className="myt-option__title">{formatWhen(option.startAt, option.endAt)}</span>
                          <span className="myt-option__meta">{note !== null ? `${optionMeta(option)} · ${note}` : optionMeta(option)}</span>
                        </span>
                        <span className="myt-option__tally">
                          {isTop ? <Chip tone="accent">Most votes</Chip> : null}
                          {isTied ? <Chip tone="neutral">Tied</Chip> : null}{" "}
                          {consensus.state === "ready" ? `${votes} ${votes === 1 ? "vote" : "votes"}` : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {consensus.state === "loading" ? <p className="myt-subtle myt-small">Loading votes…</p> : null}
            {consensus.state === "error" ? <p className="myt-subtle myt-small">Votes could not be loaded. You can still choose a time.</p> : null}
            {showOptionError && denied !== null ? (
              <p className="myt-field__error" role="alert">
                {denied.message}
              </p>
            ) : null}
          </Panel>

          <Panel title="2. Set a public meeting point">
            <Field
              label="Meeting point"
              required
              control="textarea"
              rows={3}
              value={meetingPoint}
              disabled={busy}
              placeholder="For example: main entrance of the station, by the ticket barriers"
              hint={
                <>
                  Use a public place people can find, like a station entrance or venue foyer. Don't enter a home address.{" "}
                  {pointIsSuggestion ? "This is a proposal from the activity listing; edit it if your group meets elsewhere. " : null}
                  <span className="myt-nowrap">
                    {pointLength}/{MEETING_POINT_MAX_LENGTH}
                  </span>
                </>
              }
              error={showPointError && denied !== null ? denied.message : undefined}
              onChange={(value) => {
                setMeetingPoint(value);
                setTouched(true);
                setFailure(null);
              }}
            />
          </Panel>

          <Panel title="3. Review and confirm" variant="quiet">
            {decision.allowed ? (
              <PlanFacts plan={{ startAt: decision.startAt, endAt: decision.endAt, meetingPoint: decision.meetingPoint }} organiserLabel={`${currentUser?.name ?? "You"} (you)`} />
            ) : (
              <p className="myt-muted" role="status">
                {denied?.message}
              </p>
            )}
            <p className="myt-small myt-muted">
              Once saved, the time and meeting point cannot be changed in this version, and nobody is marked as going automatically.
            </p>
            <div className="myt-actions">
              <Button variant="primary" pending={busy} disabled={!decision.allowed || !peopleReady || conflictExists} onClick={() => void handleConfirm()}>
                {decision.allowed ? `Confirm ${formatWhen(decision.startAt, decision.endAt)}` : "Confirm plan"}
              </Button>
              {busy ? (
                <span className="myt-muted myt-small" role="status">
                  Saving the plan…
                </span>
              ) : null}
              {denied !== null && deniedCode === "plan-exists" && denied.existingPlanId !== undefined ? (
                <Button onClick={() => onOpenPlan(denied.existingPlanId as string)}>Open the existing plan</Button>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="myt-detail__aside">
          <Panel title="Before you confirm" as="aside" variant="quiet">
            <ul className="myt-hero__points">
              <li>
                <span>
                  <StatusChip met={interestMet} />{" "}
                  At least two real people interested, including you{peopleReady ? ` (${people.length} so far)` : ""}
                  {!interestMet && denied !== null ? <span className="myt-field__error"> {denied.message}</span> : null}
                </span>
              </li>
              <li>
                <span>
                  <StatusChip met={timeMet} /> {timeMet ? "A future time is chosen" : "Choose a future time"}
                </span>
              </li>
              <li>
                <span>
                  <StatusChip met={pointMet} /> {pointMet ? "A public meeting point is set" : "Add a public meeting point"}
                </span>
              </li>
            </ul>
            {!interestMet && deniedCode === "organiser-not-interested" ? (
              <div className="myt-actions">
                <Button size="sm" onClick={onBack}>
                  Back to join this activity
                </Button>
              </div>
            ) : null}
          </Panel>
          {interestedPanel}
        </div>
      </div>
    </div>
  );
}
