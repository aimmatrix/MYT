import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { AvailabilityKey, InterestId, MytError, Profile, ProfileInput } from "../types";
import type { OnboardingProps } from "../ui-contract";
import { Button, Chip, ChipGroup, Field, Panel, SectionHeader, cx } from "../components/ui";

/*
 * MYT onboarding and preferences (S3). Prop-driven: no host connection, repository, storage or
 * auth of its own. Persistence is the `onSave` callback, navigation is `onNavigate`.
 *
 * Integration (S1 builds these props from G3's view model; every callback is named):
 *
 *   <Onboarding
 *     mode={model.mode}                         // "live" | "preview"
 *     currentUser={model.currentUser}           // null when signed out
 *     onNavigate={router.navigate}              // called with { name: "discover" } after a real save
 *     profile={model.profile}                   // Loadable<Profile | null>; ready+null means a new user
 *     saveState={profileSaveAction.state}       // G9 ActionState for the profile write
 *     onSave={model.actions?.saveProfile}       // (ProfileInput) => Promise<ActionResult<Profile>>; absent in preview/signed-out
 *     onEnterPreview={() => router.enterPreview()}  // optional; offered when signed out
 *     onExitPreview={() => router.exitPreview()}    // optional; offered inside preview
 *   />
 *
 * Reset boundary: the draft lives inside a child keyed by mode and signed-in user id, so changing
 * either starts from a clean slate. Within one boundary the draft is seeded once from the loaded
 * profile; later subscription refreshes only replace it while the user has no unsaved edits.
 */

/* ------------------------------------------------------------------ options */

const INTERESTS: ReadonlyArray<{ id: InterestId; label: string }> = [
  { id: "football", label: "Football" },
  { id: "karting", label: "Go-karting" },
  { id: "cinema", label: "Cinema" },
  { id: "music", label: "Music" },
  { id: "social", label: "Social" },
  { id: "fitness", label: "Fitness" },
  { id: "comedy", label: "Comedy" },
  { id: "theatre", label: "Theatre" },
];

const AVAILABILITY: ReadonlyArray<{ id: AvailabilityKey; label: string }> = [
  { id: "weekday-evening", label: "Weekday evenings" },
  { id: "weekend-day", label: "Weekend days" },
  { id: "weekend-evening", label: "Weekend evenings" },
];

const DISPLAY_NAME_MAX = 40;
const UNIVERSITY_MAX = 80;
const BUDGET_MAX_PENCE = 1_000_000; // £10,000, far above any activity here, stops typos like 1e9

const interestLabel = (id: InterestId) => INTERESTS.find((item) => item.id === id)?.label ?? id;
const availabilityLabel = (id: AvailabilityKey) => AVAILABILITY.find((item) => item.id === id)?.label ?? id;

/* ------------------------------------------------------------------- budget */

export type BudgetParse = { ok: true; pence: number | null } | { ok: false; message: string };

const BUDGET_FORMAT_MESSAGE = "Enter pounds like 12 or 12.50, or leave this blank for no limit.";

/**
 * Pounds text to integer pence without floating point. Blank is "no limit" (null). `0`, `0.00`
 * and `£0` are a real zero budget (0). Accepts a leading £ and thousands commas; rejects
 * negatives, letters, exponents and more than two decimal places.
 */
export function parseBudgetPounds(text: string): BudgetParse {
  let value = text.trim();
  if (value === "") return { ok: true, pence: null };
  if (value.startsWith("-")) return { ok: false, message: "A budget can't be negative." };
  if (value.startsWith("£")) value = value.slice(1).trim();
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(value)) value = value.replace(/,/g, "");
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match) return { ok: false, message: BUDGET_FORMAT_MESSAGE };
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (whole === "" && fraction === "") return { ok: false, message: BUDGET_FORMAT_MESSAGE };
  if (fraction.length > 2) return { ok: false, message: "Use at most two decimal places, for example 12.50." };
  if (whole.length > 7) return { ok: false, message: "That budget is too large. Enter £10,000 or less." };
  const pence = (whole === "" ? 0 : Number(whole)) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence) || pence > BUDGET_MAX_PENCE) {
    return { ok: false, message: "That budget is too large. Enter £10,000 or less." };
  }
  return { ok: true, pence };
}

function budgetTextFromPence(pence: number | null): string {
  if (pence === null) return "";
  const pounds = Math.floor(pence / 100);
  const rest = pence % 100;
  return rest === 0 ? String(pounds) : `${pounds}.${String(rest).padStart(2, "0")}`;
}

function formatBudget(pence: number | null): string {
  if (pence === null) return "No limit";
  return `£${budgetTextFromPence(pence)}`;
}

/* -------------------------------------------------------------------- draft */

interface Draft {
  displayName: string;
  university: string;
  interestIds: InterestId[];
  availability: AvailabilityKey[];
  budgetText: string;
}

interface DraftErrors {
  displayName?: string;
  university?: string;
  interests?: string;
  availability?: string;
  budget?: string;
}

const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
const lengthOf = (text: string) => Array.from(text).length;

function emptyDraft(suggestedName: string): Draft {
  return { displayName: suggestedName, university: "", interestIds: [], availability: [], budgetText: "" };
}

function draftFromProfile(profile: Pick<Profile, "displayName" | "university" | "interestIds" | "availability" | "budgetPence">): Draft {
  return {
    displayName: profile.displayName,
    university: profile.university,
    interestIds: INTERESTS.map((item) => item.id).filter((id) => profile.interestIds.includes(id)),
    availability: AVAILABILITY.map((item) => item.id).filter((id) => profile.availability.includes(id)),
    budgetText: budgetTextFromPence(profile.budgetPence),
  };
}

/** Order-insensitive, whitespace-insensitive identity, so "£12.5" and "12.50" count as the same budget. */
function draftKey(draft: Draft): string {
  const budget = parseBudgetPounds(draft.budgetText);
  return JSON.stringify([
    tidy(draft.displayName),
    tidy(draft.university),
    INTERESTS.map((item) => item.id).filter((id) => draft.interestIds.includes(id)),
    AVAILABILITY.map((item) => item.id).filter((id) => draft.availability.includes(id)),
    budget.ok ? budget.pence : `text:${draft.budgetText.trim()}`,
  ]);
}

function validateDraft(draft: Draft): { errors: DraftErrors; input: ProfileInput | null } {
  const errors: DraftErrors = {};
  const displayName = tidy(draft.displayName);
  const university = tidy(draft.university);

  if (displayName === "") errors.displayName = "Enter the name other people will see.";
  else if (lengthOf(displayName) > DISPLAY_NAME_MAX) errors.displayName = `Keep your name to ${DISPLAY_NAME_MAX} characters or fewer.`;

  if (lengthOf(university) > UNIVERSITY_MAX) errors.university = `Keep this to ${UNIVERSITY_MAX} characters or fewer.`;
  if (draft.interestIds.length === 0) errors.interests = "Pick at least one thing you're into.";
  if (draft.availability.length === 0) errors.availability = "Pick at least one time you're usually free.";

  const budget = parseBudgetPounds(draft.budgetText);
  if (!budget.ok) errors.budget = budget.message;

  if (Object.keys(errors).length > 0 || !budget.ok) return { errors, input: null };
  return {
    errors,
    input: {
      displayName,
      university,
      interestIds: INTERESTS.map((item) => item.id).filter((id) => draft.interestIds.includes(id)),
      availability: AVAILABILITY.map((item) => item.id).filter((id) => draft.availability.includes(id)),
      budgetPence: budget.pence,
    },
  };
}

function toggled<T extends string>(order: ReadonlyArray<{ id: T }>, current: T[], id: T, next: boolean): T[] {
  const set = new Set(current);
  if (next) set.add(id);
  else set.delete(id);
  return order.map((item) => item.id).filter((candidate) => set.has(candidate));
}

/* ----------------------------------------------------------- small pieces */

function Hero({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="myt-hero">
      <SectionHeader level={1} eyebrow={eyebrow} title={title} />
      <p className="myt-lede">
        Tell us what you're into and when you're free. We'll show activities around London and who else is thinking of
        going, so you can make a plan together.
      </p>
      <ul className="myt-hero__points">
        <li>Choose football, go-karting, cinema, music, social events, fitness, comedy or theatre.</li>
        <li>Say "I'd go with someone" without committing to anything.</li>
        <li>No exact birthday, home address or email needed.</li>
      </ul>
    </div>
  );
}

function Banner({
  tone,
  title,
  children,
  action,
  role,
}: {
  tone: "danger" | "warn" | "accent" | "neutral";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div className="myt-banner" data-tone={tone} role={role}>
      <div className="myt-banner__text">
        <p className="myt-banner__title">{title}</p>
        {children ? <p className="myt-small">{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

function ChoiceSet({
  legend,
  hint,
  error,
  required,
  children,
}: {
  legend: string;
  hint: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const base = useId();
  const hintId = `${base}-hint`;
  const errorId = error ? `${base}-error` : undefined;
  return (
    <fieldset className="myt-fieldset" aria-describedby={[hintId, errorId].filter(Boolean).join(" ")} aria-invalid={error ? true : undefined}>
      <legend>
        {legend}
        {required ? (
          <span className="myt-field__flag" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </legend>
      {children}
      <p id={hintId} className="myt-field__hint">
        {hint}
      </p>
      {errorId ? (
        <p id={errorId} className="myt-field__error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function LoadingPanel() {
  return (
    <Panel title="Your preferences" aria-label="Your preferences, loading">
      <div className="myt-stack" aria-busy="true">
        <p className="myt-visually-hidden" role="status">
          Loading your saved preferences
        </p>
        <span className="myt-skeleton myt-skeleton--title" aria-hidden="true" />
        <span className="myt-skeleton myt-skeleton--block" aria-hidden="true" />
        <span className="myt-skeleton myt-skeleton--short" aria-hidden="true" />
        <span className="myt-skeleton myt-skeleton--block" aria-hidden="true" />
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- the screen */

const RECOVERABLE_CODES: ReadonlyArray<MytError["code"]> = ["invalid-json", "invalid-record", "unsupported-schema"];

export function Onboarding(props: OnboardingProps) {
  // Intentional reset boundary: a different mode or a different signed-in user remounts the draft.
  return <OnboardingScreen key={`${props.mode}:${props.currentUser?.id ?? "signed-out"}`} {...props} />;
}

function OnboardingScreen({
  mode,
  currentUser,
  onNavigate,
  profile,
  saveState,
  onSave,
  onEnterPreview,
  onExitPreview,
}: OnboardingProps) {
  const suggestedName = mode === "live" ? (currentUser?.name ?? "").trim() : "";

  const [recover, setRecover] = useState(false);
  const effectiveProfile = useMemo<OnboardingProps["profile"]>(
    () => (recover ? { state: "ready", value: null, issues: [] } : profile),
    [profile, recover],
  );

  const [draft, setDraft] = useState<Draft>(() => emptyDraft(suggestedName));
  const [baseline, setBaseline] = useState<Draft | null>(null); // null until the first loaded profile has been applied
  const [pendingRemote, setPendingRemote] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [, redraw] = useState(0);

  const inFlight = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<"form" | "errors" | "edit" | null>(null);

  const saved: Profile | null = effectiveProfile.state === "ready" ? effectiveProfile.value : null;
  const dirty = baseline !== null && draftKey(draft) !== draftKey(baseline);

  // Apply a loaded profile once, then only adopt later refreshes that cannot overwrite unsaved edits.
  useEffect(() => {
    if (effectiveProfile.state !== "ready") return;
    const incoming = effectiveProfile.value;
    const incomingDraft = incoming ? draftFromProfile(incoming) : emptyDraft(suggestedName);
    if (baseline === null) {
      setDraft(incomingDraft);
      setBaseline(incomingDraft);
      return;
    }
    if (draftKey(incomingDraft) === draftKey(baseline)) {
      setPendingRemote(null);
      return;
    }
    if (draftKey(incomingDraft) === draftKey(draft)) {
      // Our own save arriving back through the subscription.
      setBaseline(incomingDraft);
      setPendingRemote(null);
      return;
    }
    if (!dirty) {
      setDraft(incomingDraft);
      setBaseline(incomingDraft);
      setPendingRemote(null);
      return;
    }
    setPendingRemote(incoming);
  }, [effectiveProfile]);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "form") formRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    else if (target === "errors") errorsRef.current?.focus();
    else if (target === "edit") editRef.current?.focus();
  });

  const { errors, input } = useMemo(() => validateDraft(draft), [draft]);
  const errorMessages = [errors.displayName, errors.university, errors.interests, errors.availability, errors.budget].filter(
    (message): message is string => Boolean(message),
  );
  const shown: DraftErrors = showErrors ? errors : {};

  const busy = submitting || saveState.status === "pending";
  const loadedError = attempted && saveState.status === "error" ? saveState.error.message : null;
  const failureMessage = saveError ?? loadedError;
  const goDiscover = () => onNavigate({ name: "discover" });

  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (inFlight.current || busy) return;
    setShowErrors(true);
    const checked = validateDraft(draft);
    if (!checked.input) {
      focusTarget.current = "errors";
      redraw((n) => n + 1);
      return;
    }
    if (saved && !dirty) {
      goDiscover();
      return;
    }
    if (!onSave) return;

    inFlight.current = true;
    setSubmitting(true);
    setSaveError(null);
    setAttempted(true);
    try {
      const outcome = await onSave(checked.input);
      if (outcome.ok) {
        const next = draftFromProfile(checked.input);
        setDraft(next);
        setBaseline(next);
        setPendingRemote(null);
        setEditing(false);
        setShowErrors(false);
        goDiscover();
      } else {
        setSaveError(outcome.error.message || "We couldn't save your preferences.");
      }
    } catch {
      setSaveError("Something went wrong while saving.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function startEditing() {
    focusTarget.current = "form";
    setEditing(true);
  }

  function cancelEditing() {
    if (busy) return;
    if (baseline) setDraft(baseline);
    setEditing(false);
    setShowErrors(false);
    setSaveError(null);
    setPendingRemote(null);
    focusTarget.current = "edit";
  }

  function useSavedValues() {
    if (!pendingRemote) return;
    const next = draftFromProfile(pendingRemote);
    setDraft(next);
    setBaseline(next);
    setPendingRemote(null);
  }

  /* ---- branches that never show the form ---- */

  if (mode === "preview") {
    if (profile.state === "loading") {
      return (
        <div className="myt-welcome">
          <Hero eyebrow="Preview" title="Find something to do. Find someone to go with." />
          <LoadingPanel />
        </div>
      );
    }
    return (
      <div className="myt-welcome">
        <Hero eyebrow="Preview" title="Find something to do. Find someone to go with." />
        <Panel title="You're looking around in preview">
          <div className="myt-stack">
            {saveState.status === "error" ? (
              <Banner tone="danger" title="Your preferences weren't saved" role="alert">
                {saveState.error.message}
              </Banner>
            ) : null}
            <p>
              Preview shows example activities so you can see how MYT works. Nothing here is saved, and you can't join an
              activity with other people from preview.
            </p>
            <p className="myt-muted">
              Joining and planning with real people needs the shared MYT app, with you signed in to Lightfern.
            </p>
            <div className="myt-actions">
              <Button variant="primary" onClick={goDiscover}>
                Browse activities
              </Button>
              {onExitPreview ? <Button onClick={onExitPreview}>Leave preview</Button> : null}
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="myt-welcome">
        <Hero eyebrow="Welcome to MYT" title="Find something to do. Find someone to go with." />
        <Panel title="Sign in to join in">
          <div className="myt-stack">
            <p>
              MYT needs you signed in to Lightfern so it can tell who's who when people say they'd go. Until then your
              preferences can't be saved.
            </p>
            <p className="myt-muted">
              Sign in to Lightfern and reopen the shared MYT app to join activities and plan with others.
              {onEnterPreview ? " Or look around in preview first." : ""}
            </p>
            {onEnterPreview ? (
              <div className="myt-actions">
                <Button onClick={onEnterPreview}>Look around in preview</Button>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    );
  }

  if (!onSave) {
    return (
      <div className="myt-welcome">
        <Hero eyebrow="Welcome to MYT" title="Find something to do. Find someone to go with." />
        <Panel title="Saving isn't available right now">
          <div className="myt-stack">
            <p>
              MYT can't save preferences in this view, so nothing has been written. Open the shared MYT app to set up your
              profile.
            </p>
            {onEnterPreview ? (
              <div className="myt-actions">
                <Button onClick={onEnterPreview}>Look around in preview</Button>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    );
  }

  /* ---- live and signed in ---- */

  const eyebrow = saved && !editing ? "Welcome back" : "Welcome to MYT";
  const title = saved && !editing ? `Good to see you, ${saved.displayName}` : "Find something to do. Find someone to go with.";

  if (effectiveProfile.state === "loading" || (effectiveProfile.state === "ready" && baseline === null)) {
    return (
      <div className="myt-welcome">
        <Hero eyebrow={eyebrow} title={title} />
        <LoadingPanel />
      </div>
    );
  }

  if (effectiveProfile.state === "error") {
    const canRecover = RECOVERABLE_CODES.includes(effectiveProfile.error.code);
    return (
      <div className="myt-welcome">
        <Hero eyebrow={eyebrow} title={title} />
        <Panel title="We couldn't load your saved profile">
          <div className="myt-stack">
            <Banner tone="danger" title="Your profile didn't load" role="alert">
              {effectiveProfile.error.message}
            </Banner>
            {canRecover ? (
              <>
                <p className="myt-muted">
                  The saved profile file can't be read. You can start a new one, which replaces it when you save.
                </p>
                <div className="myt-actions">
                  <Button onClick={() => setRecover(true)}>Start a new profile</Button>
                </div>
              </>
            ) : (
              <p className="myt-muted">
                To avoid overwriting something we couldn't see, MYT won't let you save until your profile loads. Reopen the
                app to try again.
              </p>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  if (saved && !editing) {
    return (
      <div className="myt-welcome">
        <Hero eyebrow={eyebrow} title={title} />
        <Panel title="Your preferences" description="Everyone using the shared MYT app can see these.">
          <div className="myt-stack">
            <dl className="myt-facts">
              <dt>Name</dt>
              <dd>{saved.displayName}</dd>
              <dt>University</dt>
              <dd>{saved.university.trim() === "" ? "Not shared" : saved.university}</dd>
              <dt>Interests</dt>
              <dd>
                <span className="myt-cluster">
                  {saved.interestIds.map((id) => (
                    <Chip key={id} tone={id}>
                      {interestLabel(id)}
                    </Chip>
                  ))}
                </span>
              </dd>
              <dt>Free</dt>
              <dd>{saved.availability.map(availabilityLabel).join(", ") || "Not set"}</dd>
              <dt>Budget</dt>
              <dd>{formatBudget(saved.budgetPence)}</dd>
            </dl>
            <div className="myt-actions">
              <Button variant="primary" onClick={goDiscover}>
                Find activities
              </Button>
              <Button ref={editRef} onClick={startEditing}>
                Edit preferences
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="myt-welcome">
      <Hero eyebrow={eyebrow} title={title} />
      <Panel
        title={saved ? "Edit your preferences" : "Your preferences"}
        description="Everyone using the shared MYT app can see your name, university and interests."
      >
        <div className="myt-stack myt-stack--lg" ref={formRef} aria-busy={busy || undefined}>
          {recover ? (
            <Banner tone="warn" title="Starting a new profile">
              Saving will replace the profile file we couldn't read.
            </Banner>
          ) : null}

          {pendingRemote ? (
            <Banner
              tone="accent"
              title="Your saved profile changed somewhere else"
              role="status"
              action={
                <Button size="sm" onClick={useSavedValues} disabled={busy}>
                  Use saved values
                </Button>
              }
            >
              Your edits here are untouched.
            </Banner>
          ) : null}

          {showErrors && errorMessages.length > 0 ? (
            <div ref={errorsRef} tabIndex={-1} role="alert" className="myt-banner" data-tone="danger">
              <div className="myt-banner__text">
                <p className="myt-banner__title">
                  {errorMessages.length === 1 ? "One thing needs fixing" : `${errorMessages.length} things need fixing`}
                </p>
                <ul className="myt-small">
                  {errorMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {failureMessage ? (
            <Banner
              tone="danger"
              title="We couldn't save your preferences"
              role="alert"
              action={
                <Button size="sm" onClick={submit} disabled={busy}>
                  Try again
                </Button>
              }
            >
              {failureMessage} Your answers are still here.
            </Banner>
          ) : null}

          <div className="myt-form-grid">
            <Field
              label="Display name"
              required
              value={draft.displayName}
              onChange={(value) => edit("displayName", value)}
              error={shown.displayName}
              hint="What other people will see. It doesn't have to be your full name."
              maxLength={DISPLAY_NAME_MAX * 2}
              autoComplete="nickname"
              disabled={busy}
            />
            <Field
              label="University"
              optional
              value={draft.university}
              onChange={(value) => edit("university", value)}
              error={shown.university}
              hint="Leave it blank if you'd rather not say."
              placeholder="For example UCL"
              maxLength={UNIVERSITY_MAX * 2}
              autoComplete="organization"
              disabled={busy}
            />

            <div className="myt-span-all">
              <ChoiceSet legend="What are you into?" required hint="Pick as many as you like." error={shown.interests}>
                <ChipGroup label="Interests">
                  {INTERESTS.map((item) => (
                    <Chip
                      key={item.id}
                      tone={item.id}
                      selected={draft.interestIds.includes(item.id)}
                      disabled={busy}
                      onSelectedChange={(next) =>
                        setDraft((current) => ({ ...current, interestIds: toggled(INTERESTS, current.interestIds, item.id, next) }))
                      }
                    >
                      {item.label}
                    </Chip>
                  ))}
                </ChipGroup>
              </ChoiceSet>
            </div>

            <div className="myt-span-all">
              <ChoiceSet legend="When are you usually free?" required hint="A rough idea is enough." error={shown.availability}>
                <ChipGroup label="Availability">
                  {AVAILABILITY.map((item) => (
                    <Chip
                      key={item.id}
                      selected={draft.availability.includes(item.id)}
                      disabled={busy}
                      onSelectedChange={(next) =>
                        setDraft((current) => ({ ...current, availability: toggled(AVAILABILITY, current.availability, item.id, next) }))
                      }
                    >
                      {item.label}
                    </Chip>
                  ))}
                </ChipGroup>
              </ChoiceSet>
            </div>

            <Field
              className="myt-span-all"
              label="Most you'd spend per activity (£)"
              optional
              value={draft.budgetText}
              onChange={(value) => edit("budgetText", value)}
              error={shown.budget}
              hint="Leave blank for no limit. 0 is saved as a zero budget."
              placeholder="For example 15"
              inputMode="decimal"
              autoComplete="off"
              disabled={busy}
            />
          </div>

          <div className="myt-actions">
            <Button variant="primary" onClick={submit} pending={busy}>
              Find activities
            </Button>
            {saved ? (
              <Button onClick={cancelEditing} disabled={busy}>
                Cancel
              </Button>
            ) : null}
          </div>
          <p className={cx("myt-small", "myt-muted")} role="status" aria-live="polite">
            {busy ? "Saving your preferences…" : ""}
          </p>
        </div>
      </Panel>
    </div>
  );
}
