import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ctx, filePort, toCurrentUser, useConnected, useCurrentUser, usePeers, useSetPresence, utf8ByteLength } from "./host";
import { idFromKey, isValidId, keyForId, planIdForActivity } from "./domain/identifiers";
import { parseInstant } from "./domain/londonTime";
import { decodeRecord } from "./domain/validation";
import { selectGoingUserIds, selectInterestedUserIds } from "./domain/participantSelectors";
import { calculateTimeConsensus } from "./domain/timeConsensus";
import { evaluateAttendance, evaluatePlanCreation } from "./domain/planRules";
import { ACTIVITIES_PATH, SAMPLE_PROFILES_PATH, SESSION_PATH, attendancePath, interestPath, planPathForActivity, votePath } from "./paths";

/*
 * MILESTONE 0 PROOF GATE (S1). Not the real app.
 * Proves: one rendered card, one saved action, a watcher-driven count, presence in room "myt-v1",
 * plus the platform probes listed in Planning/Architecture.md section 8.
 * Writes only under data/m0-probe/. T3's identifiers module is not integrated yet, so this file
 * uses a throwaway local key helper with the same "id-<hex>" format. It is replaced by App.tsx
 * (which will use paths.ts) once the two-account gate passes.
 */

const ROOM = "myt-v1";
const PROBE_ROOT = "data/m0-probe";
const FALLBACK_CARD = { id: "m0-probe", title: "Sunday five-a-side (M0 test card)", area: "Central London" };

type Presence = { v: 1; screen: string; activityId: string | null };

interface ProbeInterest {
  activityId: string;
  userId: string;
  status: "interested" | "withdrawn";
  updatedAt: string;
}

function localKey(id: string): string {
  const hex = Array.from(new TextEncoder().encode(id))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `id-${hex}`;
}

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function parseInterest(text: string, activityId: string): ProbeInterest | null {
  try {
    const v = JSON.parse(text) as Partial<ProbeInterest>;
    if (v.activityId !== activityId || typeof v.userId !== "string") return null;
    if (v.status !== "interested" && v.status !== "withdrawn") return null;
    return { activityId: v.activityId, userId: v.userId, status: v.status, updatedAt: String(v.updatedAt ?? "") };
  } catch {
    return null;
  }
}

function isPresence(value: unknown): value is Presence {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return p.v === 1 && typeof p.screen === "string" && (p.activityId === null || typeof p.activityId === "string");
}

const s: Record<string, CSSProperties> = {
  page: { maxWidth: 640, margin: "0 auto", padding: "var(--lf-gap-lg)", display: "grid", gap: "var(--lf-gap-lg)" },
  banner: {
    padding: "var(--lf-gap-sm) var(--lf-gap)",
    borderRadius: "var(--lf-radius)",
    background: "var(--lf-surface-inset)",
    color: "var(--lf-content-secondary)",
  },
  card: {
    padding: "var(--lf-gap-lg)",
    borderRadius: "var(--lf-radius-lg)",
    background: "var(--lf-surface-card)",
    boxShadow: "var(--lf-shadow)",
    display: "grid",
    gap: "var(--lf-gap)",
  },
  h: { margin: 0, fontSize: 18, fontWeight: 600 },
  muted: { color: "var(--lf-content-secondary)", margin: 0 },
  row: { display: "flex", gap: "var(--lf-gap-sm)", alignItems: "center", flexWrap: "wrap" },
  button: {
    height: 32,
    padding: "0 var(--lf-gap)",
    border: "1px solid var(--lf-border-subtle)",
    borderRadius: "var(--lf-radius)",
    background: "var(--lf-surface-card)",
    color: "var(--lf-content)",
    cursor: "pointer",
  },
  primary: {
    height: 32,
    padding: "0 var(--lf-gap)",
    border: "none",
    borderRadius: "var(--lf-radius)",
    background: "var(--lf-accent)",
    color: "var(--lf-surface)",
    cursor: "pointer",
  },
  pre: {
    margin: 0,
    padding: "var(--lf-gap-sm)",
    borderRadius: "var(--lf-radius)",
    background: "var(--lf-surface-inset)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 12,
  },
  danger: { color: "var(--lf-danger)", margin: 0 },
  ok: { color: "var(--lf-success)", margin: 0 },
};

function useProbeCard() {
  const [card, setCard] = useState(FALLBACK_CARD);
  const [source, setSource] = useState("hard-coded (data/activities.json not found)");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await filePort.list("data");
        if (!entries.some((e) => e.kind === "file" && e.name === "activities.json")) return;
        const parsed = JSON.parse(await filePort.readText("data/activities.json")) as {
          items?: Array<{ id?: unknown; title?: unknown; area?: unknown }>;
        };
        const first = parsed.items?.[0];
        if (!cancelled && first && typeof first.id === "string" && typeof first.title === "string") {
          setCard({ id: first.id, title: first.title, area: typeof first.area === "string" ? first.area : "London" });
          setSource("data/activities.json (first item)");
        }
      } catch (e) {
        if (!cancelled) setSource(`hard-coded (catalog unreadable: ${describeError(e)})`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { card, source };
}

function useInterests(activityId: string) {
  const [records, setRecords] = useState<ProbeInterest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    try {
      // "Missing" is decided by listing the parent, never by parsing an error string.
      const parent = await filePort.list(PROBE_ROOT);
      const folder = localKey(activityId);
      let next: ProbeInterest[] = [];
      if (parent.some((e) => e.kind === "folder" && e.name === folder)) {
        const files = (await filePort.list(`${PROBE_ROOT}/${folder}`)).filter((e) => e.kind === "file" && e.name.endsWith(".json"));
        const read = await Promise.all(
          files.map(async (f) => {
            try {
              return parseInterest(await filePort.readText(f.path), activityId);
            } catch {
              return null;
            }
          })
        );
        next = read.filter((r): r is ProbeInterest => r !== null);
      }
      if (gen === generation.current) {
        setRecords(next);
        setError(null);
      }
    } catch (e) {
      if (gen === generation.current) setError(describeError(e));
    }
  }, [activityId]);

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = filePort.watch(PROBE_ROOT, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 150);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [load]);

  return { records, error, reload: load };
}

function PresenceStrip({ activityId, selfId }: { activityId: string; selfId: string | null }) {
  const connected = useConnected(ROOM);
  const peers = usePeers<unknown>(ROOM);
  const setPresence = useSetPresence<Presence>(ROOM);

  useEffect(() => {
    setPresence({ v: 1, screen: "discover", activityId });
    return () => setPresence(null);
  }, [setPresence, activityId]);

  // Group by user.id so someone with two tabs shows once; drop my own other tabs.
  const viewers = useMemo(() => {
    const byUser = new Map<string, string>();
    for (const peer of peers) {
      if (!isPresence(peer.presence) || peer.presence.activityId !== activityId) continue;
      if (peer.user.id === selfId) continue;
      byUser.set(peer.user.id, peer.user.name ?? "Someone");
    }
    return Array.from(byUser, ([userId, name]) => ({ userId, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [peers, activityId, selfId]);

  return (
    <div style={{ display: "grid", gap: "var(--lf-gap-xs)" }}>
      <p style={connected ? s.ok : s.muted}>
        {connected ? "Live presence: connected" : "Live presence: not connected (offline, signed out, or not synced yet)"}
      </p>
      <p style={s.muted} data-testid="viewers">
        {viewers.length === 0
          ? connected
            ? "Nobody else is viewing this."
            : "Viewers unknown while not connected."
          : `Also viewing: ${viewers.map((v) => v.name).join(", ")}`}
      </p>
      <p style={s.muted}>
        Raw peer views: {peers.length}, distinct people viewing this card: {viewers.length}. Viewers are never counted as interested.
      </p>
    </div>
  );
}

function Diagnostics({ userId }: { userId: string | null }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = (line: string) => setLog((l) => [...l, line]);

  const probeMissingList = async () => {
    setBusy(true);
    const path = `${PROBE_ROOT}/does-not-exist-${Date.now()}`;
    try {
      const r = await ctx.files.list(path);
      add(`list(missing folder): RESOLVED with ${r.length} entries (does not reject)`);
    } catch (e) {
      add(`list(missing folder): REJECTED, ${describeError(e)}`);
    }
    setBusy(false);
  };

  const probeOverwrite = async () => {
    setBusy(true);
    const base = `${PROBE_ROOT}/diag/${localKey(userId ?? "anon")}-${Date.now()}`;
    const attempt = async (path: string, label: string) => {
      try {
        await ctx.files.write(path, JSON.stringify({ probe: label }), { overwrite: false });
        return `${label}: wrote`;
      } catch (e) {
        return `${label}: REJECTED, ${describeError(e)}`;
      }
    };
    add(`overwrite:false sequential, 1st: ${await attempt(`${base}-seq.json`, "write 1")}`);
    add(`overwrite:false sequential, 2nd on same path: ${await attempt(`${base}-seq.json`, "write 2")}`);
    const both = await Promise.all([attempt(`${base}-race.json`, "racer A"), attempt(`${base}-race.json`, "racer B")]);
    add(`overwrite:false concurrent on same path: ${both.join(" | ")}`);
    setBusy(false);
  };

  return (
    <section style={s.card}>
      <h2 style={s.h}>Platform probes (M0 gate)</h2>
      <p style={s.muted}>Record these results in Planning/Integration.md. Writes go only to data/m0-probe/.</p>
      <p style={s.pre} data-testid="identity">
        {userId
          ? `currentUser.id: ${userId}\nlength: ${userId.length} chars, ${utf8ByteLength(userId)} UTF-8 bytes (T3 limit: 120 bytes)\nkey length: ${localKey(userId).length} chars (limit 255)`
          : "Signed out: no user id. Writes are disabled."}
      </p>
      <div style={s.row}>
        <button style={s.button} disabled={busy} onClick={() => void probeMissingList()}>
          Probe: list a missing folder
        </button>
        <button style={s.button} disabled={busy || !userId} onClick={() => void probeOverwrite()}>
          Probe: overwrite false
        </button>
        <button style={s.button} disabled={log.length === 0} onClick={() => setLog([])}>
          Clear
        </button>
      </div>
      {log.length > 0 && <pre style={s.pre}>{log.join("\n")}</pre>}
    </section>
  );
}

/*
 * TEMPORARY integration self-check (S1). Proves the imported T1 to T5 modules and G1's paths.ts
 * compile and behave inside Lightfern's own build, against the real G6 seed files.
 * parseInstant is C2's real parser (domain/londonTime.ts).
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function runIntegrationChecks(userId: string | null): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, ok: boolean, detail = "") => out.push({ name, ok, detail });
  const guard = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (e) {
      check(name, false, `threw ${describeError(e)}`);
    }
  };
  const deps = { parseInstant, isValidId };
  const NOW = Date.parse("2026-10-24T12:00:00Z");

  await guard("T3 identifiers + G1 paths", () => {
    const id = userId ?? "user-1";
    check("keyForId/idFromKey round trip", idFromKey(keyForId(id)) === id, keyForId(id).slice(0, 12) + "…");
    check("planIdForActivity", planIdForActivity("a-b") === "plan:a-b");
    check("sample ids are valid ids", isValidId("sample:ada") && !isValidId("") && !isValidId("a\nb"));
    check("path builders", interestPath("act", id).startsWith("data/interests/id-") && votePath("act", id).startsWith("data/votes/id-") && attendancePath("plan:act", id).startsWith("data/attendance/id-") && planPathForActivity("act").startsWith("data/plans/id-"));
  });

  let firstActivity: { id: string; status: "available" | "unavailable"; timeOptions: Array<{ id: string; startAt: string; endAt: string | null }> } | null = null;
  await guard("T1 decode seed files", async () => {
    const catalog = decodeRecord("activityCatalog", await filePort.readText(ACTIVITIES_PATH), deps);
    check("activities.json decodes", catalog.ok, catalog.ok ? `${catalog.value.items.length} activities` : JSON.stringify(catalog.issues.slice(0, 3)));
    if (catalog.ok) {
      firstActivity = catalog.value.items[0] ?? null;
      check("suggestedMeetingPoint carried through (S1 patch)", catalog.value.items.every((a) => a.suggestedMeetingPoint === undefined || a.suggestedMeetingPoint === null || (typeof a.suggestedMeetingPoint === "string" && a.suggestedMeetingPoint.length > 0)));
      check("every activity id can make a plan id", catalog.value.items.every((a) => isValidId(a.id) && isValidId(`plan:${a.id}`)));
    }
    const samples = decodeRecord("sampleProfileCatalog", await filePort.readText(SAMPLE_PROFILES_PATH), deps);
    check("sample-profiles.json decodes", samples.ok, samples.ok ? `${samples.value.items.length} profiles` : JSON.stringify(samples.issues.slice(0, 3)));
    if (samples.ok) check("all samples sample:-prefixed and isDemo", samples.value.items.every((p) => p.userId.startsWith("sample:") && p.isDemo));
    const session = decodeRecord("session", await filePort.readText(SESSION_PATH), deps);
    check("session.json decodes", session.ok, session.ok ? `organiser: ${session.value.organiserUserId ?? "not set"}` : JSON.stringify(session.issues));
    const bad = decodeRecord("activityCatalog", JSON.stringify({ schemaVersion: 1, items: [{ schemaVersion: 1, id: "x" }] }), deps);
    check("corrupt catalog rejected, not treated as empty", !bad.ok && bad.code === "invalid-record");
    const notJson = decodeRecord("session", "{nope", deps);
    check("malformed JSON rejected", !notJson.ok && notJson.code === "invalid-json");
    const future = decodeRecord("session", JSON.stringify({ schemaVersion: 2, organiserUserId: null }), deps);
    check("unsupported schema rejected", !future.ok && future.code === "unsupported-schema");
  });

  await guard("T2 selectors", () => {
    const real = new Set(["u1", "u2"]);
    const recs = [
      { activityId: "a", userId: "u1", status: "interested" as const, updatedAt: "2026-10-24T10:00:00Z" },
      { activityId: "a", userId: "u2", status: "interested" as const, updatedAt: "2026-10-24T10:00:00Z" },
      { activityId: "a", userId: "u2", status: "withdrawn" as const, updatedAt: "2026-10-24T11:00:00Z" },
      { activityId: "a", userId: "sample:ada", status: "interested" as const, updatedAt: "2026-10-24T10:00:00Z" },
    ];
    const interested = selectInterestedUserIds(recs, "a", real, parseInstant);
    check("interested = real, latest wins, samples excluded", interested.length === 1 && interested[0] === "u1", interested.join(","));
    check("going never inferred from interest", selectGoingUserIds([], "plan:a", real, parseInstant).length === 0);
  });

  await guard("T4 consensus", () => {
    // Two fixed future options so a real tie is exercised (the first seed activity has only one).
    const options = [{ id: "o1", startAt: "2026-11-07T14:00:00Z", endAt: null }, { id: "o2", startAt: "2026-11-08T14:00:00Z", endAt: null }];
    const [o1, o2] = ["o1", "o2"];
    const activityId = "a";
    const votes = [
      { activityId, userId: "u1", optionId: o1, updatedAt: "2026-10-24T10:00:00Z" },
      { activityId, userId: "u2", optionId: o2, updatedAt: "2026-10-24T10:00:00Z" },
    ];
    const tie = calculateTimeConsensus({ activityId, options, votes, eligibleUserIds: new Set(["u1", "u2"]), nowMs: NOW }, parseInstant);
    check("tie is reported, not auto-picked", tie.suggestedOptionId === null && tie.tiedOptionIds.length === 2, JSON.stringify(tie.counts));
    const solo = calculateTimeConsensus({ activityId, options, votes, eligibleUserIds: new Set(["u1"]), nowMs: NOW }, parseInstant);
    check("only eligible voters count", solo.voterCount === 1);
  });

  await guard("T5 plan rules", () => {
    const options = [{ id: "kickoff", startAt: "2026-11-15T16:30:00Z", endAt: null }];
    const base = {
      currentUserId: "u1",
      organiserUserId: "u1",
      realUserIds: new Set(["u1", "u2"]),
      activityId: "arsenal-women-london-city-2026-11-15",
      activityStatus: "available" as const,
      existingPlanId: null,
      chosenOptionId: "kickoff",
      options,
      interestedUserIds: new Set(["u1", "u2"]),
      meetingPoint: "  Arsenal station main entrance ",
      nowMs: NOW,
    };
    const ok = evaluatePlanCreation(base, parseInstant);
    check("organiser + 2 real interested + future option + point is allowed", ok.allowed && ok.meetingPoint === "Arsenal station main entrance");
    const alone = evaluatePlanCreation({ ...base, interestedUserIds: new Set(["u1"]) }, parseInstant);
    check("one real person is denied", !alone.allowed && alone.code === "insufficient-real-interest");
    const sample = evaluatePlanCreation({ ...base, interestedUserIds: new Set(["u1", "sample:ada"]) }, parseInstant);
    check("sample profile does not make up the numbers", !sample.allowed && sample.code === "insufficient-real-interest");
    const guest = evaluatePlanCreation({ ...base, currentUserId: "u2" }, parseInstant);
    check("non-organiser denied", !guest.allowed && guest.code === "not-organiser");
    const going = evaluateAttendance({ currentUserId: "u2", realUserIds: base.realUserIds, planExists: true, planStartMs: Date.parse("2026-11-15T16:30:00Z"), nowMs: NOW, desiredStatus: "going" });
    check("attendance going on future plan allowed", going.allowed);
  });

  return out;
}

function IntegrationCheck({ userId }: { userId: string | null }) {
  const [results, setResults] = useState<Check[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void runIntegrationChecks(userId).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const failed = results?.filter((c) => !c.ok).length ?? 0;
  return (
    <section style={s.card}>
      <h2 style={s.h}>Integration self-check (T1 to T5, paths.ts)</h2>
      <p style={s.muted}>
        Runs inside Lightfern's own build against the real seed files. Dates are parsed with C2's londonTime.
      </p>
      {results === null ? (
        <p style={s.muted}>Running…</p>
      ) : (
        <>
          <p data-testid="selfcheck-summary" style={failed === 0 ? s.ok : s.danger}>
            {results.length - failed} of {results.length} passed
          </p>
          <pre style={s.pre}>{results.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  [${c.detail}]` : ""}`).join("\n")}</pre>
        </>
      )}
    </section>
  );
}

function Probe() {
  const user = toCurrentUser(useCurrentUser());
  const { card, source } = useProbeCard();
  const { records, error, reload } = useInterests(card.id);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const interestedIds = useMemo(
    () => new Set((records ?? []).filter((r) => r.status === "interested").map((r) => r.userId)),
    [records]
  );
  const mine = user ? records?.find((r) => r.userId === user.id)?.status ?? null : null;
  const iAmIn = mine === "interested";

  const toggle = async () => {
    if (!user) return;
    const status = iAmIn ? "withdrawn" : "interested";
    setPending(true);
    setWriteError(null);
    try {
      const record: ProbeInterest = { activityId: card.id, userId: user.id, status, updatedAt: new Date().toISOString() };
      await filePort.writeText(`${PROBE_ROOT}/${localKey(card.id)}/${localKey(user.id)}.json`, JSON.stringify({ schemaVersion: 1, ...record }), {
        overwrite: true,
      });
      setSaved(`Saved on this device at ${new Date().toLocaleTimeString("en-GB")}`);
      void reload();
    } catch (e) {
      setWriteError(describeError(e));
    }
    setPending(false);
  };

  return (
    <main style={s.page}>
      <div style={s.banner}>
        <strong>MYT, Milestone 0 proof gate.</strong> This is a test card, not the product. Nothing here is simulated: the count comes from
        files and the viewers from live presence.
      </div>

      <section style={s.card} aria-label="Test activity">
        <h1 style={s.h}>{card.title}</h1>
        <p style={s.muted}>
          {card.area} · card source: {source}
        </p>
        <p data-testid="count" style={{ margin: 0, fontWeight: 600 }}>
          {records === null && !error ? "Loading interested count…" : `${interestedIds.size} interested`}
        </p>
        {error && <p style={s.danger}>Could not load interest: {error}</p>}
        <div style={s.row}>
          <button style={iAmIn ? s.button : s.primary} disabled={!user || pending || records === null} onClick={() => void toggle()}>
            {pending ? "Saving…" : iAmIn ? "Withdraw" : "I'd go with someone"}
          </button>
          {!user && <span style={s.muted}>Sign in to join.</span>}
          {user && <span style={s.muted}>Signed in as {user.name}</span>}
        </div>
        {saved && <p style={s.ok}>{saved}. Others see it once their files sync.</p>}
        {writeError && <p style={s.danger}>Save failed: {writeError}</p>}
        <PresenceStrip activityId={card.id} selfId={user?.id ?? null} />
      </section>

      <Diagnostics userId={user?.id ?? null} />
      <IntegrationCheck userId={user?.id ?? null} />
    </main>
  );
}

export { Probe as M0Probe };
