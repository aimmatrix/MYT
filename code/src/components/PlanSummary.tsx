import { useEffect, useRef, useState } from "react";
import type { MytError } from "../types";
import type { PlanSummaryProps } from "../ui-contract";
import { buildPlanSummary } from "../domain/planSummary";
import { parseInstant } from "../domain/londonTime";
import { evaluateAttendance } from "../domain/planRules";
import { Button, ButtonLink, Panel, SectionHeader } from "./ui";

const wrapStyle = { overflowWrap: "anywhere" as const, minWidth: 0 };

export function PlanSummary(props: PlanSummaryProps) {
  const { plan, activity, organiser, goingPeople, myAttendance, attendanceState, mode, currentUser, onSetAttendance, onBackToPlans } = props;
  const [copyStatus, setCopyStatus] = useState("");
  const [showCopyFallback, setShowCopyFallback] = useState(false);
  const [localError, setLocalError] = useState<MytError | null>(null);
  const [saving, setSaving] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (showCopyFallback) fallbackRef.current?.select();
  }, [showCopyFallback]);

  if (plan.state === "loading") {
    return <p role="status" className="myt-muted">Loading saved plan…</p>;
  }

  if (plan.state === "error") {
    return (
      <Panel tone="danger" title="The saved plan could not be loaded">
        <p style={wrapStyle}>{plan.error.message}</p>
        <Button onClick={onBackToPlans}>Back to My plans</Button>
      </Panel>
    );
  }

  if (plan.value === null) {
    return (
      <Panel title="Plan not found">
        <p className="myt-muted">This plan is no longer available.</p>
        <Button onClick={onBackToPlans}>Back to My plans</Button>
      </Panel>
    );
  }

  const savedPlan = plan.value;
  const attendeesReady = goingPeople.state === "ready";
  const summary = buildPlanSummary({
    plan: savedPlan,
    activity,
    organiser,
    goingPeople: attendeesReady ? goingPeople.value : [],
  });
  const attendanceReady = myAttendance.state === "ready";
  const myStatus = attendanceReady ? myAttendance.value : null;
  const busy = saving || attendanceState.status === "pending";
  const canAct = mode === "live" && currentUser !== null && onSetAttendance !== undefined && attendanceReady;
  const realUserIds = new Set(
    currentUser && !currentUser.id.startsWith("sample:") && !currentUser.id.startsWith("preview:")
      ? [currentUser.id]
      : [],
  );
  const goingDecision = evaluateAttendance({
    currentUserId: currentUser?.id ?? null,
    realUserIds,
    planExists: true,
    planStartMs: parseInstant(savedPlan.startAt),
    nowMs,
    desiredStatus: "going",
  });
  const showGoing = canAct && myStatus !== "going" && goingDecision.allowed;
  const showDecline = canAct && myStatus === "going";

  async function saveAttendance(status: "going" | "declined") {
    if (!onSetAttendance || busy) return;
    setSaving(true);
    setLocalError(null);
    try {
      const result = await onSetAttendance(status);
      if (!result.ok) setLocalError(result.error);
    } catch {
      setLocalError({ code: "io", message: "Attendance could not be saved. Try again." });
    } finally {
      setSaving(false);
    }
  }

  async function copyPlan() {
    setCopyStatus("");
    setShowCopyFallback(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(summary.copyText);
      setCopyStatus("Plan text copied.");
    } catch {
      setShowCopyFallback(true);
      setCopyStatus("Copy was unavailable. Select the plan text below to copy it.");
    }
  }

  return (
    <div className="myt-stack myt-stack--lg" style={wrapStyle}>
      <Button variant="quiet" size="sm" className="myt-back" onClick={onBackToPlans}>← My plans</Button>
      <SectionHeader
        level={1}
        eyebrow="Saved plan"
        title={summary.title}
        description={activity === null
          ? "The activity listing is unavailable. Your saved time and meeting point are still here."
          : "Your group has agreed on a time and public meeting point."}
      />

      <Panel title="Plan details">
        <dl className="myt-facts" style={wrapStyle}>
          <dt>When</dt><dd style={wrapStyle}>{summary.when} <span className="myt-muted">(London time)</span></dd>
          <dt>Meet</dt><dd style={wrapStyle}>{summary.meetingPoint}</dd>
          {summary.area ? <><dt>Area</dt><dd style={wrapStyle}>{summary.area}</dd></> : null}
          {summary.cost ? <><dt>Cost</dt><dd style={wrapStyle}>{summary.cost}</dd></> : null}
          {summary.organiserName ? <><dt>Organiser</dt><dd style={wrapStyle}>{summary.organiserName}</dd></> : null}
          <dt>Going</dt>
          <dd>
            {goingPeople.state === "loading" ? "Loading attendance…" : null}
            {goingPeople.state === "error" ? "Attendance unavailable" : null}
            {attendeesReady ? `${summary.goingCount} ${summary.goingCount === 1 ? "person" : "people"}` : null}
          </dd>
        </dl>
        {goingPeople.state === "error" ? <p role="alert" className="myt-field__error" style={wrapStyle}>{goingPeople.error.message}</p> : null}
        {attendeesReady && summary.goingPeople.length > 0 ? (
          <ul aria-label="People going">
            {summary.goingPeople.map((person) => <li key={person.userId} style={wrapStyle}>{person.displayName || "Participant"}</li>)}
          </ul>
        ) : null}
        <p className="myt-muted">Only people who explicitly marked themselves as going appear here. Interest and live viewing do not count.</p>
      </Panel>

      <Panel title="Your attendance">
        {mode === "preview" ? <p className="myt-muted">Preview only. Nothing is saved here.</p> : null}
        {mode === "live" && currentUser === null ? <p className="myt-muted">Sign in to mark your own attendance.</p> : null}
        {myAttendance.state === "loading" ? <p role="status" className="myt-muted">Loading your attendance…</p> : null}
        {myAttendance.state === "error" ? <p role="alert" className="myt-field__error" style={wrapStyle}>{myAttendance.error.message}</p> : null}
        {attendanceReady && currentUser !== null && mode === "live" ? (
          <>
            <p>{myStatus === "going" ? "You are going." : myStatus === "declined" ? "You marked yourself as not going." : "You have not marked yourself as going."}</p>
            <div className="myt-actions">
              {showGoing ? <Button variant="primary" pending={busy} onClick={() => void saveAttendance("going")}>I'm going</Button> : null}
              {showDecline ? <Button pending={busy} onClick={() => void saveAttendance("declined")}>I can't go</Button> : null}
            </div>
            {!goingDecision.allowed && myStatus !== "going" ? <p className="myt-muted">{goingDecision.message}</p> : null}
            {!onSetAttendance ? <p className="myt-muted">Saving attendance is unavailable right now.</p> : null}
          </>
        ) : null}
        {busy ? <p role="status">Saving your choice…</p> : null}
        {attendanceState.status === "saved" ? <p role="status">Saved on this device. Others see it after file sync.</p> : null}
        {attendanceState.status === "error" ? <p role="alert" className="myt-field__error" style={wrapStyle}>{attendanceState.error.message}</p> : null}
        {localError && attendanceState.status !== "error" ? <p role="alert" className="myt-field__error" style={wrapStyle}>{localError.message}</p> : null}
      </Panel>

      <Panel title="What happens next">
        {summary.source?.href ? (
          <p style={wrapStyle}><ButtonLink href={summary.source.href}>View original listing</ButtonLink></p>
        ) : null}
        {summary.source ? <p className="myt-muted" style={wrapStyle}>{summary.source.label}. {summary.source.detail}</p> : null}
        <p>A saved plan records your group's intention. MYT has not booked tickets or reserved a place. Check the organiser's listing and make any required booking yourself.</p>
        {activity === null ? <p className="myt-muted">The original activity details are missing. Confirm event availability, cost and booking requirements independently.</p> : null}
        <div className="myt-actions"><Button size="sm" onClick={() => void copyPlan()}>Copy plan text</Button></div>
        <p role="status">{copyStatus}</p>
        {showCopyFallback ? (
          <label className="myt-field__label">
            Select and copy this plan text
            <textarea ref={fallbackRef} readOnly className="myt-input myt-input--textarea" rows={9} value={summary.copyText} style={{ width: "100%", boxSizing: "border-box" }} />
          </label>
        ) : null}
      </Panel>
    </div>
  );
}
