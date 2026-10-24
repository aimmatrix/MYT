# Redesign integration — 24 October 2026

Current source implements the supplied MYT Student Redesign.html across shared tokens/primitives, onboarding, Discover search, activity detail, plans, Meet/requests, chats and polls. Older notes below describe the preceding implementation and should not be read as current validation.

## Completed phases and changed files

| Phase | Main files | Strict check |
| --- | --- | --- |
| Shared design and navigation | styles.css, components/ui.tsx, App.tsx | passed |
| Existing screen restyle | Discover.tsx, ActivityDetail.tsx, MyPlans.tsx, ui-contract.ts; setup/confirmation inherit tokens | passed |
| Onboarding and richer profile | Onboarding.tsx, LegacyPreferences.tsx, types.ts, preferences.ts, validation.ts, repository.ts | passed |
| Search | Discover.tsx (600ms radar, title/area/interest search, batches of 12) | passed |
| Friends/Meet/Requests | social.ts, socialRepository.ts, SocialScreens.tsx, paths.ts | passed |
| Chat/presence/read state | useMytData.ts, data-contract.ts, App.tsx, useActivityPresence.ts, host.ts | passed |
| Polls | PollCard.tsx, SocialScreens.tsx, validation.ts, socialRepository.ts | passed |
| Tests/docs/portable demo | qa/social-checks.ts, Checks/e2e-flow.cjs.txt, tools/check-redesign.cjs, tools/build-demo.cjs, FONT-LICENSES.txt | passed |

## Validation

Run `node MYT/tools/check-redesign.cjs` from the Lightfern workspace. The default uses the existing Scrapper node_modules installation; MYT_NODE_MODULES can point to another installation with TypeScript and React types. Strict compilation uses the local host-check.d.ts stubs, not the SDK's own declarations.

- Original domain checks: 15/15.
- New social domain checks: 26/26 (friend status, membership, unread, poll guards/tallies, choice clearing, anonymity and preference mapping).
- In-memory repository/two-account flow: 62/62, including request → accept → DM, group membership, poll → vote → change → clear, block/unblock and nonmember/signed-out guards. Fixtures now live only in the in-memory test port so independent catalog updates cannot invalidate fixed activity IDs.
- Automated Chromium walkthroughs at 390×844: signup simulation → university/free time/interests → Discover → Meet → accept request → DM → post poll → vote. No browser exceptions and no horizontal overflow. Layout issues found were corrected (oversized onboarding header and chat-tab/composer overlap). A second walkthrough also passed activity joining → group chat, Plans/Past, Escape dismissal and reduced-motion handling; no runtime errors or horizontal overflow. Discover filters were subsequently compacted into a horizontal strip with an expandable availability section.

## Demo and limitations

Build the isolated demo with `node MYT/tools/build-demo.cjs`, then open demo/index.html in a browser. It includes the bundled fonts/licenses and browser-local storage. Reset demo clears only its own storage key. Simulated accounts and email verification are visibly labelled. It makes no SDK or shared-file writes.

Fonts are embedded from the supplied export, avoiding external font-loading permissions. Dark appearance is retained in light hosts; no separate light palette. Real two-device file sync, multiplayer presence, signed-in identity hooks and SDK rendering are still unverified and need two signed-in accounts in Lightfern. The standalone demo deliberately reports no live peers. Shared file access can reveal chat/voter/block data despite UI restrictions.

---

## Historical integration record

**Owner:** S1 (sole editor). **Status:** every module is imported and composed in `App.tsx`; the app type-checks under `tsc --strict` and renders in every route (live, preview, phone width). **Nothing that writes or syncs has been exercised.** The two-account check is the gate for all of it and has not been run. See "App wiring" immediately below.

## App wiring (App.tsx)

**Files S1 added** (new, unowned by any other agent): `code/src/App.tsx`, `code/src/home.tsx` (now a 3-line mount), `code/src/wiring/appRepository.ts`, `code/src/wiring/useParticipation.ts`, `code/src/screens/Setup.tsx`. The M0 probe moved to `code/src/m0Probe.tsx` and is reachable from the **Diagnostics** nav item (live mode only).

**Structure.** `App` holds live or preview. `LiveApp` and `PreviewApp` are separate trees, so preview never joins the presence room, reads shared files or gets a write callback. Both feed one `AppView` (header, banners, `ErrorBoundary`, route switch). Per-route components derive every screen's props from the view model and the domain helpers (T2 selectors, T4 consensus, T5 rules, G4 ranking, C2 times).

**Decisions worth knowing**
- **Real user set.** `realUserIds` is every ID found in profiles, interest records and attendance records that passes `isRealUserId` (valid, not `sample:`, not `preview:`), plus the signed-in user. This feeds T2, T4 and T5, so sample or preview IDs can never be counted.
- **`decodeRecord` adapter** (`wiring/appRepository.ts`): one typed decoder per record kind in a mapped object, so there is no cast between kind and result type.
- **Participation loader** (`wiring/useParticipation.ts`): G3's hook loads interests for the route's activity and attendance for the route's plan only. The feed counts and My plans need all of them, so this hook loads interests for every activity and attendance for every plan through G2's repository, refreshed (150 ms debounce) on changes under `data/interests` and `data/attendance`. It only reads.
- **Existing plan** is read from the plan map (`planOfActivity`), never from T5's result, because T5 returns `not-organiser` before `plan-exists`.
- **`evaluateDraft` reads `Date.now()` when called**, as S8 requires, so a time that expires while the form is open is caught on click.
- **"My plans" scope:** plans I organise, am interested in, or have answered. Interest-only activities are listed separately and never as going.
- **Preview** is entered through a visible header button or a signed-out banner, never automatically, and never on a load error.
- **Duplicate clicks:** G9's `run` returns null while an action is in flight; the wrappers turn that into a "still saving" error result so no screen sees a null.

**Bug found and fixed in G2's file (`data/repository.ts`, `listed()`).** On a fresh install `data/interests` does not exist. Listing `data/interests/<activity>` failed, and the fallback listed only the immediate parent, which also failed, so G2 returned a hard `io` error instead of "empty". Every interest count on the feed said "Interest count not available". The fix walks down from `data` (which always exists) and reports "missing" when any segment is absent. Verified by render: counts changed from "not available" to "No one interested yet". The same walk now covers votes, plans, attendance and profiles. **G2 should adopt this.**

**Checked**
- `tsc --strict` over all of `code/src` (TypeScript 5.9.3, React 19.2 types, hand-written stubs for `lightfern:host`): no errors. This is a proxy for Lightfern's build; the stubs are mine, not the SDK's types.
- `render_app`: welcome, Activities (6 cards, correct source badges, London times, counts), activity detail (steps, interest panel, time vote, fictional companions, presence strip, "why you can't confirm yet"), Setup, My plans (empty state), Diagnostics (22 of 22 self-checks with C2's real parser), preview (all 7 scenarios present, no write buttons on any screen, confirmed-plan layout, leave preview returns to live). Phone width 390 px: no horizontal overflow on welcome, discover, activity, plans, setup, diagnostics or preview, in light and dark. Console clean.

**First observed live write, and a scope change by someone else (24 Oct 2026, 13:38)**
- A Codex computer-use test session, driving the real desktop app as the signed-in user, saved preferences. `data/profiles/id-<hex of the user id>.json` appeared with the right shape (`schemaVersion 1`, the real user id, `isDemo:false`, compact JSON). So **`saveProfile` works end to end in the live app**, and the saved profile is read back: the greeting shows the saved name and football cards say "Matches your interest in football". Everything else that writes (join, vote, organiser, confirm, attendance) is still unobserved live. The Codex run stopped early (it misread the already-open "Welcome to Lightfern" tab as unrelated, then hit screen-capture errors), so it covered only this step. One field it tried to fill, university, was saved blank, so it did not take the typed text; unclear whether that was Codex's input or a bug, not investigated.
- **The catalog is no longer the six seeded activities.** Another session changed `data/activities.json` to **101 activities** (2 verified football, 4 demo, 95 unverified imported listings from Skiddle and Luma) and added `data/source-status.json` (provider status; several need API keys; one errored). It also widened the frozen interest list to football, karting, cinema, music, social, fitness, comedy, theatre in `types.ts` and `validation.ts`. This was not part of the original plan or contract; I did not make it. Consequences I checked: it type-checks, G8's 15 of 15 still pass, my flow script still passes 38 of 38 (I removed its hard-coded "6 activities"), and the app renders 101 cards with all counts resolving in about 1.5 s.
- **Impact to decide on:** most cards are third-party listings labelled "Unverified". They carry `suggestedMeetingPoint`, but their times come from the import, not from a researched source, and several are in the past or at odd hours (for example "Sat 24 Oct, 14:00"). Search and filtering are limited to the three-way interest and availability chips. `Event sources.md` describes only the original six. Someone should decide whether the demo uses the six or the 101, and refresh the docs accordingly.
- **Change made by S1:** `useParticipation` now lists `data/interests` and `data/attendance` once and only loads activities or plans whose folder exists, because with 101 activities each refresh was otherwise 101 sets of file calls. Behaviour is identical (a missing folder is an empty list); type-check and render re-run clean.
- **Test state left in the library by that run:** `data/profiles/` holds the test profile. `data/session.json` is untouched (organiser still unset). Nothing else was written, as far as the folder listing shows.

**Logic-level tests of the write paths (run by S1, 24 Oct 2026, outside Lightfern)**

Render sessions refuse writes, so the repository and domain code were compiled with `tsc` to CommonJS and run in Node against an in-memory file port that copies the platform behaviour measured at M0 (listing a missing folder rejects; `overwrite:false` rejects on an existing file). The script is saved at `Planning/Checks/e2e-flow.cjs.txt` with run instructions.
- **G8's suite (`qa/domain-checks.ts`): 15 of 15 pass.** It had never been run before.
- **S1's end-to-end flow, two accounts on one shared port, through the real adapter and the real seed files: 38 of 38 pass.** Covers: fresh install (nothing under `data/` yet) loads as empty; profiles for both people; claim organiser (the other account cannot silently take over); join and see each other's interest; confirm refused with one interested person; votes and clearing; non-organiser, blank meeting point and unknown option all refused; organiser confirms (trimmed point, the option's exact times, id `plan:<activity>`); the same confirmation again returns the existing plan; a different one is refused; exactly one plan file; going and declined are separate per-person records; every participant file is keyed only by the writer's real id; no sample or preview id is ever written; runtime JSON is compact; one corrupt participant file becomes an issue while valid ones load; a corrupt catalog is an error rather than an empty library; a rejected write returns `io` and never success.
- Observed, not asserted: voting for an option that does not exist is refused (`not-allowed`); withdrawing after a plan exists is refused (`not-allowed`), so the UI lock and the repository agree.
- Two of my first test runs passed or failed for the wrong reason (a corrupted catalog masking the write, then a locked activity). Both were test-setup mistakes, fixed, and the final run tests what its names say.

These prove the rules and the data layer. They do **not** prove the UI buttons call them correctly, that two real machines sync, or that presence works.

**Not checked (needs a writable, two-account session)**
- Any write: save profile, join, withdraw, vote, claim organiser, confirm plan, mark going. Render sessions refuse writes, so the happy paths and error paths of every action are unexercised.
- The confirm screen end to end (an organiser plus a second interested person is required to reach it live).
- File sync between accounts, the watchers delivering a peer's change, presence between accounts (G5), and the 30 second drop-off.
- `Setup`'s replace-organiser confirmation, which needs an already-set organiser.
- Keyboard navigation and screen reader behaviour across the composed app.

**Known rough edges**
- Opening Diagnostics replaces your presence payload with the probe's, and closing it leaves presence unset until you navigate to a different route. Harmless for the demo; do not leave Diagnostics open during the presence check.
- "Go to interest" in the time vote panel is wrapped by S5 (it scrolls and focuses the interest panel); my `onGoToInterest` is a deliberate no-op.
- Preview mode shows two banners (the app's own and Discover's own). Left as is.
- The preview scenarios use a fixed clock (24 Oct 2026 12:00 UTC) so their sample times stay in the future.

## Imports (wave 4, Cursor batch C1 to C5)

S1 was cut off by a usage limit mid-import; a continuation session finished it. All five are now in the library and checked against the proposals with `diff`.

| File | From | State | Notes |
| --- | --- | --- | --- |
| `domain/londonTime.ts` | C2 | identical | Exports `parseInstant(value: string): number \| null`, `formatLondonDateTime`, `formatLondonTimeRange`, `getFutureTimeOptions`. An earlier transcription had literal en dash and nbsp characters instead of `\u` escapes (same code points); restored to the proposal's escaped form. |
| `domain/sourcePresentation.ts` + `components/SourceBadge.tsx` | C1 | **patched** | Proposal linked plain `http:`; Concurrency review row 23 says links render for `https:` only. Three lines marked "S1 patch" plus matching comment text. C1's own check script tests the unpatched proposal, so it does not cover this change. |
| `domain/cost.ts` | C3 | identical | `formatCost`, `compareBudget`, `parseBudgetPounds`. |
| `domain/availability.ts` | C5 | identical | `compareAvailability` takes `readonly string[]`. |
| `components/ProfileAvatar.tsx` | C4 | identical | See size and class mismatches below. |

**Open points**
- **`styles.css` (S1 edit to S2's file):** added `.myt-avatar--small` (28px), `.myt-avatar--medium` (40px), six `data-palette-slot` fills (low-chroma tints from one hue variable, no status colours), and `.myt-avatar-with-demo` / `__demo` / `__initials` / `__fallback`. Contrast in light and dark themes is **not measured** and nothing has been rendered. Pass `decorative` when a name is shown beside the avatar, and keep the "Fictional" chip on sample rows.
- C2's `TimeOptionInput.availabilityKeys` is `string[]`, so `getFutureTimeOptions` returns a wider type than `types.ts` `TimeOption`. `matching.ts` now types its local `availabilityForOptions` structurally to accept both.

**Compile fixes made while typechecking the whole tree** (other agents' files, behaviour unchanged):
- `components/Feedback.tsx`: `ActionFeedback` destructured `onDismiss`, which is not in `ActionFeedbackProps` and was never used. Removed.
- `data/repository.ts`: narrowing of `plan.value` was lost inside a closure; copied `plan.value.activityId` to a local first.
- `domain/matching.ts`: see above.

**Checks run (outside Lightfern's build, Node 22 with TypeScript 5.9.3 from an existing install):**
- Each C proposal's own script re-run: C1 13, C2 all, C3 17, C4 ok, C5 12 (6 type contracts). All pass.
- `tsc --strict` over all of `code/src` with stubbed `lightfern:host` types: no errors.
- Integration script against the real seed files with C2's real `parseInstant`: activities (6), sample profiles and session decode; all 10 time options parse and format in London time; `rankActivities` ranks 6 with 0 issues; `getSourcePresentation` and `formatCost` run on every activity. All seed costs read "Cost unknown".

**Local render (later, outside Lightfern):** a throwaway gallery page rendered `ProfileAvatar`, `SourceBadge`, `CompanionList`, and the UI primitives with the real `styles.css`, in light and dark, using guessed `--lf-*` token values (not the host's real ones). Findings: `SourceBadge` had no CSS, so label and detail ran together; added `.myt-source-badge` rules to `styles.css`. `CompanionList` (S10) drew its own grey avatar; **now swapped to `ProfileAvatar` (decorative, `isDemo` on sample rows, Fictional chips kept)**, removing its private `initialsOf` helper, and re-checked in the preview. Note S10's initials rule changes from first two words to first and last word. Priya Shah and Maya Rahman both hash to slot 1, so they share a colour. Dates display as "GMT+0" rather than "GMT", from C2's formatter; cosmetic, not changed.

**Earlier note, now partly superseded:** `ProfileAvatar` and `SourceBadge` were never rendered (no React in the check environment). `render_app` was not run after these imports, so nothing was confirmed inside Lightfern's own build. The `lightfern:host` stubs were written from `host.ts`'s usage, not the SDK's real types. Writes, sync and multiplayer are unchanged from before.

## Imports (wave 4, terminal batch)

All five were read in full, reviewed against the frozen contract, and written to `code/src/domain/` through the library tools. Four are byte-identical to the proposal (checked with `diff`); T1 has one documented patch.

| File | From | State | Notes |
| --- | --- | --- | --- |
| `identifiers.ts` | T3 | identical | `paths.ts` now resolves. Activity IDs must be at most 115 UTF-8 bytes (G6's longest is far below). |
| `validation.ts` | T1 | **patched** | Proposal silently dropped G1's optional `Activity.suggestedMeetingPoint` (it builds output field by field and had no reader for it). Patch: type gains `suggestedMeetingPoint?: string \| null`; `readActivity` reads it when the key is present (must be null or non-blank text) and omits it when absent. Marked "S1 patch" in the file. Everything else unchanged. |
| `participantSelectors.ts` | T2 | identical | Takes `realUserIds: ReadonlySet<string>` and `parseInstant`. |
| `timeConsensus.ts` | T4 | identical | Needs `nowMs` and `parseInstant`. |
| `planRules.ts` | T5 | identical | `PlanCreationResult` is assignable to `types.ts` `PlanCreationDecision`. |

**Verified in Lightfern's own build** (temporary `IntegrationCheck` in the M0 `home.tsx`, `render_app`, 22 of 22 pass): `paths.ts` imports `identifiers.ts` and builds `data/...` paths; T3 round-trips this account's real user ID; T1 decodes the real `activities.json` (6), `sample-profiles.json` (12) and `session.json` and rejects a corrupt catalog, malformed JSON and a version 2 file; `suggestedMeetingPoint` survives on all six activities; every activity ID can form a plan ID; T2 excludes sample IDs and honours latest-wins and withdrawals; T4 reports a real tie rather than picking a winner and counts only eligible voters; T5 allows a valid confirmation and denies one real person, a sample making up numbers, and a non-organiser.

**Not verified by those checks:** `parseInstant` was a stand-in regex (C2 absent), so agreement with C2's real parser is untested. The terminals' own 100+ Node checks were not re-run here; only the 22 above ran in-app. Nothing exercised writes, sync, or multiplayer.

**Decisions and open points from the reviews**
- T1: `area` may be blank (T1 followed the letter of the brief). Left as is; G6's seed has non-blank areas.
- T1 does not check a plan's `startAt`/`endAt` against its chosen option (O1 item 8). It needs the activity, so it is **G2's duty** when it reads a plan. Not yet implemented; G2 must add it.
- T2: an undated `declined` cannot override a valid `going` (it is ignored). Deliberate and documented by T2; revisit only if it matters in the demo.
- T5: check order puts "not organiser" before "plan exists", so a non-organiser gets `not-organiser` rather than `plan-exists`. The UI should open an existing plan from the plan map itself, not from this result. S8 and App.tsx must do that.
- T4 and T5 and T2 each define a local `ParseInstant` type with the same signature. Harmless; C2's exported parser must satisfy `(value: string) => number | null`.

## Current state

| Item | State |
| --- | --- |
| `code/manifest.json` | Written. `manifestVersion` 2.4, `react` and `react-dom` 19.2.0, permissions `files.read`, `files.write`, `multiplayer`, home `src/home.tsx`. |
| `code/src/host.ts` | Written. Single `connect()`, `ctx.files` adapted to G1's `MytFilePort`, hooks re-exported. Only module that imports `lightfern:host`. |
| `code/src/home.tsx` | Thin mount of `App`. |
| `code/src/m0Probe.tsx` | The M0 probe view, kept as the **Diagnostics** page: one card, one saved action, watcher-driven count, presence in `myt-v1`, platform probes, the 22 in-app self-checks. Writes only under `data/m0-probe/`. |
| `code/src/App.tsx` | **Created.** Composes every module; see "App wiring". Built before the M0 gate passed, at the user's instruction. The gate is still required before trusting any write or sync behaviour. |

## M0 checklist

Render checks (one signed-in account in a read-only render session, no peers, writes fail):

- [x] App builds and mounts with no console errors.
- [x] Card, probes panel and presence strip lay out correctly (dark theme, 800 px wide).
- [x] Identity shown: signed in, user ID length **36 characters, 36 UTF-8 bytes**. Well under T3's 120-byte limit; key length 75 against a 255 limit. No change needed to T3.
- [x] `ctx.files.list` on a missing folder **rejects**: `PluginRpcError: ENOENT: no such file or directory, scandir ...`. This matches O1's assumption, and the repository must still decide "missing" by listing the parent rather than parsing the message.
- [x] Presence in a render session reports "not connected" with zero peers, as documented. This shows the disconnected state renders distinctly from "connected, nobody else here". It does not show that presence works.

**Not verified, needs two signed-in humans in the same shared MYT app** (use the probe panel's buttons and the card):

- [ ] A and B both open the app and each sees the other under "Also viewing" within a few seconds.
- [ ] A clicks "I'd go with someone"; B's count rises after files sync. (Also confirms the collaborator can read A's file.)
- [ ] B clicks it too, so the count reaches 2 on both sides. (Confirms the collaborator can **write** into the shared folder.)
- [ ] B closes the app; A's "Also viewing" clears within about 30 seconds while the interested count stays.
- [ ] A opens a second tab; B still sees A once (de-duplication by `user.id`).
- [ ] Click "Probe: overwrite false" and record the three lines: second sequential write rejects? Do two concurrent writes to one path both succeed? (Single-device behaviour; no cross-device guarantee is claimed either way.)
- [ ] Note whether an offline write is kept and synced later (optional).

## How to run the human check

1. Share the **MYT app folder** (not the `code` folder) with the second account.
2. Both open MYT from the library. Each should see "Signed in as <name>" and "Live presence: connected".
3. Work through the unchecked boxes above. Record outcomes in this file, replacing the boxes.

## What the probe records

`data/m0-probe/<id-hex of m0-probe>/<id-hex of userId>.json` per participant, plus `data/m0-probe/diag/*.json` from the overwrite probe. Delete `data/m0-probe/` after the gate passes. The real app will not read it.

## Next integration actions (in order)

1. **Run the two-account check** (the M0 list above, using Diagnostics, then the real flow). Nothing that writes or syncs has been tested.
2. ~~Import T1 to T5 and C1 to C5~~ Done.
3. ~~Re-run the in-app self-check with C2's real parser~~ Done: 22 of 22.
4. ~~`decodeRecord` adapter~~ Done (`wiring/appRepository.ts`).
5. ~~Create `App.tsx` and replace the probe `home.tsx`~~ Done.
6. **Real flow with two accounts**, in order: A saves preferences; Setup, A sets self as organiser; A and B both join an activity (counts and names update on both sides); both vote; A opens Confirm, picks a time and a public meeting point, confirms; both open the plan and mark going; reopen the app and confirm everything persists. Record each result here.
7. **O2's final review** after a code freeze, then incorporate accepted fixes.
8. Before the demo: recheck the seed dates (6 to 21 Nov 2026), delete `data/m0-probe/`, and rehearse with `Planning/Demo script.md`.

## Dependency status (as seen in the library at this write)

| Agent | Needed for | Present? |
| --- | --- | --- |
| O1 | Architecture | Yes |
| G1 | Contract and types | Yes (`types.ts`, `data-contract.ts`, `ui-contract.ts`, `paths.ts`) |
| T3 | `domain/identifiers.ts` (imported by `paths.ts`) | **Yes, imported** |
| T1, T2, T4, T5 | validation, selectors, consensus, plan rules | **Yes, imported** (T1 patched) |
| G2 | repository | Yes, wired in `App.tsx` via `wiring/appRepository.ts`. S1 fixed `listed()` (see "App wiring"). Writes untested. |
| G6 | seed data | Yes (`data/*.json`, decodes cleanly with T1) |
| S2 | `styles.css`, `components/ui.tsx` | Yes, in use |
| C2 | `londonTime.ts` (`parseInstant`, `formatLondonDateTime`) | **Yes, imported** |
| C1, C3, C4, C5 | source badges, cost, avatar, availability | **Yes, imported** (C1 patched) |
| G3 | `useMytData` | Yes, wired. Complemented by `useParticipation` for the all-activity and all-plan data it does not load. |
| G4, G5, G9, G7, G10 | ranking, presence, action state, preview, plan summary | Yes, all wired. G8's `qa/domain-checks.ts` is not wired and was not run by S1. |
| S3 to S10 | screens and panels | Yes, all wired (S9's optional extras are supplied). |

## Known limits

- The Diagnostics (M0) view uses inline `var(--lf-*)` styles because `styles.css` is S2's file.
- Render sessions cannot test writes or multiplayer. The M0 write path is therefore untested until the human check.
- No cross-device guarantee for single plan creation; organiser-only controls are a convention. See `Concurrency review.md`.
