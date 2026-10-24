import { useRef, type ReactNode } from "react";
import type { Activity, InterestId, Plan, TimeOption } from "../types";
import type { ActivityDetailProps } from "../ui-contract";
import { ActivityMark, Button, ButtonLink, Chip, Panel, SectionHeader, type Tone } from "../components/ui";
import { CompanionList } from "../components/CompanionList";
import { InterestPanel } from "../components/InterestPanel";
import { PresenceStrip } from "../components/PresenceStrip";
import { TimeVotePanel } from "../components/TimeVotePanel";

/*
 * Activity detail (S5). Prop-driven: no host, repository, room or storage access. Composes S6
 * (InterestPanel), S7 (TimeVotePanel), S10 (CompanionList) and G5 (PresenceStrip) through the
 * child-prop objects in ActivityDetailProps. Every action is a callback from a child or the parent.
 *
 * Time, cost and source presentation are small private helpers below because C1 (source badge),
 * C2 (London time) and C3 (cost) were not in the library when this was written. Swap them for the
 * shared modules when those are imported; the markup around them does not change.
 */

const INTEREST_LABEL: Record<InterestId, string> = {
  football: "Football",
  karting: "Karting",
  cinema: "Cinema",
  music: "Music",
  social: "Social",
  fitness: "Fitness",
  comedy: "Comedy",
  theatre: "Theatre",
};

/* ------------------------------------------------------------ presentation helpers */

const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function parseInstant(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !EXPLICIT_OFFSET.test(value.trim())) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function londonParts(ms: number): { day: string; time: string; date: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return {
      day: `${get("weekday")} ${get("day")} ${get("month")}`,
      time: `${get("hour")}:${get("minute")}`,
      date: `${get("day")} ${get("month")} ${get("year")}`,
    };
  } catch {
    return null;
  }
}

function formatWhen(startAt: string, endAt: string | null): string {
  const startMs = parseInstant(startAt);
  const start = startMs === null ? null : londonParts(startMs);
  if (!start) return "Time not available";
  const endMs = parseInstant(endAt);
  const end = endMs !== null && startMs !== null && endMs > startMs ? londonParts(endMs) : null;
  if (!end) return `${start.day}, ${start.time}`;
  return end.day === start.day ? `${start.day}, ${start.time} to ${end.time}` : `${start.day}, ${start.time} to ${end.day}, ${end.time}`;
}

function formatCheckedDate(value: string | null): string | null {
  const ms = parseInstant(value);
  const parts = ms === null ? null : londonParts(ms);
  return parts ? parts.date : null;
}

function formatCost(cost: Activity["cost"]): string {
  const pence = cost.amountPence;
  if (pence === null || !Number.isFinite(pence) || pence < 0) return "Price not listed";
  if (pence === 0) return cost.isEstimate ? "Estimated free" : "Free";
  const pounds = pence % 100 === 0 ? String(pence / 100) : (pence / 100).toFixed(2);
  return `${cost.isEstimate ? "About " : ""}£${pounds}`;
}

/** Only plain https links without embedded credentials are shown; anything else is treated as no link. */
function safeHttpsLink(raw: string | null): { href: string; host: string } | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    return { href: url.href, host: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function sourceChip(source: Activity["source"]): { tone: Tone; label: string } {
  if (source.kind === "verified") return { tone: "success", label: "Verified event" };
  if (source.kind === "unverified") return { tone: "warn", label: "Unverified" };
  return { tone: "warn", label: "Demo activity idea" };
}

function sourceNote(source: Activity["source"]): string {
  if (source.kind === "verified") {
    const checked = formatCheckedDate(source.checkedAt);
    return `We checked the organiser's own listing${checked ? ` on ${checked}` : ""}. That is not a booking: MYT does not book tickets or reserve places.`;
  }
  if (source.kind === "unverified") {
    return "We could not check this listing. Confirm the details with the organiser before making plans.";
  }
  return "An example idea, not a real listing. Nothing is scheduled, booked or reserved.";
}

/* ------------------------------------------------------------------ main component */

export function ActivityDetail(props: ActivityDetailProps) {
  const { activity, onBack } = props;
  const back = (
    <Button variant="quiet" size="sm" className="myt-back" onClick={onBack}>
      ← All activities
    </Button>
  );

  if (activity.state === "loading") return <DetailSkeleton back={back} />;

  if (activity.state === "error") {
    return (
      <div className="myt-stack myt-stack--lg">
        {back}
        <Panel tone="danger" title="We couldn't load this activity">
          <p className="myt-muted">Go back to the list and open it again. {activity.error.message}</p>
          <div className="myt-actions">
            <Button variant="primary" onClick={onBack}>
              Back to activities
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  if (activity.value === null) {
    return (
      <div className="myt-stack myt-stack--lg">
        {back}
        <div className="myt-empty">
          <p className="myt-empty__title">This activity isn't available</p>
          <p className="myt-empty__body">It may have been removed from the list. Your other plans and choices are unaffected.</p>
          <Button variant="primary" onClick={onBack}>
            Back to activities
          </Button>
        </div>
      </div>
    );
  }

  return <DetailBody {...props} activity={activity.value} back={back} />;
}

/* ---------------------------------------------------------------------- loading */

function DetailSkeleton({ back }: { back: ReactNode }) {
  return (
    <div className="myt-stack myt-stack--lg" aria-busy="true">
      {back}
      <p className="myt-visually-hidden" role="status">
        Loading activity
      </p>
      <div className="myt-detail" aria-hidden="true">
        <div className="myt-detail__main">
          <div className="myt-detail__hero">
            <span className="myt-skeleton myt-skeleton--mark" />
            <div className="myt-section-header__text">
              <span className="myt-skeleton myt-skeleton--title" />
              <span className="myt-skeleton myt-skeleton--short" />
            </div>
          </div>
          <Panel>
            <div className="myt-stack">
              <span className="myt-skeleton myt-skeleton--block" />
              <span className="myt-skeleton myt-skeleton--short" />
            </div>
          </Panel>
          <Panel>
            <div className="myt-stack">
              <span className="myt-skeleton myt-skeleton--title" />
              <span className="myt-skeleton myt-skeleton--block" />
            </div>
          </Panel>
        </div>
        <div className="myt-detail__aside">
          <Panel>
            <div className="myt-stack">
              <span className="myt-skeleton myt-skeleton--title" />
              <span className="myt-skeleton myt-skeleton--block" />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ body */

type BodyProps = Omit<ActivityDetailProps, "activity"> & { activity: Activity; back: ReactNode };

function DetailBody(props: BodyProps) {
  const { activity, plan, mode, currentUser, interestPanel, timeVotePanel, companionList, presenceStrip, confirmationEntry, back } = props;
  const interestRef = useRef<HTMLDivElement>(null);

  /* Everything below is re-derived from the current props on every render, so a stale activity,
     plan or child prop set cannot leave an active action on screen. */
  const available = activity.status === "available";
  const planValue = plan.state === "ready" ? plan.value : null;
  const planMatches = planValue !== null && planValue.activityId === activity.id;
  const planReady = plan.state === "ready" && (planValue === null || planMatches);
  const planExists = planMatches || interestPanel.planExists || timeVotePanel.planExists;
  const idsMatch =
    interestPanel.activityId === activity.id && timeVotePanel.activityId === activity.id && companionList.activity.id === activity.id;
  const canChange = available && planReady && !planExists && idsMatch && mode === "live" && currentUser !== null;

  const confirm = confirmationState();

  function confirmationState(): { allowed: boolean; reason: string | null } {
    if (planExists) return { allowed: false, reason: null };
    if (!available) return { allowed: false, reason: "This activity is no longer available, so a plan can't be confirmed." };
    if (mode === "preview") return { allowed: false, reason: "Preview mode can't confirm plans. Nothing here is saved." };
    if (currentUser === null) return { allowed: false, reason: "Sign in to take part. Only the organiser can confirm a plan." };
    if (plan.state === "loading") return { allowed: false, reason: "Checking whether a plan has already been confirmed." };
    if (!planReady) return { allowed: false, reason: "We couldn't check for an existing plan, so confirmation is paused." };
    if (!idsMatch) return { allowed: false, reason: "Updating the details for this activity." };
    if (!confirmationEntry.allowed) {
      return { allowed: false, reason: confirmationEntry.reason?.trim() || "Confirmation isn't available yet." };
    }
    return { allowed: true, reason: null };
  }

  function openConfirmation() {
    if (confirm.allowed) props.onOpenConfirmation();
  }

  function goToInterest() {
    timeVotePanel.onGoToInterest();
    const node = interestRef.current;
    if (!node) return;
    try {
      node.scrollIntoView({ block: "center" });
      node.focus({ preventScroll: true });
    } catch {
      /* focus and scroll are best effort */
    }
  }

  const source = sourceChip(activity.source);
  const link = safeHttpsLink(activity.source.url);
  const verified = activity.source.kind === "verified";
  const options = activity.timeOptions;

  return (
    <div className="myt-stack myt-stack--lg">
      {back}

      <div className="myt-detail">
        <div className="myt-detail__main">
          <div className="myt-detail__hero">
            <ActivityMark size="lg" interestId={activity.interestId} title={activity.title} />
            <div className="myt-stack myt-stack--sm">
              <SectionHeader level={1} title={activity.title} />
              <div className="myt-badges">
                <Chip tone={activity.interestId}>{INTEREST_LABEL[activity.interestId] ?? activity.interestId}</Chip>
                <Chip tone={source.tone}>{source.label}</Chip>
                {!available ? <Chip tone="danger">No longer available</Chip> : null}
                {mode === "preview" ? <Chip tone="warn">Preview</Chip> : null}
              </div>
            </div>
          </div>

          {!available ? (
            <div className="myt-banner" data-tone="warn" role="status">
              <div className="myt-banner__text">
                <p className="myt-banner__title">This activity is no longer listed as available</p>
                <p className="myt-muted">You can still read the details. Joining, time choices and confirmation are turned off.</p>
              </div>
            </div>
          ) : null}

          {planExists ? (
            <PlanPanel plan={planValue} planMatches={planMatches} activityLink={link} onOpenPlan={props.onOpenPlan} />
          ) : (
            <StepsPanel
              mode={mode}
              signedIn={currentUser !== null}
              available={available}
              planState={plan.state}
              interest={interestPanel.interest}
              vote={timeVotePanel.myVote}
              confirmAllowed={confirm.allowed}
              confirmReason={confirm.reason}
              onOpenConfirmation={openConfirmation}
            />
          )}

          <Panel title="About this activity">
            <div className="myt-stack">
              <p className="myt-wrap-anywhere">{activity.description}</p>
              <dl className="myt-facts">
                <dt>Where</dt>
                <dd>{activity.area.trim() || "Area not listed"}</dd>

                <dt>{verified ? "Listed time" : options.length === 1 ? "Proposed time" : "Proposed times"}</dt>
                <dd>
                  <TimeList options={options} futureIds={timeVotePanel.validFutureOptionIds} />
                  {options.length === 0 ? null : (
                  <span className="myt-small myt-muted">
                    {verified ? "London time, from the organiser's listing." : "London time. A suggestion for the group, not a booking."}
                  </span>
                  )}
                </dd>

                <dt>Cost</dt>
                <dd>{formatCost(activity.cost)}</dd>

                <dt>Source</dt>
                <dd>
                  <span className="myt-stack myt-stack--xs">
                    <span>
                      <Chip tone={source.tone}>{source.label}</Chip>
                      {link ? <span className="myt-muted"> {link.host}</span> : null}
                    </span>
                    <span className="myt-small myt-muted">{sourceNote(activity.source)}</span>
                    {activity.source.url && !link ? (
                      <span className="myt-small myt-muted">The saved link isn't a valid secure web address, so it isn't shown.</span>
                    ) : null}
                  </span>
                </dd>
              </dl>
              {link ? (
                <div className="myt-actions">
                  <ButtonLink href={link.href} size="sm">
                    View original listing
                    <span className="myt-visually-hidden"> (opens in your browser)</span>
                  </ButtonLink>
                </div>
              ) : null}
            </div>
          </Panel>

          {idsMatch ? (
            available || planExists ? (
              <TimeVotePanel
                {...timeVotePanel}
                planExists={planExists}
                onSetVote={canChange ? timeVotePanel.onSetVote : undefined}
                onGoToInterest={goToInterest}
              />
            ) : null
          ) : (
            <UpdatingPanel />
          )}
        </div>

        <div className="myt-detail__aside">
          <PresenceStrip {...presenceStrip} />

          {idsMatch ? (
            <div ref={interestRef} tabIndex={-1} role="group" aria-label="Your interest in this activity">
              <InterestPanel
                {...interestPanel}
                activityAvailable={available && interestPanel.activityAvailable}
                planExists={planExists}
                onSetInterest={canChange ? interestPanel.onSetInterest : undefined}
              />
              {props.onOpenChat ? <Button variant="primary" fullWidth onClick={props.onOpenChat}>Group chat →</Button> : null}
            </div>
          ) : (
            <UpdatingPanel />
          )}

          {idsMatch && available ? <CompanionList {...companionList} /> : null}
        </div>
      </div>
    </div>
  );
}

function UpdatingPanel() {
  return (
    <Panel aria-label="Updating">
      <div className="myt-stack" aria-busy="true">
        <p className="myt-muted" role="status">
          Updating the details for this activity.
        </p>
        <span className="myt-skeleton myt-skeleton--block" aria-hidden="true" />
      </div>
    </Panel>
  );
}

/* ----------------------------------------------------------------- time options */

function TimeList({ options, futureIds }: { options: TimeOption[]; futureIds: ReadonlySet<string> }) {
  if (options.length === 0) return <span>No times listed</span>;
  return (
    <ul className="myt-stack myt-stack--xs">
      {options.map((option, index) => (
        <li key={`${option.id}-${index}`}>
          {formatWhen(option.startAt, option.endAt)}
          {futureIds.has(option.id) ? null : <span className="myt-muted"> · passed or not valid</span>}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- plan panel */

function PlanPanel({
  plan,
  planMatches,
  activityLink,
  onOpenPlan,
}: {
  plan: Plan | null;
  planMatches: boolean;
  activityLink: { href: string; host: string } | null;
  onOpenPlan: (planId: string) => void;
}) {
  if (!plan || !planMatches) {
    return (
      <Panel tone="warn" title="A plan has been confirmed" aria-label="Plan confirmed, details loading">
        <p className="myt-muted" role="status">
          The plan's details are still loading. Interest and time choices are closed.
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      tone="success"
      title="Plan confirmed"
      description="Interest and time choices are now closed."
      actions={<Chip tone="success">Confirmed</Chip>}
    >
      <div className="myt-stack">
        <dl className="myt-facts">
          <dt>When</dt>
          <dd>{formatWhen(plan.startAt, plan.endAt)} (London time)</dd>
          <dt>Meeting point</dt>
          <dd>{plan.meetingPoint}</dd>
        </dl>
        <p className="myt-small myt-muted">
          Being interested is not the same as going: each person marks themselves as going on the plan page.
          {activityLink ? " Check the original listing for tickets and details." : ""} MYT does not book tickets or reserve places.
        </p>
        <div className="myt-actions">
          <Button variant="primary" onClick={() => onOpenPlan(plan.id)}>
            Open the plan
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ steps panel */

type Remote<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error" };

function StepsPanel({
  mode,
  signedIn,
  available,
  planState,
  interest,
  vote,
  confirmAllowed,
  confirmReason,
  onOpenConfirmation,
}: {
  mode: ActivityDetailProps["mode"];
  signedIn: boolean;
  available: boolean;
  planState: "loading" | "ready" | "error";
  interest: ActivityDetailProps["interestPanel"]["interest"];
  vote: ActivityDetailProps["timeVotePanel"]["myVote"];
  confirmAllowed: boolean;
  confirmReason: string | null;
  onOpenConfirmation: () => void;
}) {
  const myInterest: Remote<"interested" | "withdrawn" | null> =
    interest.state === "ready" ? { state: "ready", value: interest.value } : { state: interest.state };
  const myVote: Remote<string | null> = vote.state === "ready" ? { state: "ready", value: vote.value?.optionId ?? null } : { state: vote.state };

  const interested = myInterest.state === "ready" && myInterest.value === "interested";
  const voted = interested && myVote.state === "ready" && myVote.value !== null;
  const canTakePart = available && mode === "live" && signedIn;

  const intro = !available
    ? "This activity can't be planned any more."
    : mode === "preview"
      ? "Preview mode: this is an example of the steps. Nothing is saved and you can't join."
      : !signedIn
        ? "Sign in to join. You can still look around."
        : "Three small steps turn an idea into a plan. You can change your mind until a plan is confirmed.";

  type Step = { title: string; detail: string; status: "done" | "next" | "later" };
  const step1: Step = {
    title: "Say you'd go with someone",
    detail:
      myInterest.state === "loading"
        ? "Checking your choice."
        : myInterest.state === "error"
          ? "We couldn't load your choice."
          : interested
            ? "You're in. You can withdraw until a plan is confirmed."
            : "Low pressure: it only tells the group you're open to it.",
    status: interested ? "done" : "next",
  };
  const step2: Step = {
    title: "Choose a time that suits you",
    detail: voted
      ? "Your choice is saved. Votes help the organiser; they don't lock anything in."
      : interested
        ? "Pick the time you'd prefer. This is optional and advisory."
        : "Join first, then choose a time.",
    status: voted ? "done" : interested ? "next" : "later",
  };
  const step3: Step = {
    title: "The organiser confirms",
    detail: confirmAllowed
      ? "Enough people are interested. The organiser can review and confirm a time and meeting point."
      : planState === "ready" || planState === "loading"
        ? "The organiser picks a time and a public meeting point once enough people are interested."
        : "We couldn't check for an existing plan.",
    status: confirmAllowed ? "next" : "later",
  };
  const steps = [step1, step2, step3];

  if (!available) {
    return <Panel title="Planning is closed" description={intro} />;
  }

  return (
    <Panel title="Where this stands" description={intro}>
      <div className="myt-stack">
        <ol className="myt-people">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className={step.status === "next" && canTakePart ? "myt-person myt-person--me" : "myt-person"}
              aria-current={step.status === "next" && canTakePart ? "step" : undefined}
            >
              <span className="myt-avatar myt-avatar--sm" aria-hidden="true">
                {index + 1}
              </span>
              <span className="myt-person__text">
                <span className="myt-person__name">{step.title}</span>
                <span className="myt-person__meta">{step.detail}</span>
              </span>
              <span className="myt-person__trail">
                <Chip tone={step.status === "done" ? "success" : step.status === "next" && canTakePart ? "accent" : "neutral"}>
                  {step.status === "done" ? "Done" : step.status === "next" && canTakePart ? "Next" : "Later"}
                </Chip>
              </span>
            </li>
          ))}
        </ol>

        {confirmAllowed ? (
          <div className="myt-actions">
            <Button variant="primary" onClick={onOpenConfirmation}>
              Review and confirm the plan
            </Button>
          </div>
        ) : confirmReason ? (
          <p className="myt-small myt-muted">
            <span className="myt-strong">Why you can't confirm yet:</span> {confirmReason}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
