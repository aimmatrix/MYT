import { useEffect, useState } from "react";
import type { MytFilePort, MytRepository, ReadResult } from "../data-contract";
import { keyForId } from "../domain/identifiers";
import { ATTENDANCE_DIR, INTERESTS_DIR } from "../paths";
import type { Attendance, InterestRecord, Loadable, MytError, RecordIssue } from "../types";

/*
 * S1 wiring. G3's useMytData loads interests only for the route's activity and attendance only
 * for the route's plan, which cannot feed the Discover counts or the My plans list. This hook
 * loads both for every activity and plan through G2's repository, and refreshes on changes
 * under data/interests and data/attendance. It never writes.
 */

export interface Participation {
  interests: Loadable<Record<string, InterestRecord[]>>;
  attendance: Loadable<Record<string, Attendance[]>>;
}

const EMPTY_ISSUES: RecordIssue[] = [];

function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function ready<T>(value: T, issues: RecordIssue[] = EMPTY_ISSUES): Loadable<T> {
  return { state: "ready", value, issues };
}

/**
 * Folder names present under `dir`, or null when it cannot be listed (missing or unreadable).
 * Null means "do not skip anything": the repository then decides missing versus failed itself.
 */
async function folderNames(files: MytFilePort, dir: string): Promise<ReadonlySet<string> | null> {
  try {
    return new Set((await files.list(dir)).filter((entry) => entry.kind === "folder").map((entry) => entry.name));
  } catch {
    // Before anyone joins, `dir` does not exist yet. Confirm that from its parent so a fresh
    // catalog does not cost one or more listings per activity on every refresh.
    const slash = dir.lastIndexOf("/");
    if (slash <= 0) return null;
    try {
      const name = dir.slice(slash + 1);
      const siblings = await files.list(dir.slice(0, slash));
      return siblings.some((entry) => entry.name === name) ? null : new Set();
    } catch {
      return null;
    }
  }
}

function safeKey(id: string): string | null {
  try {
    return keyForId(id);
  } catch {
    return null;
  }
}

async function loadAll<T>(
  ids: readonly string[],
  load: (id: string) => Promise<ReadResult<T[]>>,
  present: ReadonlySet<string> | null,
): Promise<Loadable<Record<string, T[]>>> {
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        // With 100+ activities, most have no participant folder yet. One listing replaces
        // several file calls per activity; a missing folder is simply an empty list.
        const key = present === null ? null : safeKey(id);
        if (present !== null && key !== null && !present.has(key)) {
          return { id, result: { ok: true, value: { value: [], issues: [] } } as ReadResult<T[]> };
        }
        return { id, result: await load(id) };
      } catch {
        const error: MytError = { code: "io", message: "Could not load shared data." };
        return { id, result: { ok: false, error } as const };
      }
    }),
  );
  const map = emptyMap<T[]>();
  const issues: RecordIssue[] = [];
  for (const { id, result } of results) {
    if (!result.ok) return { state: "error", error: result.error };
    map[id] = result.value.value;
    issues.push(...result.value.issues);
  }
  return ready(map, issues);
}

export function useParticipation(input: {
  repository: MytRepository;
  files: MytFilePort;
  enabled: boolean;
  activityIds: readonly string[] | null;
  planIds: readonly string[] | null;
}): Participation {
  const { repository, files, enabled, activityIds, planIds } = input;
  const [interests, setInterests] = useState<Loadable<Record<string, InterestRecord[]>>>({ state: "loading" });
  const [attendance, setAttendance] = useState<Loadable<Record<string, Attendance[]>>>({ state: "loading" });
  const activityKey = activityIds === null ? null : activityIds.join("\n");
  const planKey = planIds === null ? null : planIds.join("\n");

  useEffect(() => {
    if (!enabled) {
      setInterests(ready(emptyMap()));
      setAttendance(ready(emptyMap()));
      return;
    }
    if (activityKey === null) setInterests({ state: "loading" });
    if (planKey === null) setAttendance({ state: "loading" });

    let alive = true;
    let interestsRevision = 0;
    let attendanceRevision = 0;
    const activities = activityKey === null ? null : activityKey === "" ? [] : activityKey.split("\n");
    const plans = planKey === null ? null : planKey === "" ? [] : planKey.split("\n");

    const refresh = (which: "interests" | "attendance" | "both") => {
      if (activities !== null && which !== "attendance") {
        const ticket = ++interestsRevision;
        void folderNames(files, INTERESTS_DIR)
          .then((present) => loadAll(activities, (id) => repository.loadInterests(id), present))
          .then((value) => {
            if (alive && ticket === interestsRevision) setInterests(value);
          });
      }
      if (plans !== null && which !== "interests") {
        const ticket = ++attendanceRevision;
        void folderNames(files, ATTENDANCE_DIR)
          .then((present) => loadAll(plans, (id) => repository.loadAttendance(id), present))
          .then((value) => {
            if (alive && ticket === attendanceRevision) setAttendance(value);
          });
      }
    };
    refresh("both");

    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: "interests" | "attendance" | "both" | null = null;
    const unwatch = files.watch("data", (change) => {
      const touchesInterests = change.path === INTERESTS_DIR || change.path.startsWith(INTERESTS_DIR + "/");
      const touchesAttendance = change.path === ATTENDANCE_DIR || change.path.startsWith(ATTENDANCE_DIR + "/");
      if (!touchesInterests && !touchesAttendance) return;
      const next = touchesInterests ? "interests" : "attendance";
      pending = pending === null || pending === next ? next : "both";
      clearTimeout(timer);
      timer = setTimeout(() => {
        const which = pending ?? "both";
        pending = null;
        refresh(which);
      }, 150);
    });

    return () => {
      alive = false;
      clearTimeout(timer);
      unwatch();
    };
  }, [repository, files, enabled, activityKey, planKey]);

  return { interests, attendance };
}
