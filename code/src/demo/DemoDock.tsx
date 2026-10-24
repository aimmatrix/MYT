import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MytViewModel } from "../data-contract";
import type { AppMode, Attendance, CurrentUser, InterestRecord, Loadable, Route } from "../types";
import { ctx as host, filePort } from "../host";
import { Button, Switch } from "../components/ui";
import { areFriends, dmId, groupMembers } from "../domain/social";
import { planIdForActivity } from "../domain/identifiers";
import { getFutureTimeOptions, parseInstant } from "../domain/londonTime";
import { createDemoPartner, type DemoOutcome } from "./partner";
import { createDemoCast } from "./cast";
import { useDemoMode } from "./demoMode";
import { DEMO_CAST, DEMO_IDS, DEMO_PARTNER_ID, DEMO_PARTNER_NAME } from "./identity";

/*
 * Demo mode dock: a small floating panel that lets a solo presenter make the simulated participant
 * act. Every button writes real shared files as Alex; the app's file watches pick the change up, so
 * the screens update exactly as they would for a second person. Never rendered in Preview.
 */

export interface DemoDockProps {
  mode: AppMode;
  route: Route;
  currentUser: CurrentUser | null;
  vm: MytViewModel;
  interests: Loadable<Record<string, InterestRecord[]>>;
  attendance: Loadable<Record<string, Attendance[]>>;
  navigate: (route: Route) => void;
}

export function DemoDock(props: DemoDockProps) {
  const [on] = useDemoMode();
  if (props.mode !== "live" || !on || props.route.name === "welcome") return null;
  return <DockBody {...props} />;
}

/** Toggle for the welcome screen's App tools row. */
export function DemoModeButton() {
  const [on, setOn] = useDemoMode();
  return (
    <Button size="sm" aria-pressed={on} title="Adds a simulated second participant, Alex (demo)" onClick={() => setOn(!on)}>
      {on ? "Demo mode: on" : "Demo mode"}
    </Button>
  );
}

/** Switch for the Setup screen. */
export function DemoModeSwitch() {
  const [on, setOn] = useDemoMode();
  return (
    <div className="myt-stack myt-stack--sm">
      <Switch label="Demo mode" checked={on} onChange={setOn} />
      <p className="myt-muted myt-small">
        For presenting alone. Adds {DEMO_PARTNER_NAME}, a simulated second participant who joins, votes, goes, befriends and chats
        through the shared files. A Demo panel appears on each screen. It can also add demo students to swipe on in Meet. Use Reset demo there to remove all of them.
      </p>
    </div>
  );
}

type Result = { ok: boolean; text: string } | null;

function routeKey(route: Route): string {
  if (route.name === "activity" || route.name === "confirm") return `${route.name}:${route.activityId}`;
  if (route.name === "plan") return `plan:${route.planId}`;
  if (route.name === "chat") return `chat:${route.chatId}`;
  return route.name;
}

function latestStatus<T extends { userId: string }>(records: readonly T[], time: (r: T) => string, userId: string): T | undefined {
  let best: T | undefined;
  for (const r of records) {
    if (r.userId !== userId) continue;
    if (!best || (parseInstant(time(r)) ?? 0) > (parseInstant(time(best)) ?? 0)) best = r;
  }
  return best;
}

function DockBody({ route, currentUser, vm, interests, attendance, navigate }: DemoDockProps) {
  const meId = currentUser?.id ?? null;
  const partner = useMemo(
    () => createDemoPartner({ files: filePort, remove: (path) => host.files.delete(path), meId }),
    [meId],
  );
  const cast = useMemo(() => createDemoCast(filePort, meId), [meId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const key = routeKey(route);
  useEffect(() => { setResult(null); setConfirmReset(false); }, [key]);

  const run = async (name: string, action: () => Promise<DemoOutcome>) => {
    if (busy) return;
    setBusy(name);
    setResult(null);
    try {
      const outcome = await action();
      if (mounted.current) setResult({ ok: outcome.ok, text: outcome.message });
    } catch {
      if (mounted.current) setResult({ ok: false, text: "Not saved. Try again." });
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  const act = (name: string, label: ReactNode, action: () => Promise<DemoOutcome>, options: { disabled?: boolean; primary?: boolean } = {}) => (
    <Button
      key={name}
      size="sm"
      variant={options.primary ? "primary" : "secondary"}
      disabled={options.disabled || (busy !== null && busy !== name)}
      pending={busy === name}
      onClick={() => void run(name, action)}
    >
      {label}
    </Button>
  );

  // ------------------------------------------------------------ derived state
  const profiles = vm.realProfiles.state === "ready" ? vm.realProfiles.value : {};
  const alexReady = Object.hasOwn(profiles, DEMO_PARTNER_ID);
  const interestsOf = (activityId: string) =>
    interests.state === "ready" && Object.hasOwn(interests.value, activityId) ? interests.value[activityId] : [];
  const membersOf = (activityId: string) => groupMembers(activityId, interestsOf(activityId));
  const planFor = (activityId: string) => {
    if (vm.plansById.state !== "ready") return null;
    try {
      const id = planIdForActivity(activityId);
      return Object.hasOwn(vm.plansById.value, id) ? vm.plansById.value[id] : null;
    } catch {
      return null;
    }
  };
  const social = vm.social?.state === "ready" ? vm.social.value : null;
  const friends = !!(meId && social && areFriends(meId, DEMO_PARTNER_ID, social.requests, social.responses));
  const alexAsked = !!(meId && social?.requests.some((r) => r.fromId === DEMO_PARTNER_ID && r.toId === meId && r.status === "pending"));
  const iAsked = !!(meId && social?.requests.some((r) => r.fromId === meId && r.toId === DEMO_PARTNER_ID && r.status === "pending"));
  const castMissing = DEMO_CAST.filter((m) => !Object.hasOwn(profiles, m.id)).length;
  const castAwaiting = meId && social
    ? DEMO_CAST.filter((m) => !areFriends(meId, m.id, social.requests, social.responses)
      && social.requests.some((r) => r.fromId === meId && r.toId === m.id && r.status === "pending")).length
    : 0;
  const castFree = meId && social
    ? DEMO_CAST.some((m) => !social.requests.some((r) => (r.fromId === m.id && r.toId === meId) || (r.fromId === meId && r.toId === m.id)))
    : false;
  let alexDm: string | null = null;
  try { alexDm = meId ? dmId(meId, DEMO_PARTNER_ID) : null; } catch { alexDm = null; }

  const addAlex = !alexReady
    ? act("profile", "Add Alex to MYT", () => partner.ensureProfile(), { primary: true })
    : null;

  // ------------------------------------------------------------ route sections
  let section: ReactNode;
  if (!meId) {
    section = <p className="myt-small">Sign in to use Demo mode. Alex needs a real account to interact with.</p>;
  } else {
    /** What confirming still needs, with the fixes Demo mode can offer. Shared by activity and confirm. */
    const readiness = (id: string, onConfirmScreen: boolean, joinPrimary: boolean) => {
      const members = membersOf(id);
      const organiser = vm.session.state === "ready" ? vm.session.value.organiserUserId : null;
      const activity = vm.activities.state === "ready" ? vm.activities.value.items.find((a) => a.id === id) : undefined;
      const hasFuture = activity ? getFutureTimeOptions(activity.timeOptions, Date.now()).length > 0 : false;
      const meJoined = members.includes(meId);
      const alexJoined = members.includes(DEMO_PARTNER_ID);
      const claim = vm.actions;
      const ready = organiser === meId && meJoined && alexJoined && hasFuture;
      return (
        <>
          <p className="myt-small myt-strong">{ready ? "Ready to confirm" : "To confirm a plan"}</p>
          <ul className="myt-demo-dock__checks">
            <li data-done={organiser === meId}>
              {organiser === meId ? "You are the organiser" : organiser ? "Someone else is the organiser" : "You're not the organiser yet"}
            </li>
            <li data-done={meJoined}>{meJoined ? "You have joined" : onConfirmScreen ? "You haven't joined. Go back and choose I'd go." : "You haven't joined yet"}</li>
            <li data-done={alexJoined}>{alexJoined ? "Alex has joined" : "Alex hasn't joined"}</li>
            <li data-done={hasFuture}>{hasFuture ? "A future time is available" : "No future time is available"}</li>
          </ul>
          <div className="myt-demo-dock__actions">
            {organiser === null && claim
              ? act("claim", "Make me the organiser", async () => {
                  const r = await claim.claimOrganiser({ replace: false });
                  return r.ok ? { ok: true, message: "You are the organiser now." } : { ok: false, message: r.error.message };
                }, { primary: !joinPrimary })
              : null}
            {organiser !== null && organiser !== meId ? <Button size="sm" onClick={() => navigate({ name: "setup" })}>Open Setup</Button> : null}
            {onConfirmScreen && !alexJoined ? act("join", "Alex joins", () => partner.join(id), { primary: joinPrimary || organiser === meId }) : null}
            {onConfirmScreen && !meJoined ? <Button size="sm" onClick={() => navigate({ name: "activity", activityId: id })}>Back to the activity</Button> : null}
          </div>
          {ready ? <p className="myt-small">{onConfirmScreen ? "Choose a time and a meeting point, then Confirm plan." : "Use Review and confirm the plan on this screen."}</p> : null}
        </>
      );
    };
    const planNote = (planId: string) => (
      <>
        <p className="myt-small">This activity has a confirmed plan, so nobody can join or vote now.</p>
        <div className="myt-demo-dock__actions">
          <Button size="sm" onClick={() => navigate({ name: "plan", planId })}>Open the plan</Button>
        </div>
      </>
    );
    switch (route.name) {
      case "activity": {
        const id = route.activityId;
        const plan = planFor(id);
        const joined = membersOf(id).includes(DEMO_PARTNER_ID);
        const votes = vm.votesByActivity.state === "ready" && Object.hasOwn(vm.votesByActivity.value, id) ? vm.votesByActivity.value[id] : [];
        const voted = !!latestStatus(votes, (v) => v.updatedAt, DEMO_PARTNER_ID)?.optionId;
        section = plan ? planNote(plan.id) : joined ? (
          <>
            <p className="myt-small">Alex has joined. {voted ? "Alex has voted." : "Alex has not voted yet."}</p>
            <div className="myt-demo-dock__actions">
              {act("vote", voted ? "Alex votes again" : "Alex votes for a time", () => partner.voteForTime(id), { primary: !voted })}
            </div>
            {readiness(id, false, false)}
          </>
        ) : (
          <>
            <p className="myt-small">Alex has not joined yet. Alex must join before voting.</p>
            <div className="myt-demo-dock__actions">
              {act("join", "Alex joins", () => partner.join(id), { primary: true })}
              {act("vote", "Alex votes for a time", () => partner.voteForTime(id), { disabled: true })}
            </div>
            {readiness(id, false, false)}
          </>
        );
        break;
      }
      case "confirm": {
        const plan = planFor(route.activityId);
        section = plan ? planNote(plan.id) : readiness(route.activityId, true, false);
        break;
      }
      case "plan": {
        const id = route.planId;
        const records = attendance.state === "ready" && Object.hasOwn(attendance.value, id) ? attendance.value[id] : [];
        const going = latestStatus(records, (r) => r.updatedAt, DEMO_PARTNER_ID)?.status === "going";
        const plan = vm.plansById.state === "ready" && Object.hasOwn(vm.plansById.value, id) ? vm.plansById.value[id] : null;
        section = (
          <>
            <p className="myt-small">{going ? "Alex is going." : "Alex has not said they are going."}</p>
            <div className="myt-demo-dock__actions">
              {act("going", going ? "Alex is going ✓" : "Alex is going", () => partner.markGoing(id), { disabled: going || !plan, primary: !going })}
            </div>
          </>
        );
        break;
      }
      case "meet":
      case "requests":
        {
          const incoming = !!(meId && social?.requests.some((r) => r.toId === meId && r.status === "pending" && DEMO_IDS.includes(r.fromId)
            && !areFriends(meId, r.fromId, social.requests, social.responses)
            && !social.responses.some((t) => t.fromId === r.fromId && t.toId === meId && t.respondedAt >= r.createdAt)));
          const awaiting = castAwaiting + (iAsked && !friends ? 1 : 0);
          section = !alexReady || castMissing ? (
            <>
              <p className="myt-small">Add Alex and {DEMO_CAST.length} demo students so you have people to swipe on.</p>
              <div className="myt-demo-dock__actions">
                {act("cast-add", "Add demo people", async () => {
                  const alex = await partner.ensureProfile();
                  if (!alex.ok) return alex;
                  return cast.addAll();
                }, { primary: true })}
              </div>
            </>
          ) : (
            <>
              <p className="myt-small">
                {awaiting ? `${awaiting} demo ${awaiting === 1 ? "person is" : "people are"} waiting on your request.` : "Swipe right to send a request, left to pass."}
              </p>
              <div className="myt-demo-dock__actions">
                {act("cast-accept", "They accept your requests", async () => {
                  const results: DemoOutcome[] = [];
                  if (iAsked && !friends) results.push(await partner.acceptRequest());
                  if (castAwaiting > 0) results.push(await cast.acceptPending());
                  const failed = results.find((r) => !r.ok);
                  return failed ?? { ok: true, message: results.map((r) => r.message).join(" ") };
                }, { disabled: awaiting === 0, primary: awaiting > 0 })}
                {act("cast-request", "Someone sends you a request", () =>
                  !friends && !alexAsked && !iAsked ? partner.sendRequest() : cast.sendOneRequest(),
                { disabled: (friends || alexAsked || iAsked) && !castFree })}
                {route.name === "meet" && incoming ? <Button size="sm" onClick={() => navigate({ name: "requests" })}>Open Requests</Button> : null}
              </div>
            </>
          );
        }
        break;
      case "chat": {
        const chatId = route.chatId;
        const group = chatId.startsWith("group:");
        const activityId = group ? chatId.slice(6) : null;
        const member = activityId ? membersOf(activityId).includes(DEMO_PARTNER_ID) : chatId === alexDm && friends;
        const hasPoll = !!social?.messages.some((m) => m.chatId === chatId && m.kind === "poll");
        const castMember = !group && chatId !== alexDm ? cast.memberInDm(chatId) : null;
        if (castMember) {
          const name = castMember.name.replace(" (demo)", "");
          section = (
            <div className="myt-demo-dock__actions">
              {act("cast-reply", `${name} replies`, () => cast.replyInDm(chatId), { primary: true })}
            </div>
          );
        } else if (!group && chatId !== alexDm) {
          section = <p className="myt-small">This direct chat is with someone else, so Alex can't post here.</p>;
        } else {
          section = (
            <>
              {!member ? <p className="myt-small">{group ? "Alex is not in this group yet." : "Alex can post here once you are friends."}</p> : null}
              <div className="myt-demo-dock__actions">
                {group && !member && activityId && !planFor(activityId) ? act("join", "Alex joins this activity", () => partner.join(activityId), { primary: true }) : null}
                {act("reply", "Alex replies", () => partner.reply(chatId), { disabled: !member, primary: member })}
                {act("poll", "Alex votes in the latest poll", () => partner.voteInLatestPoll(chatId), { disabled: !member || !hasPoll })}
              </div>
              {member && !hasPoll ? <p className="myt-muted myt-small">Post a poll with + to let Alex vote.</p> : null}
            </>
          );
        }
        break;
      }
      case "chats":
        section = (
          <>
            <p className="myt-small">Alex chats in the group of any activity they joined, and in a direct chat once you are friends.</p>
            <div className="myt-demo-dock__actions">
              {addAlex}
              {friends && alexDm ? <Button size="sm" onClick={() => navigate({ name: "chat", chatId: alexDm! })}>Open chat with Alex</Button> : null}
              {!friends ? <Button size="sm" onClick={() => navigate({ name: "meet" })}>Befriend Alex in Meet</Button> : null}
            </div>
          </>
        );
        break;
      default:
        section = (
          <>
            <p className="myt-small">Open an activity to have Alex join it and vote, or open Meet to befriend Alex.</p>
            {addAlex ? <div className="myt-demo-dock__actions">{addAlex}</div> : null}
          </>
        );
    }
  }

  return (
    <aside className="myt-demo-dock" aria-label="Demo controls, simulated participant" data-collapsed={collapsed || undefined} data-placement={route.name === "chat" ? "top" : undefined}>
      <div className="myt-demo-dock__head">
        <span className="myt-demo-dock__badge">Demo</span>
        <strong className="myt-demo-dock__title">Simulated: {DEMO_PARTNER_NAME}</strong>
        <Button size="sm" variant="quiet" aria-expanded={!collapsed} aria-label={collapsed ? "Show demo controls" : "Hide demo controls"} onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "Show" : "Hide"}
        </Button>
      </div>
      {collapsed ? null : (
        <div className="myt-demo-dock__body">
          {section}
          {result ? (
            <p className="myt-demo-dock__result" data-tone={result.ok ? "ok" : "danger"} role={result.ok ? "status" : "alert"}>{result.text}</p>
          ) : null}
          <div className="myt-demo-dock__foot">
            {confirmReset ? (
              <>
                <span className="myt-small">Remove Alex, the demo students and everything they did? Plans stay.</span>
                <div className="myt-demo-dock__actions">
                  {act("reset", "Yes, reset demo", async () => { const r = await partner.reset(); setConfirmReset(false); return r; }, { disabled: !meId })}
                  <Button size="sm" variant="quiet" disabled={busy === "reset"} onClick={() => setConfirmReset(false)}>Cancel</Button>
                </div>
              </>
            ) : (
              <Button size="sm" variant="quiet" disabled={!meId || busy !== null} onClick={() => setConfirmReset(true)}>Reset demo</Button>
            )}
            <span className="myt-muted myt-small">Alex is simulated on this device. Their actions are saved as real shared files.</span>
          </div>
        </div>
      )}
    </aside>
  );
}
