**Owner:** G1. **Contract version:** 1. **Status:** ready for implementation. This freezes MYT's shared TypeScript interfaces for the version-1 prototype.

## Files and exports

- `code/src/types.ts`: domain records, `Loadable`, `ActionResult`, `CreatePlanResult`, `ActionState`, routes, ranking, consensus, presence and participant view types.
- `code/src/data-contract.ts`: `MytFilePort`, `MytRepository`, `MytActions`, `UseMytDataInput`, `MytViewModel`, `ReadResult`, `FileEntry`, `FileChange`.
- `code/src/ui-contract.ts`: named `OnboardingProps`, `DiscoverProps`, `ActivityDetailProps`, `InterestPanelProps`, `TimeVotePanelProps`, `ConfirmPlanProps`, `MyPlansProps`, `CompanionListProps`, `PresenceStripProps`, `PlanSummaryProps`, `ScreenContext` and `PlanCard`.
- `code/src/paths.ts`: `DATA_ROOT`, fixed catalog/session paths and directory constants, plus `profilePath`, `interestFolderPath`, `interestPath`, `voteFolderPath`, `votePath`, `planPathForActivity`, `planPath`, `attendanceFolderPath` and `attendancePath`.

All domain records have `schemaVersion: 1`. ISO date-times in records must include an explicit offset or `Z`; display with `Europe/London`. IDs are opaque. Sample user IDs start `sample:` and preview IDs start `preview:`. A real user ID comes only from Lightfern's current user. `Activity.suggestedMeetingPoint` is accepted as an **optional** field (`string | null` when present); S8 may prefill it, but must label it as a proposal. G6 may seed it, T1 should validate it when present, and S8 may use it. Its absence means an empty meeting-point draft.

## Data folders and paths

All paths are relative to the MYT app folder, never `code/`. `k(id)` is T3's `keyForId(id)`, exactly `id-` plus lowercase UTF-8 hexadecimal. `paths.ts` imports T3's `keyForId` and `planIdForActivity` directly. T3 is an **integration dependency**; S1 imports the proposal before compiling the full app. Do not replace this with raw IDs, URL encoding or another local encoder. Invalid IDs must surface as `id-invalid` before file I/O. T3's limit is 120 UTF-8 bytes; verify actual Lightfern user IDs at the first live gate.

| Path | Data | Writer |
| --- | --- | --- |
| `data/activities.json` | `ActivityCatalog` | G6 seed only |
| `data/sample-profiles.json` | `SampleProfileCatalog` | G6 seed only |
| `data/session.json` | `SessionConfig` | setup action |
| `data/profiles/k(userId).json` | `Profile` | that real user |
| `data/interests/k(activityId)/k(userId).json` | `InterestRecord` | that real user |
| `data/votes/k(activityId)/k(userId).json` | `TimeVote` | that real user |
| `data/plans/k(plan:activityId).json` | `Plan` | designated organiser once |
| `data/attendance/k(planId)/k(userId).json` | `Attendance` | that real user |

G6 seeds `session.json` with a null organiser. `claimOrganiser({ replace: false })` succeeds only after a fresh read finds null. Replacing a configured organiser requires a separate deliberate `replace: true` action. S1 provides that setup control. This is a workflow convention, not access control against collaborators who can edit shared files.

`planIdForActivity(activityId)` returns `plan:<activityId>`; one immutable plan exists per activity. G2 must use `overwrite: false` for creation, re-read current interests/session/plan before it writes and return an existing plan when duplicate creation finds one. There is no documented cross-device compare-and-swap. A vote is advisory; the organiser explicitly selects and confirms a future time and a public meeting point of 1–240 trimmed characters. Confirmation needs two distinct real interested people including the organiser. Attendance remains a separate explicit action. Withdraw and decline write statuses; they do not delete files.

## File and load semantics

S1 adapts `ctx.files` into `MytFilePort` once in `host.ts`: UTF-8 `readText`, `writeText` with explicit `overwrite`, `list` and `watch`. The host adapter is the only SDK boundary; the repository is React independent. SDK `watch` changes have `type: created | changed | deleted` and `path`. The watcher covers a folder subtree. G3 subscribes to `data/`, cleans up and guards stale asynchronous reads by route/user generation.

Repository reads return `ReadResult<T>`, which is an `ActionResult<{ value: T; issues: RecordIssue[] }>`. A missing own profile is `value: null`. A confirmed absent optional collection is empty. Determine missing files/folders by listing the parent; do not parse error text or turn arbitrary rejections into emptiness. Malformed participant files become issues and are excluded individually. An invalid catalog or session is a failed read. Distinguish `invalid-json`, `invalid-record`, `unsupported-schema`, `not-found`, `id-invalid` and `io`.

G3 exposes `Loadable<T>`: loading, ready with `issues`, or error. A ready empty collection is not a load failure. `MytViewModel.actions` is `null` for explicit preview and signed-out mode. Preview never begins because a live load fails. Live writes return `ActionResult<T>`; confirmation returns `CreatePlanResult` with `created` or `existing`. The `existing` branch opens the saved plan and reports that another confirmation already exists. G9's `ActionState` distinguishes idle, pending, saved and retryable error. A successful write means saved locally, not proven synced to peers.

`MytViewModel` holds catalogs, session, own profile, real profiles, per-activity interest/vote arrays, plans and per-plan attendance. The map keys are raw opaque IDs; construct dictionaries safely (for example, null-prototype objects) and never interpolate those keys into paths. G3 may load each activity's interests after the catalog to populate feed counts, and active activity votes/attendance at the relevant route. Screen agents consume supplied props and never connect to the host or create their own repository.

## Screen boundaries

- S3 `Onboarding` receives a `Loadable<Profile | null>`, save state and `onSave`. The callback is absent in preview/signed-out mode. `onEnterPreview` and `onExitPreview` are explicit navigation controls.
- S4 `Discover` receives `RankedActivity[]` through a `Loadable`, filters, persistent interested counts and filter/open callbacks. `RankedActivity.reasons` are G4's explanations, not text the screen recomputes. Feed viewer counts are omitted.
- S5 `ActivityDetail` composes S6/S7/S10/G5 through its child-prop objects. `confirmationEntry` only decides whether to open S8, without requiring a meeting-point draft. S8's `evaluateDraft` checks the full T5 rule with the user's current draft.
- S6 `InterestPanel` receives only actual interested people in `interestedPeople`; samples go only to S10. Failure preserves the prior persisted status. A plan or unavailable activity disables new interest changes.
- S7 `TimeVotePanel` receives the valid future option IDs and T4 consensus from its parent. It does not recalculate votes. Clearing passes `null`; votes are effective only while that real user remains interested.
- S8 `ConfirmPlan` receives `evaluateDraft(optionId, meetingPoint)`, which returns T5's eligibility decision. `onConfirm` can still reject after a fresh repository read; it may return `existing`, in which case open that plan. Do not mark anyone going automatically.
- S9 `MyPlans` receives persisted plan cards and explicit navigation. G10 `PlanSummary` receives a saved plan, real going people and the current person's attendance callback.
- S10 `CompanionList` receives real participants separately from sample profiles. Optional interest/availability fields on real summaries mean unknown, not inferred. Samples are visibly fictional and never counted in interested, viewing or going.
- G5 `PresenceStrip` receives `ActivityPresence` with other viewers already deduplicated by user ID. Presence room is `myt-v1`, payload `{ v: 1, screen: Route["name"], activityId: string | null }`. It is temporary; disconnected is distinct from connected with zero viewers.

All screen action callbacks return promises with explicit success/failure results; callbacks that would write are absent when actions are unavailable. `ScreenContext.onNavigate` is S1's router. S1 derives child props from the view model and domain helpers; no screen owns storage, presence or authentication.

## Integration order and remaining checks

S1 creates `manifest.json` and the minimal shell, then integrates T3's identifier module before `paths.ts` is imported by runtime code. T1's decoders, T2 selectors, C2 date parser, T4 consensus and T5 rules follow their assigned interfaces; do not hide mismatches with casts. If a frozen signature truly must change, write a proposal naming affected owners before parallel edits.

No build, render, file-write, sync or multiplayer check is implied by this contract. The first gate remains one rendered card, one saved action, and two signed-in accounts using the **same shared app**, with presence and persistent file sync verified separately. Also verify missing-folder listing, `overwrite: false`, current user ID length and collaborator write access.

## Redesign contract extension (24 October 2026, before implementation)

Schema remains 1. Profile adds optional universityId, yearOfStudy (`1|2|3+|postgrad`), freeSlots (14 day/evening slots), budgetBand (`free|u15|u30|any`). Old profiles retain existing matching fields. New saves derive availability and budgetPence from richer choices. Email and simulated verification are ephemeral onboarding state only, never written to shared files.

New domain records all carry schemaVersion:1 and explicit actor/subject IDs for path validation:
- friends/requests/k(fromId)/k(toId).json: fromId,toId,status pending|cancelled,createdAt.
- friends/responses/k(toId)/k(fromId).json: fromId,toId,status accepted|declined|undone,respondedAt. `undone` restores pending without deleting; this is the clarification to the proposed undo schema.
- meet/k(me).json: userId,passedIds,updatedAt; blocks/k(me).json: userId,blockedIds,updatedAt.
- chats/k(chatId)/messages/k(authorId)/k(messageId).json: id,chatId,authorId,kind,text? or poll?,createdAt. Immutable message creation uses overwrite:false.
- chats/k(chatId)/read/k(me).json: chatId,userId,lastReadAt.
- chats/k(chatId)/polls/k(messageId)/k(voterId).json: chatId,messageId,voterId,optionIds,updatedAt.

Group ID is group:<activityId>. Membership is latest real interested participants, including after plan confirmation. DM ID is dm:<sorted IDs joined by |>; IDs containing | cannot form a DM, and IDs exceeding the existing 120-byte path limit fail visibly. No alternate path encoder. Polls have 2–6 distinct option IDs, question 1–80 and labels 1–40 trimmed characters. Read/post/vote membership is checked in UI and repository from fresh files. Files remain readable by collaborators; block and anonymity are display controls, not file secrecy.
