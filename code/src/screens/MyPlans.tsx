import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ActivityMark, Button, ButtonLink, Chip, SectionHeader, SegmentedTabs, type Tone } from "../components/ui";
import { buildPlanSummary } from "../domain/planSummary";
import { evaluateAttendance } from "../domain/planRules";
import type { ActionResult, ActionState, Activity, Attendance, Loadable, MytError, ParticipantSummary } from "../types";
import type { MyPlansProps, PlanCard } from "../ui-contract";

/*
 * MyPlans (S9). Prop-driven: no host connection, repository, storage or presence. Everything shown
 * is persisted data supplied by the parent (G3 through S1). Interest and attendance are kept apart:
 * an activity you are only interested in never appears as a plan you are going to, and nothing here
 * reads live viewer counts.
 *
 * Each plan row is built from G10's pure `buildPlanSummary` (London time, meeting point, source,
 * real going people), so it shows the same facts as the plan page. The `PlanSummary` component is a
 * whole page (h1, back link, its own attendance buttons), so rows link to it through `onOpenPlan`
 * instead of nesting it.
 *
 * `MyPlansProps` (G1, frozen) has no going list, organiser, attendance callback or interested
 * activities, so those arrive as optional extras. A plain `MyPlansProps` object is still accepted.
 */

type AttendanceStatus = Attendance["status"];

export interface MyPlansExtras {
  /** Real people marked going, keyed by raw plan ID. Absent key: only `PlanCard.goingCount` is shown. Never include samples or viewers. */
  goingPeopleByPlanId?: Record<string, Loadable<ParticipantSummary[]>>;
  /** Organiser summaries keyed by raw plan ID. Missing or null hides the organiser line. */
  organisersByPlanId?: Record<string, ParticipantSummary | null>;
  /** Optional parent-owned state for the attendance write, keyed by raw plan ID (for example from G9). */
  attendanceStateByPlanId?: Record<string, ActionState>;
  /** Writes the current person's own attendance. Absent in preview and signed-out mode. Must not delete the plan. */
  onSetAttendance?: (planId: string, status: AttendanceStatus) => Promise<ActionResult<unknown>>;
  /** Activities the current person is interested in, chosen by the parent's selector. Activities that already have a plan are left out here. */
  interestedActivities?: Loadable<Activity[]>;
}

export type MyPlansViewProps = MyPlansProps & MyPlansExtras;

/* Without an end time a plan counts as over this long after it starts. */
const FALLBACK_DURATION_MS = 3 * 60 * 60 * 1000;

type Phase = "upcoming" | "underway" | "ended" | "unknown";

function phaseOf(card: PlanCard, nowMs: number): Phase {
  const start = Date.parse(card.plan.startAt);
  if (!Number.isFinite(start)) return "unknown";
  const parsedEnd = card.plan.endAt === null ? Number.NaN : Date.parse(card.plan.endAt);
  const end = Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + FALLBACK_DURATION_MS;
  if (nowMs < start) return "upcoming";
  if (nowMs < end) return "underway";
  return "ended";
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

function londonDateParts(iso: string): { day: string; date: string; month: string } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = dateFormat.formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { day: pick("weekday"), date: pick("day"), month: pick("month") };
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function own<T>(record: Record<string, T> | undefined, key: string): T | undefined {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

type LocalAttendance =
  | { status: "pending"; target: AttendanceStatus }
  | { status: "saved"; target: AttendanceStatus }
  | { status: "error"; target: AttendanceStatus; error: MytError };

/* ---------------------------------------------------------------- screen */

export function MyPlans(props: MyPlansViewProps) {
  const { mode, currentUser, onNavigate, plans, onOpenPlan, onDiscover, interestedActivities, onSetAttendance } = props;
  const [tab, setTab] = useState("upcoming");
  const now = useNow(60_000);

  const [local, setLocal] = useState<ReadonlyMap<string, LocalAttendance>>(() => new Map());
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const userId = currentUser?.id ?? null;
  useEffect(() => {
    setLocal(new Map());
  }, [userId]);

  const setLocalFor = useCallback((planId: string, next: LocalAttendance | null) => {
    setLocal((prev) => {
      const copy = new Map(prev);
      if (next === null) copy.delete(planId);
      else copy.set(planId, next);
      return copy;
    });
  }, []);

  const answer = useCallback(
    async (planId: string, target: AttendanceStatus) => {
      if (!onSetAttendance || inFlight.current.has(planId)) return;
      inFlight.current.add(planId);
      setLocalFor(planId, { status: "pending", target });
      let result: ActionResult<unknown>;
      try {
        result = await onSetAttendance(planId, target);
      } catch (cause) {
        result = { ok: false, error: { code: "io", message: cause instanceof Error ? cause.message : "Something went wrong." } };
      }
      inFlight.current.delete(planId);
      if (!mounted.current) return;
      setLocalFor(planId, result.ok ? { status: "saved", target } : { status: "error", target, error: result.error });
    },
    [onSetAttendance, setLocalFor],
  );

  const cards: PlanCard[] = plans.state === "ready" ? plans.value : [];
  const entries = useMemo(
    () => cards.map((card) => ({ card, phase: phaseOf(card, now), startMs: Date.parse(card.plan.startAt) })),
    [cards, now],
  );
  const current = entries
    .filter((entry) => entry.phase !== "ended")
    .sort((a, b) => (Number.isFinite(a.startMs) ? a.startMs : Infinity) - (Number.isFinite(b.startMs) ? b.startMs : Infinity));
  const earlier = entries.filter((entry) => entry.phase === "ended").sort((a, b) => b.startMs - a.startMs);

  const plannedActivityIds = new Set(cards.map((card) => card.plan.activityId));
  const interested =
    interestedActivities?.state === "ready" ? interestedActivities.value.filter((activity) => !plannedActivityIds.has(activity.id)) : [];

  const canAnswer = mode === "live" && currentUser !== null && onSetAttendance !== undefined;
  const cannotAnswerReason =
    mode === "preview"
      ? "You're looking at a preview, so answers can't be saved."
      : currentUser === null
        ? "Sign in to say whether you're going."
        : "Answers can't be saved right now.";

  const renderEntry = (entry: (typeof entries)[number]) => (
    <PlanEntry
      key={entry.card.plan.id}
      card={entry.card}
      phase={entry.phase}
      nowMs={now}
      currentUserId={userId}
      onOpenPlan={onOpenPlan}
      goingPeople={own(props.goingPeopleByPlanId, entry.card.plan.id)}
      organiser={own(props.organisersByPlanId, entry.card.plan.id) ?? null}
      parentState={own(props.attendanceStateByPlanId, entry.card.plan.id)}
      localState={local.get(entry.card.plan.id)}
      canAnswer={canAnswer}
      onAnswer={(status) => void answer(entry.card.plan.id, status)}
    />
  );

  const noInterestKnown = interestedActivities === undefined || (interestedActivities.state === "ready" && interested.length === 0);
  const showEmpty = plans.state === "ready" && cards.length === 0 && noInterestKnown;

  return (
    <div className="myt-stack myt-stack--lg">
      <SectionHeader
        level={1}
        title="My plans"
        description="Plans your group has confirmed, and activities you've only shown interest in. They're kept in the shared MYT files, so they're here when you reopen the app."
        actions={<Button onClick={onDiscover}>Find activities</Button>}
      />

      <SegmentedTabs value={tab} options={[{id:"upcoming",label:"Upcoming"},{id:"past",label:"Past"}]} onChange={setTab}/>
      {tab === "past" && earlier.length === 0 ? <div className="myt-empty"><h2>Good times go here</h2><p>Plans you have been to will appear here.</p></div> : null}
      {plans.state === "error" ? (
        <div className="myt-banner" data-tone="danger" role="alert">
          <div className="myt-banner__text">
            <p className="myt-banner__title">We couldn't load your plans</p>
            <p className="myt-small myt-wrap-anywhere">{plans.error.message} Nothing has been changed.</p>
          </div>
        </div>
      ) : null}

      {plans.state === "ready" && plans.issues.length > 0 ? (
        <div className="myt-banner" data-tone="warn" role="status">
          <div className="myt-banner__text">
            <p className="myt-banner__title">Some saved records couldn't be read</p>
            <p className="myt-small">
              {plans.issues.length === 1 ? "One record is" : `${plans.issues.length} records are`} left out, so a plan may be missing from this list.
            </p>
          </div>
        </div>
      ) : null}

      {plans.state === "loading" ? <PlansSkeleton /> : null}

      {showEmpty && tab === "upcoming" ? (
        <div className="myt-empty">
          <p className="myt-empty__title">No confirmed plans yet</p>
          <p className="myt-empty__body">
            Say you're interested in an activity. Once an organiser confirms a time and a meeting point, the plan shows up here.
          </p>
          <Button variant="primary" onClick={onDiscover}>
            Find something to do
          </Button>
        </div>
      ) : null}

      {plans.state === "ready" && !showEmpty && tab === "upcoming" ? (
        <section className="myt-stack" aria-label="Confirmed plans">
          <SectionHeader
            level={2}
            title="Confirmed plans"
            description={
              canAnswer
                ? "Saying you're going tells the group you plan to be there. It doesn't buy a ticket or reserve a place; use the original listing for that if booking is needed."
                : `${cannotAnswerReason} Saved plans don't reserve tickets or places.`
            }
          />
          {current.length > 0 ? (
            <ul className="myt-stack myt-stack--lg" aria-label="Confirmed plans">
              {current.map(renderEntry)}
            </ul>
          ) : (
            <p className="myt-muted">
              Nothing is confirmed for the future yet. When an organiser confirms a time and a meeting point, it will appear here.
            </p>
          )}
        </section>
      ) : null}

      {interestedActivities !== undefined && !showEmpty && tab === "upcoming" ? (
        <section className="myt-stack" aria-label="Interested, no plan yet">
          <SectionHeader
            level={2}
            title="Interested, no plan yet"
            description="Interest is a note to the group, not a commitment. Nothing here is confirmed until an organiser picks a time and a meeting point."
          />
          {interestedActivities.state === "loading" ? <div className="myt-skeleton myt-skeleton--block" aria-hidden="true" /> : null}
          {interestedActivities.state === "error" ? (
            <p className="myt-muted" role="status">
              We couldn't load the activities you're interested in. {interestedActivities.error.message}
            </p>
          ) : null}
          {interestedActivities.state === "ready" && interested.length === 0 ? (
            <p className="myt-muted">Activities you're interested in, and that don't have a plan yet, will show up here.</p>
          ) : null}
          {interested.length > 0 ? (
            <ul className="myt-grid">
              {interested.map((activity) => (
                <InterestedCard key={activity.id} activity={activity} onOpen={() => onNavigate({ name: "activity", activityId: activity.id })} />
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {earlier.length > 0 && tab === "past" ? (
        <section className="myt-stack" aria-label="Earlier plans">
          <SectionHeader level={2} title="Earlier plans" description="These have already happened. They're kept as a record and can't be changed." />
          <ul className="myt-stack myt-stack--lg" aria-label="Earlier plans">
            {earlier.map(renderEntry)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ plan entry */

interface PlanEntryProps {
  card: PlanCard;
  phase: Phase;
  nowMs: number;
  currentUserId: string | null;
  onOpenPlan: (planId: string) => void;
  goingPeople: Loadable<ParticipantSummary[]> | undefined;
  organiser: ParticipantSummary | null;
  parentState: ActionState | undefined;
  localState: LocalAttendance | undefined;
  canAnswer: boolean;
  onAnswer: (status: AttendanceStatus) => void;
}

function attendanceChip(phase: Phase, attendance: AttendanceStatus | null): { tone: Tone; label: string } {
  if (phase === "ended") {
    if (attendance === "going") return { tone: "neutral", label: "You said you were going" };
    if (attendance === "declined") return { tone: "neutral", label: "You couldn't make it" };
    return { tone: "neutral", label: "You didn't answer" };
  }
  if (attendance === "going") return { tone: "success", label: "You're going" };
  if (attendance === "declined") return { tone: "neutral", label: "You can't make it" };
  return { tone: "warn", label: "Not answered yet" };
}

function PlanEntry({
  card,
  phase,
  nowMs,
  currentUserId,
  onOpenPlan,
  goingPeople,
  organiser,
  parentState,
  localState,
  canAnswer,
  onAnswer,
}: PlanEntryProps) {
  const headingId = useId();
  const { plan, activity, myAttendance } = card;
  const summary = buildPlanSummary({
    plan,
    activity,
    organiser,
    goingPeople: goingPeople?.state === "ready" ? goingPeople.value : [],
  });
  const dateParts = londonDateParts(plan.startAt);
  const chip = attendanceChip(phase, myAttendance);

  // T5 owns the rule for "going": only before the plan starts. Declining stays possible until it has ended.
  const startMs = Date.parse(plan.startAt);
  const goingDecision = evaluateAttendance({
    currentUserId,
    realUserIds: new Set(currentUserId !== null && !currentUserId.startsWith("sample:") && !currentUserId.startsWith("preview:") ? [currentUserId] : []),
    planExists: true,
    planStartMs: Number.isFinite(startMs) ? startMs : null,
    nowMs,
    desiredStatus: "going",
  });
  const open = phase !== "ended";
  const showGoing = canAnswer && open && myAttendance !== "going" && goingDecision.allowed;
  const showDecline = canAnswer && open && myAttendance !== "declined";
  const blockedNote = canAnswer && open && myAttendance !== "going" && !goingDecision.allowed ? goingDecision.message : null;

  const pending = localState?.status === "pending" ? localState : null;
  const failed = localState?.status === "error" ? localState : null;
  const settled = localState?.status === "saved" ? localState : null;
  const parentError = parentState?.status === "error" ? parentState : null;

  let status = "";
  if (pending) {
    status = pending.target === "going" ? "Saving that you're going…" : "Saving that you can't make it…";
  } else if (settled) {
    status =
      myAttendance === settled.target
        ? settled.target === "going"
          ? "Saved. You're marked as going."
          : "Saved. You're marked as not going. The plan is still there for everyone else."
        : "Saved. This list updates from the shared files, which can take a moment.";
  } else if (parentState?.status === "pending") {
    status = "Saving…";
  } else if (parentState?.status === "saved") {
    status = "Saved.";
  }

  let going: string;
  if (goingPeople === undefined) {
    going = card.goingCount === 1 ? "1 going" : `${card.goingCount} going`;
  } else if (goingPeople.state === "loading") {
    going = "Loading who's going…";
  } else if (goingPeople.state === "error") {
    going = "Who's going is unavailable right now";
  } else if (summary.goingCount === 0) {
    going = "Nobody has said they're going yet";
  } else {
    going = `${summary.goingCount} going: ${summary.goingPeople.map((person) => person.displayName.trim() || "Participant").join(", ")}`;
  }

  return (
    <li>
      <article className="myt-plan myt-plan--compact" data-tone={activity?.interestId ?? "neutral"} aria-labelledby={headingId}>
        <div className="myt-plan__when" aria-hidden="true">
          {dateParts ? (
            <>
              <span className="myt-plan__day">{dateParts.day}</span>
              <span className="myt-plan__date">{dateParts.date}</span>
              <span className="myt-plan__month">{dateParts.month}</span>
            </>
          ) : (
            <span className="myt-plan__date">?</span>
          )}
        </div>

        <div className="myt-plan__body">
          <div className="myt-cluster">
            <Chip tone={chip.tone}>{chip.label}</Chip>
            {phase === "underway" ? <Chip tone="accent">Already started</Chip> : null}
            {phase === "ended" ? <Chip>Ended</Chip> : null}
            {phase === "unknown" ? <Chip tone="warn">Time unclear</Chip> : null}
          </div>
          <h3 id={headingId} className="myt-plan__title">
            {summary.title}
          </h3>
          <p className="myt-plan__time">
            {summary.when} <span className="myt-muted">(London time)</span>
          </p>
          <dl className="myt-facts">
            <dt>Meet</dt>
            <dd>{summary.meetingPoint}</dd>
            {summary.organiserName ? (
              <>
                <dt>Organiser</dt>
                <dd>{summary.organiserName}</dd>
              </>
            ) : null}
            <dt>Going</dt>
            <dd>{going}</dd>
          </dl>

          {summary.source ? (
            <div className="myt-stack myt-stack--xs">
              {summary.source.href ? (
                <div>
                  <ButtonLink href={summary.source.href} size="sm">
                    View original listing
                  </ButtonLink>
                </div>
              ) : null}
              <p className="myt-small myt-muted myt-wrap-anywhere">
                {summary.source.label}. {summary.source.detail}
              </p>
            </div>
          ) : (
            <p className="myt-small myt-muted">
              The original activity listing is no longer available. The time and meeting point above are what your group saved.
            </p>
          )}

          {blockedNote ? <p className="myt-small myt-muted">{blockedNote}</p> : null}
          <p className="myt-small myt-muted" role="status" aria-live="polite">
            {status}
          </p>

          {failed ? (
            <div className="myt-banner" data-tone="danger" role="alert">
              <div className="myt-banner__text">
                <p className="myt-banner__title">
                  {failed.target === "going" ? "Couldn't save that you're going" : "Couldn't save that you can't make it"}
                </p>
                <p className="myt-small myt-wrap-anywhere">
                  {failed.error.message} Your earlier answer is unchanged, and the plan is still there for everyone.
                </p>
              </div>
              <Button size="sm" onClick={() => onAnswer(failed.target)}>
                Try again
              </Button>
            </div>
          ) : null}
          {parentError ? (
            <div className="myt-banner" data-tone="danger" role="alert">
              <div className="myt-banner__text">
                <p className="myt-banner__title">Couldn't save your answer</p>
                <p className="myt-small myt-wrap-anywhere">{parentError.error.message} Your earlier answer is unchanged.</p>
              </div>
              <Button size="sm" onClick={parentError.retry}>
                Try again
              </Button>
            </div>
          ) : null}
        </div>

        <div className="myt-plan__foot">
          {showGoing ? (
            <Button
              variant="primary"
              pending={pending?.target === "going"}
              disabled={pending !== null && pending.target !== "going"}
              aria-label={`I'm going, ${summary.title}`}
              onClick={() => onAnswer("going")}
            >
              I'm going
            </Button>
          ) : null}
          {showDecline ? (
            <Button
              variant="danger"
              pending={pending?.target === "declined"}
              disabled={pending !== null && pending.target !== "declined"}
              aria-label={`Can't make it, ${summary.title}`}
              onClick={() => onAnswer("declined")}
            >
              Can't make it
            </Button>
          ) : null}
          <Button variant="quiet" aria-label={`Open plan: ${summary.title}`} onClick={() => onOpenPlan(plan.id)}>
            Open plan
          </Button>
        </div>
      </article>
    </li>
  );
}

/* ------------------------------------------------------ interest only card */

function InterestedCard({ activity, onOpen }: { activity: Activity; onOpen: () => void }) {
  return (
    <li className="myt-activity-card">
      <div className="myt-activity-card__top">
        <ActivityMark interestId={activity.interestId} title={activity.title} />
        <div className="myt-activity-card__heading">
          <h3>
            <button type="button" className="myt-activity-card__link" onClick={onOpen}>
              {activity.title}
            </button>
          </h3>
          <div className="myt-badges">
            <Chip tone="accent">You're interested</Chip>
            <Chip>No plan yet</Chip>
            {activity.status === "unavailable" ? <Chip tone="warn">No longer available</Chip> : null}
          </div>
        </div>
      </div>
      <div className="myt-activity-card__meta">
        <span className="myt-wrap-anywhere">{activity.area}</span>
      </div>
      <div className="myt-activity-card__footer">
        <span>Not confirmed. You haven't said you're going.</span>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- skeleton */

function PlansSkeleton() {
  return (
    <div className="myt-stack myt-stack--lg" aria-busy="true" aria-label="Loading your plans">
      {[0, 1].map((index) => (
        <div key={index} className="myt-panel" aria-hidden="true">
          <span className="myt-skeleton myt-skeleton--title" />
          <span className="myt-skeleton myt-skeleton--short" />
          <span className="myt-skeleton myt-skeleton--block" />
        </div>
      ))}
    </div>
  );
}
