## Redesign implementation update — 24 October 2026

The user authorised the redesign and a simulated university-email step. Email is transient form state, never shared identity or a saved profile field. `host.ts` remains the sole SDK boundary and now falls back to "Student" rather than an email when a signed-in account has no name.

`data/socialRepository.ts` adds per-writer requests/responses, passes, blocks, messages, reads and poll votes. Its current actor always comes from the bound host identity. Path builders remain centralised in paths.ts with keyForId. Messages are immutable; cancelling, undoing and withdrawing write explicit statuses. Fresh membership is derived before chat writes; member-only chat loading avoids reading chats the bound user cannot join. Blocks and anonymous voting are UI privacy, not file access control.

`useMytData` owns social loading/actions and extends its existing debounced data watcher. The existing participation hook remains responsible for aggregate interest and attendance slices. The social repository is a focused companion to the original repository rather than enlarging the original frozen interface. Invalid optional social files are reported as issues; I/O errors remain errors. At this prototype size a social refresh reloads authorised conversations; it is not an incremental message database.

`SocialScreens.tsx` contains prop-driven Meet, Requests, Chats, chat and poll-builder views; they receive state and callbacks only. Pure social selectors are in domain/social.ts; guards are in domain/validation.ts. `useActivityPresence` keeps room myt-v1, extends the payload with typingIn, deduplicates peers and excludes self from typing. Typing clears after four seconds without input or on departure.

The generated `demo/index.html` replaces host.ts only at bundle time with an isolated browser adapter, uses fictional fixture accounts, and never writes into the shared data directory. Host runtime records and catalogs were not reset or seeded by this work. Existing read-only preview remains separate.

The original two-account sync/presence gate remains unverified; the user explicitly requested continued implementation. Local browser and in-memory checks provide no remote-sync claim.

---

**Owner:** O1. **Status:** decided for version 1, ready for G1 to freeze. Platform facts come from the built-in apps, app-example, app-sandbox and app-multiplayer guides (SDK 2.4.1). Items marked **VERIFY** are assumptions the Milestone 0 gate must confirm with real accounts.

## 1. Decisions in one screen

1. **Scope stays as written.** One designated organiser in `data/session.json`, one immutable plan per activity (`plan:<activityId>`), separate per-person interest, vote and attendance files. No scope change is needed for an honest demo.
2. **Three clarifications (not contract changes):** withdrawing writes `status: "withdrawn"` instead of deleting; once a plan exists, interest and votes become read-only in the UI and attendance is the only live control; marking "going" does not require prior interest.
3. **One optional field (G1 to accept or reject before freeze):** `Activity.suggestedMeetingPoint: string | null`, so the plan's "suggested meeting point, labelled as a proposal" has somewhere to live. S8 prefills it; the organiser can edit.
4. **Every participant write targets only `currentUser.id`'s own file.** The repository takes the user ID from the host, never from screen props.
5. **One file watcher** in G3 on `data` (subtree), routed by path. Presence uses one room, `myt-v1`.
6. **Live mode never falls back to preview.** Preview is an explicit, bannered mode with no write callbacks.
7. **We never claim remote sync.** The SDK has no sync-complete signal. UI says "Saved" (on this device); collaborators' changes appear when their files arrive.

## 2. Data layout and ownership

All paths are relative to the MYT app folder. `k(x)` is T3's `keyForId(x)` (`"id-" + lowercase hex of UTF-8`). G1's `paths.ts` is the only place that builds these strings.

| Path | Record | Who writes | Write mode |
| --- | --- | --- | --- |
| `data/activities.json` | ActivityCatalog | G6 (seed, by hand) | never written by the app |
| `data/sample-profiles.json` | SampleProfileCatalog | G6 (seed, by hand) | never written by the app |
| `data/session.json` | SessionConfig | G6 seeds `organiserUserId: null`; the person doing setup sets it once | `overwrite: true`, only after a fresh read shows `null`; "Replace organiser" is a separate explicit action |
| `data/profiles/k(userId).json` | Profile | that user only | `overwrite: true` |
| `data/interests/k(activityId)/k(userId).json` | InterestRecord | that user only | `overwrite: true` |
| `data/votes/k(activityId)/k(userId).json` | TimeVote | that user only | `overwrite: true` |
| `data/plans/k(planId).json` | Plan | designated organiser, once | `overwrite: false` |
| `data/attendance/k(planId)/k(userId).json` | Attendance | that user only | `overwrite: true` |

Rules:
- The app never writes catalogs, never seeds or resets runtime records and never deletes records in version 1.
- G6 must create `data/activities.json`, `data/sample-profiles.json` and an initial `data/session.json` of `{"schemaVersion":1,"organiserUserId":null}`, so `data/` exists before the first view loads.
- Writing `session.json` with an organiser: because G6 seeds it with `null`, "Set me as organiser" uses `overwrite: true` **only when the current value is null**. If an organiser is already set, the setup screen shows who it is and offers "Replace organiser" as a deliberate second action.
- Compact JSON (`JSON.stringify(x)`) for every runtime write.

## 3. Identity rules

- **Real user ID:** `ctx.currentUser.id`. The `isRealUserId(id)` rule is: `isValidId(id) && !id.startsWith("sample:") && !id.startsWith("preview:")`.
- **Sample profile IDs** must start with `sample:`. The sample catalog decoder rejects any item without that prefix or without `isDemo: true`.
- **Preview fixture IDs** must start with `preview:`.
- **Activity IDs:** lowercase `[a-z0-9-]`, at most 60 characters (G6). That keeps `plan:<activityId>` well under T3's 120-byte limit.
- **ID limit:** 120 UTF-8 bytes (T3). The longest key is `"id-"` + 240 hex characters + `.json`, 248 bytes, under the usual 255-byte filename limit. **VERIFY** at M0: log `currentUser.id.length`. A Lightfern ID over 120 bytes would be a blocker for T3's format, and the fix would go to T3.
- Signed out (`currentUser === null`): read-only. No write callback exists, and the UI says "Sign in to join".

## 4. State transitions

Per activity, per real user. "Reads" means what the action needs fresh before writing; the other participant observes the result after file sync, through G3's watcher.

| Action | Precondition (who checks) | Reads | Writes | Other participant sees |
| --- | --- | --- | --- | --- |
| Save preferences | signed in | own profile | `profiles/k(me)` | name and university in interested lists |
| Set organiser (setup) | signed in, `organiserUserId` null; or explicit Replace | `session.json` | `session.json` | organiser badge; confirm controls only on the organiser's view |
| I'd go with someone | signed in; activity available; no plan yet (S6, T5 rules) | own interest | `interests/k(a)/k(me)` = interested | +1 interested, their name in the list |
| Withdraw | own record is interested; no plan yet | own interest | same file = withdrawn | −1 interested; their vote stops counting (T2 and T4) |
| Choose time | own interest is interested; no plan yet | own vote | `votes/k(a)/k(me)` = optionId | tally changes (advisory only) |
| Clear time | as above | own vote | same file, `optionId: null` | tally changes |
| Confirm plan | me = organiser; ≥2 distinct real interested including me; valid future option; meeting point 1–240 characters after trimming (T5) | **fresh** read of interests and `plans/k(plan:a)` immediately before writing (G2) | `plans/k(plan:a)` with `overwrite: false` | plan appears; interest and votes freeze; attendance controls appear |
| I'm going / Can't go | plan exists; "going" only before `startAt`; "declined" always (T5) | own attendance | `attendance/k(plan)/k(me)` | going list changes |

The interested, going and viewing counts are always derived, never stored:
- **Interested** = distinct real user IDs whose latest interest record is `interested` (T2).
- **Going** = distinct real user IDs whose attendance is `going` (T2).
- **Viewing** = distinct peer `user.id`s in presence with a matching `activityId`, excluding me (G5). It is never added to either count above.

## 5. Module boundaries

```
home.tsx (S1)  connect() once → createRoot(<App/>)
host.ts  (S1)  ctx → MytFilePort, currentUser, room hooks re-exported
App.tsx  (S1)  route state, mode (live | preview), composes screens
  useMytData (G3)  ← repository (G2) ← MytFilePort ← host.ts
                   ← domain: matching (G4), selectors (T2), consensus (T4), planRules (T5), validation (T1), identifiers (T3)
  useActivityPresence (G5) ← lightfern:host/react usePeers / useSetPresence / useConnected
  useAsyncAction (G9)  per-action pending and error state
  Screens (S3–S10) are prop-driven only; no ctx, no repository, no room.
```

Only `host.ts` imports `lightfern:host`. Only G5 calls the multiplayer hooks. Only G3 calls the repository. Screens receive data and callbacks through `ui-contract.ts` props.

## 6. Interface checklist for G1

The names are suggestions; the shapes are the decision.

**MytFilePort** (adapted by S1 from `ctx.files`):
- `readText(path): Promise<string>`: rejects on any failure.
- `writeText(path, text, { overwrite: boolean }): Promise<void>`
- `list(path): Promise<{ path: string; name: string; kind: "file" | "folder" }[]>`
- `watch(path, listener: (c: { type: "created" | "changed" | "deleted"; path: string }) => void): () => void`

**Missing versus failed.** The SDK does not document the error shape for a missing file or folder. The repository decides "missing" by listing the parent and not finding the entry. Only then does it return `not-found` (or an empty collection for a folder). Any other rejection is `io`.

**Already exists.** When `writeText(..., { overwrite: false })` rejects, the repository lists the parent. If the file is now present, the result is `already-exists`; otherwise it is `io`. Do not parse error strings.

**Errors:** `MytError = { code: "not-found" | "invalid-json" | "invalid-record" | "unsupported-schema" | "already-exists" | "id-invalid" | "not-signed-in" | "not-allowed" | "preview" | "io"; message: string; path?: string }`.

**Load state:** `Loadable<T> = { state: "loading" } | { state: "ready"; value: T; issues: RecordIssue[] } | { state: "error"; error: MytError }`.
- `RecordIssue = { path: string; code: MytError["code"]; message: string }`.
- A malformed participant file becomes an issue and is excluded. It never blanks the whole collection.
- A malformed catalog or session file is an `error` for that slice.

**Action results:**
- `ActionResult<T> = { ok: true; value: T } | { ok: false; error: MytError }`.
- `CreatePlanResult = { ok: true; kind: "created"; plan: Plan } | { ok: true; kind: "existing"; plan: Plan } | { ok: false; error: MytError }`.
- The UI shows `existing` as "A plan was already confirmed" and opens it.

**Action UI state (G9):** `{ status: "idle" } | { status: "pending" } | { status: "saved"; at: string } | { status: "error"; error: MytError; retry: () => void }`.

**Routes:** `{ name: "welcome" } | { name: "discover" } | { name: "activity"; activityId } | { name: "confirm"; activityId } | { name: "plans" } | { name: "plan"; planId } | { name: "setup" }`.

**MytViewModel (G3):**
- `mode: "live" | "preview"`, `currentUser: { id; name } | null`
- `activities`, `samples`, `session`, `myProfile`, `realProfiles: Loadable<Record<userId, Profile>>`
- `interestsByActivity`, `votesByActivity`, `plansById`, `attendanceByPlan: Loadable<Record<id, Record[]>>`
- `issues: RecordIssue[]`

**Callbacks** (all return `Promise<ActionResult>`, absent in preview or when signed out):
- `saveProfile(input)`
- `setInterest(activityId, "interested" | "withdrawn")`
- `setVote(activityId, optionId | null)`
- `claimOrganiser({ replace: boolean })`
- `confirmPlan({ activityId, optionId, meetingPoint })`
- `setAttendance(planId, "going" | "declined")`

**Presence:** room `myt-v1`; payload `{ v: 1; screen: Route["name"]; activityId: string | null }`. G5 validates the shape, ignores anything else, groups by `user.id`, drops `currentUser.id` (your own other tabs) and exposes `{ connected: boolean; viewers: { userId; name }[] }`.

**Shared helper signatures:**
- `parseInstant(s: string): number | null` (C2). Returns epoch milliseconds. Requires an explicit offset or `Z`; anything else is `null`.
- `formatLondon(ms)` (C2) uses `Europe/London`.
- T2, T4 and T5 take `ReadonlySet<string>` of real user IDs built with `isRealUserId`.
- T5's threshold is 2 distinct real interested users including the organiser, and the meeting-point maximum is 240 characters.
- T3's ID maximum is 120 UTF-8 bytes.

## 7. Where each kind of person or data enters the UI

| Source | Enters through | Can appear as | Must never appear as |
| --- | --- | --- | --- |
| Real account | `ctx.currentUser`, `data/profiles`, participant files | interested, voter, organiser, going | — |
| Live peer | presence room only | "Alex is viewing this" | interested, going, or a count |
| Sample profile | `data/sample-profiles.json` → CompanionList (S10) | "Example student (fictional)" with shared interests | a peer, interested, going, voter, or in any count |
| Activity source | `Activity.source.kind` → C1 badge | Verified (with checked date), Unverified, Demo idea | "Live" or "booked" |
| Preview fixture | G7, only when `mode === "preview"` | anything, under a permanent "Preview – nothing is saved" banner | in live mode, ever |

Guards, in depth:
1. Decoders enforce the ID prefixes.
2. The repository rejects participant writes when `userId !== currentUser.id` or `!isRealUserId(userId)`.
3. T2 selectors filter with `isRealUserId`.
4. G5 builds viewers only from room peers.
5. S1 enters preview only through a visible toggle and never on a load error. A live load error shows an error panel with Retry.
6. G8 checks: sample IDs never appear in derived interested or going sets; preview mode exposes no write callbacks.

## 8. Milestone 0 proof gate (S1 builds this first)

Build only this, then stop and verify with humans:

1. `MYT/code/manifest.json`:
   - `manifestVersion` `"2.4"` (the documented ceiling; the guides do not say which minor added multiplayer)
   - `react` and `react-dom` at `19.2.0`
   - permissions `files.read`, `files.write`, `multiplayer`
   - home `src/home.tsx`
2. `home.tsx` renders one hard-coded activity card, reading `data/activities.json` if present, and shows `currentUser.id` length plus name.
3. One saved action: "I'd go with someone" writes `data/interests/<key>/<key>.json` and the card shows the interested count from a watcher on `data/interests`.
4. Presence: `useSetPresence("myt-v1")` with the card ID; show `useConnected` state and the deduplicated peer list.
5. Render with `render_app`. This proves layout only.
6. **Human check, two signed-in accounts, same shared MYT folder:**
   - A and B both open the app. Each sees the other as a viewer within a few seconds (presence).
   - A clicks join, and B's count rises after sync (files).
   - B closes the app, and A's viewer disappears within about 30 seconds while the interested count stays.
   - A opens a second tab, and B still sees A once.
7. **VERIFY at the same time:**
   - the collaborator can write into the shared folder
   - `ctx.files.list` on a missing folder rejects (record the actual behaviour)
   - writing with `overwrite: false` to an existing path rejects
   - the user ID length

Record the outcomes in `Planning/Integration.md`. Do not expand the interface until step 6 passes.

## 9. Tradeoffs accepted

- **Hex-encoded folder names** are unreadable to people browsing the files, but they are safe and reversible. The app is the interface.
- **No deletes.** Withdrawn and declined records stay as files. This avoids delete-and-recreate races during sync, and the volume is tiny.
- **One watcher on `data/`.** G3 re-reads only the changed file on `changed` and re-lists that folder on `created` or `deleted`, debounced about 150 ms. At this data size, simplicity beats finer scopes.
- **Device clocks set `updatedAt`.** That is acceptable because each record has one writer.
- **No cross-device protection for confirmation.** See `Concurrency review.md`. The single organiser on a single device is the mitigation, and we say so.
