**Owner:** G8. **Status:** deterministic checks authored; execution awaits C2/C3/C4 integration and a reachable QA entry. This report distinguishes observation from a proposed check.

## Automated checks

`code/src/qa/domain-checks.ts` exports `runChecks(): Promise<CheckResult[]>`. It imports the production ranking, participant selectors, vote consensus, plan rules, identifiers, time parser, decoder and repository. The checks are never called during ordinary app startup. Each result names a pass or failure, with a detail for failures.

Coverage:
- London autumn clock change on 25 October 2026: the two explicit `01:30` offsets are one hour apart, an offset-free time is rejected, and ranking keeps only the later future occurrence.
- Shared interest ordering; zero pence versus unknown cost, with no false budget-fit reason for unknown cost.
- Withdrawn and sample interests excluded; a withdrawn user's vote ignored; invalid option excluded; fictional attendance excluded.
- Encoded ID round-trip and byte limit; organiser confirmation requires two real interested people and a valid option.
- In-memory `MytFilePort`: rejected write returns `io` without writing; two users write separate interest files; duplicate plan confirmation returns `existing` and writes once with `overwrite: false`; a conflicting duplicate cannot replace the plan.

**Execution:** These checks have **not run**. The QA file is not imported by the current M0 entry. `domain/matching.ts` currently imports missing `domain/cost.ts`, `domain/availability.ts` and `domain/londonTime.ts`; C2's parser is also a direct QA dependency. Running a stand-in would not test the final modules. Once those files arrive, S1 can temporarily import `runChecks` into an isolated QA invocation in the app build, display its returned results, then remove that invocation. Do not leave it in normal startup. A TypeScript-capable export of the same app code is another valid route. Count and report actual passes only after invocation.

## Render observation, 24 October 2026

Called `render_app` on `MYT` at 800 × 900 and waited 1.2 seconds for async loading. Status was `ok`; console reported a screenshot and no error. The screen displayed the M0 proof card from `data/activities.json`, “0 interested,” signed-in account, and “Live presence: not connected.” It displayed “22 of 22 passed” for S1's earlier integration self-check. This observation verifies the M0 view and S1's visible self-check outcome only. It does **not** execute `runChecks`, save a file, prove peer presence, or verify a finished product screen.

The live product flow was not available in the entry: `home.tsx` is still the M0 probe, and `App.tsx` has not been created. That is the current integration gate, not a new UI bug.

## Two-account rehearsal script

Use two distinct signed-in accounts, A and B, with access to the **same shared MYT app folder**. Record each result as pass, fail with steps, or untested in `Planning/Integration.md` or the final review. Do not count a render session or a copied app as a second participant.

1. Open the same activity on A and B. Verify both presence indicators connect and each sees the other as a viewer. On A, open a second tab with the same account; B must still count A once. Close both A tabs; B's viewer clears, while saved interest stays.
2. On A, complete onboarding and reopen. Check that preferences persist. On B, complete onboarding separately. Verify seeded profiles are labelled fictional and neither appears as a live viewer.
3. A clicks “I'd go with someone.” B observes A in the interested list after file sync, with no automatic “going” label. B joins; both see two distinct real interested people. Repeat a join click and ensure there is no duplicate. A withdraws, and B sees one interested person; rejoin before continuing.
4. A and B select different time options. Both choices persist and remain attributed to the correct account. A clears a vote; the tally drops only A's choice. A withdrawn participant's old vote must not count.
5. Set A as organiser in the explicit setup flow. From B, attempt to confirm and expect a readable denial. From A, confirm a future option and public meeting point. Repeating confirmation should open the existing plan, never replace it. Confirm that a vote alone did not create a plan.
6. A and B independently mark “I'm going.” Each action changes only its own attendance record. Close and reopen the app on both accounts; the same confirmed time, meeting point and going list must appear under My plans. Mark B “Can't go”; A's going status must remain.
7. Disconnect one account after saving interest. Presence should become disconnected/unknown, while interest remains saved. Retry after reconnect and verify the other account sees the saved record.
8. Trigger a failed write with a controlled file-port rejection or documented test hook. The UI must show an error and a retry path, and must not announce “Saved.” Avoid altering shared demo records solely to provoke a failure.
9. Place one malformed participant JSON file in a disposable test activity folder through a controlled fixture. Valid participants must still load and an issue must be shown. Remove the fixture after the check. A malformed required catalog should produce an error, never an empty success state.

## Actual outcomes and issues

| Area | Outcome | Evidence |
| --- | --- | --- |
| M0 render and async load | Observed pass | `render_app`, 800 × 900, 1.2-second wait, no console errors |
| G8 `runChecks` | Untested | Missing C2/C3/C4 and no QA invocation |
| Repository write behavior | Untested | In-memory checks authored, not executed; real SDK writes require live app |
| Two-account presence and file sync | Untested | Requires two signed-in accounts in same shared app |
| Full journey and reopen | Untested | Product `App.tsx` not integrated |
| Observed new bugs | None confirmed | No failed G8 check or live journey executed |

The M0 render is read-only. It cannot establish that real writes, remote sync or multiplayer work.
