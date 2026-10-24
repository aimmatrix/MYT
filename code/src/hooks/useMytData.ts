import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MytActions, MytViewModel, ReadResult, UseMytDataInput } from "../data-contract";
import type { ActionResult, CreatePlanResult, Loadable, RecordIssue } from "../types";
import {
  ACTIVITIES_PATH, ATTENDANCE_DIR, INTERESTS_DIR, PLANS_DIR, PROFILES_DIR,
  SAMPLE_PROFILES_PATH, SESSION_PATH, VOTES_DIR, attendanceFolderPath,
  interestFolderPath, profilePath, voteFolderPath,
} from "../paths";

const loading = <T,>(): Loadable<T> => ({ state: "loading" });
const emptyIssues: RecordIssue[] = [];
const ready = <T,>(value: T): Loadable<T> => ({ state: "ready", value, issues: emptyIssues });
const unavailable = { code: "preview", message: "Preview is read-only." } as const;

type Slices = Pick<MytViewModel,
  "social" | "activities" | "samples" | "session" | "myProfile" | "realProfiles" |
  "interestsByActivity" | "votesByActivity" | "plansById" | "attendanceByPlan">;

function initialSlices(): Slices {
  return {
    social: loading(), activities: loading(), samples: loading(), session: loading(), myProfile: loading(),
    realProfiles: loading(), interestsByActivity: loading(), votesByActivity: loading(),
    plansById: loading(), attendanceByPlan: loading(),
  };
}

function asLoadable<T>(result: ReadResult<T>): Loadable<T> {
  return result.ok
    ? { state: "ready", value: result.value.value, issues: result.value.issues }
    : { state: "error", error: result.error };
}

function ioError(): { ok: false; error: { code: "io"; message: string } } {
  return { ok: false, error: { code: "io", message: "Could not save. Please try again." } };
}

export function useMytData(input: UseMytDataInput): MytViewModel {
  const { repository, files, mode, currentUser, activityId, planId, socialRepository } = input;
  const userId = currentUser?.id ?? null;
  const [slices, setSlices] = useState<Slices>(initialSlices);
  const generation = useRef(0);
  const latest = useRef({ mode, userId, activityId, planId, repository, files });
  latest.current = { mode, userId, activityId, planId, repository, files };
  const refreshers = useRef<Record<string, () => void>>({});
  const pending = useRef(new Set<string>());

  useEffect(() => {
    const ticket = ++generation.current;
    setSlices(initialSlices());
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const revisions = new Map<keyof Slices, number>();
    const live = () => generation.current === ticket;
    const load = <T,>(key: keyof Slices, read: () => Promise<ReadResult<T>>, wrap: (value: Loadable<T>) => Loadable<unknown>) => {
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      void read().then(result => {
        if (live() && revisions.get(key) === revision) setSlices(previous => ({ ...previous, [key]: wrap(asLoadable(result)) }));
      }).catch(() => {
        if (live() && revisions.get(key) === revision) setSlices(previous => ({ ...previous, [key]: { state: "error", error: { code: "io", message: "Could not load shared data." } } }));
      });
    };
    const reload: Record<string, () => void> = {
      social: () => { if (socialRepository) load("social", () => socialRepository.load(), value => value); },
      activities: () => load("activities", () => repository.loadActivities(), value => value),
      samples: () => load("samples", () => repository.loadSamples(), value => value),
      session: () => load("session", () => repository.loadSession(), value => value),
      profiles: () => load("realProfiles", () => repository.loadRealProfiles(), value => value),
      plans: () => load("plansById", () => repository.loadPlans(), value => value),
    };
    reload.profile = userId && mode === "live"
      ? () => load("myProfile", () => repository.loadMyProfile(), value => value)
      : () => setSlices(previous => ({ ...previous, myProfile: ready(null) }));
    reload.interests = activityId
      ? () => load("interestsByActivity", () => repository.loadInterests(activityId), value =>
          value.state === "ready" ? { state: "ready", value: { [activityId]: value.value }, issues: value.issues } : value)
      : () => setSlices(previous => ({ ...previous, interestsByActivity: ready({}) }));
    reload.votes = activityId
      ? () => load("votesByActivity", () => repository.loadVotes(activityId), value =>
          value.state === "ready" ? { state: "ready", value: { [activityId]: value.value }, issues: value.issues } : value)
      : () => setSlices(previous => ({ ...previous, votesByActivity: ready({}) }));
    reload.attendance = planId
      ? () => load("attendanceByPlan", () => repository.loadAttendance(planId), value =>
          value.state === "ready" ? { state: "ready", value: { [planId]: value.value }, issues: value.issues } : value)
      : () => setSlices(previous => ({ ...previous, attendanceByPlan: ready({}) }));
    refreshers.current = reload;
    Object.values(reload).forEach(refresh => refresh());

    function schedule(key: string) {
      if (!live()) return;
      const prior = timers.get(key);
      if (prior) clearTimeout(prior);
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        if (live()) reload[key]?.();
      }, 150));
    }

    let unwatch: (() => void) | undefined;
    try {
      unwatch = files.watch("data", change => {
        const path = change.path;
        if (/^data\/(friends|chats|blocks|meet|interests|profiles)(\/|$)/.test(path)) schedule("social");
        if (path === ACTIVITIES_PATH) schedule("activities");
        else if (path === SAMPLE_PROFILES_PATH) schedule("samples");
        else if (path === SESSION_PATH) schedule("session");
        else if (path.startsWith(PROFILES_DIR + "/")) {
          schedule("profiles");
          if (userId) {
            try { if (path === profilePath(userId)) schedule("profile"); } catch { /* invalid identity is handled by repository */ }
          }
        } else if (activityId && (path === interestFolderPath(activityId) || path.startsWith(interestFolderPath(activityId) + "/"))) schedule("interests");
        else if (activityId && (path === voteFolderPath(activityId) || path.startsWith(voteFolderPath(activityId) + "/"))) schedule("votes");
        else if (path === PLANS_DIR || path.startsWith(PLANS_DIR + "/")) schedule("plans");
        else if (planId && (path === attendanceFolderPath(planId) || path.startsWith(attendanceFolderPath(planId) + "/"))) schedule("attendance");
        else if (path === INTERESTS_DIR && activityId) schedule("interests");
        else if (path === VOTES_DIR && activityId) schedule("votes");
        else if (path === ATTENDANCE_DIR && planId) schedule("attendance");
      });
    } catch {
      if (live()) setSlices(previous => ({
        ...previous,
        plansById: { state: "error", error: { code: "io", message: "Could not watch shared data. Reopen to refresh." } },
      }));
    }
    return () => {
      generation.current++;
      unwatch?.();
      timers.forEach(timer => clearTimeout(timer));
      refreshers.current = {};
    };
  }, [repository, files, mode, userId, activityId, planId, socialRepository]);

  const run = useCallback(async <T extends ActionResult<unknown> | CreatePlanResult>(
    key: string, write: () => Promise<T>, reloadKeys: string[],
  ): Promise<T | { ok: false; error: { code: "preview" | "not-signed-in" | "not-allowed" | "io"; message: string } }> => {
    if (latest.current.mode !== "live") return { ok: false, error: unavailable };
    if (!latest.current.userId) return { ok: false, error: { code: "not-signed-in", message: "Sign in to save." } };
    if (pending.current.has(key)) return { ok: false, error: { code: "not-allowed", message: "This action is already saving." } };
    pending.current.add(key);
    try {
      const result = await write();
      if (result.ok) reloadKeys.forEach(item => refreshers.current[item]?.());
      return result;
    } catch {
      return ioError();
    } finally {
      pending.current.delete(key);
    }
  }, []);

  const actions = useMemo<MytActions | null>(() => {
    if (mode !== "live" || !userId) return null;
    return {
      saveProfile: value => run("profile", () => repository.saveProfile(value), ["profile", "profiles"]),
      setInterest: (id, status) => run("interest:" + id, () => repository.setInterest(id, status), ["interests"]),
      setVote: (id, optionId) => run("vote:" + id, () => repository.setVote(id, optionId), ["votes"]),
      claimOrganiser: value => run("session", () => repository.claimOrganiser(value), ["session"]),
      confirmPlan: value => run("plan:" + value.activityId, () => repository.confirmPlan(value), ["plans"]),
      setAttendance: (id, status) => run("attendance:" + id, () => repository.setAttendance(id, status), ["attendance"]),
    };
  }, [mode, userId, repository, run]);

  const socialActions = useMemo(() => {
    if (!socialRepository || mode !== "live" || !userId) return null;
    return {
      load: () => socialRepository.load(),
      request: (...args: Parameters<typeof socialRepository.request>) => run("social-request", () => socialRepository.request(...args), ["social"]),
      respond: (...args: Parameters<typeof socialRepository.respond>) => run("social-respond", () => socialRepository.respond(...args), ["social"]),
      pass: (...args: Parameters<typeof socialRepository.pass>) => run("social-pass", () => socialRepository.pass(...args), ["social"]),
      block: (...args: Parameters<typeof socialRepository.block>) => run("social-block", () => socialRepository.block(...args), ["social"]),
      post: (...args: Parameters<typeof socialRepository.post>) => run("social-post", () => socialRepository.post(...args), ["social"]),
      read: (...args: Parameters<typeof socialRepository.read>) => run("social-read", () => socialRepository.read(...args), ["social"]),
      vote: (...args: Parameters<typeof socialRepository.vote>) => run("social-vote", () => socialRepository.vote(...args), ["social"]),
    };
  }, [socialRepository, mode, userId, run]);
  const issues = Object.values(slices).flatMap(slice => slice && slice.state === "ready" ? slice.issues : []);
  return { mode, currentUser, ...slices, issues, actions, socialActions };
}
