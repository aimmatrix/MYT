**Owner:** O1. This review covers races, failure cases and their limits for version 1. It is an architecture review: no code exists yet and no checks have been run.

## What the platform does and does not guarantee

From the guides:
- Writes are per file. `overwrite: false` rejects if the path is already taken **on this device**.
- Files sync to collaborators "usually a few seconds later". When two saves of the same JSON file meet, Lightfern merges them **field by field**, and for the same field the **last save to sync wins**.
- Watchers fire for your own writes and for synced arrivals.

Not documented, so not assumed:
- cross-file transactions
- a compare-and-swap that holds across devices
- a "synced to others" signal
- atomicity of two simultaneous `overwrite: false` calls in the same host

Presence:
- It is not durable.
- Each view (tab or device) is a separate peer.
- A disconnected peer can linger for up to 30 seconds.
- It always reads as disconnected in render sessions and the public share viewer.

## Case table

| # | Case | What happens | Mitigation in version 1 | Owner | Residual limit |
| --- | --- | --- | --- | --- | --- |
| 1 | Double-click on join, vote or going | Two identical writes to the same own file | G9 disables the control while pending. The write is an idempotent upsert of the same path, so a duplicate is harmless. | G9, G2 | none |
| 2 | Double-click on Confirm | The second write hits an existing file | G9 pending guard. `overwrite: false` → `already-exists` → G2 reads and returns `{ kind: "existing" }` | G9, G2 | none on one tab |
| 3 | Organiser confirms in two tabs on one device | Both read "no plan" and both write | Host likely rejects the later `overwrite: false` (**VERIFY**: atomicity is not documented). The loser gets `existing` and opens it. | G2 | If both pass, last-writer-wins on one local file: one consistent record survives |
| 4 | Organiser confirms on two **devices** with different choices | Both writes succeed locally. On sync, the field merge can mix `chosenOptionId` from one with `meetingPoint` from the other. | Single organiser on a single device is a demo rule (S1 setup copy). T1 decoder: if `startAt`/`endAt` disagree with the activity's option `chosenOptionId`, return `invalid-record` with the message "Plan details conflict"; S8 or the plan view shows it instead of a wrong time. | S1, T1, S8 | A mismatched meeting point cannot be detected. A production version needs a transactional backend or a server-assigned sequence. |
| 5 | Non-organiser attempts confirm | — | UI hides confirm (S8); T5 returns `not-organiser`; G2 rechecks against a fresh `session.json`. | S8, T5, G2 | Not access control: a collaborator can edit files directly |
| 6 | Two people set themselves as organiser at once | Field merge, last writer wins | Setup is done once, deliberately, before rehearsal. The setup screen always shows the current organiser after sync. | S1 | Verify the organiser on both screens before the demo |
| 7 | Same user, two tabs, different interest or vote | Same file, last write wins | Acceptable: one person's own choice. Presence dedupe by `user.id` hides the extra tab. | G5 | Brief disagreement between tabs until the watcher fires |
| 8 | Withdraw while a teammate counts votes | Vote file stays | T2 and T4 count votes only from users whose latest interest is `interested`. No one else's file is touched. | T2, T4 | none |
| 9 | Vote cleared | `optionId: null` | T4 treats null as a cleared vote with no fallback | T4 | none |
| 10 | Interest or vote after a plan exists | Late writes from a stale view | UI freezes those controls when the plan exists. A late record is harmless because the plan is immutable and tallies are advisory. | S5–S7 | none |
| 11 | Out-of-order reads (fast route or user switch) | An older read resolves last | G3 keeps a generation counter per (user, activity) scope and drops stale results. It cleans up watchers on unmount or user change. | G3 | none |
| 12 | Read-after-write | The watcher fires after the write resolves | On `ok`, G3 may apply the written record immediately (it is what is on local disk), then let the watcher confirm. Status copy says "Saved", never "Synced". | G3, G9 | No way to know when collaborators received it |
| 13 | Partially synced or malformed JSON | Parse fails | Per-file `RecordIssue`; the record is excluded; other records stay. Retried on the next `changed`. A catalog or session failure gives an error panel with Retry, never an empty feed. | T1, G2, G3 | A malformed own file blocks that user's action until rewritten. Saving again overwrites it. |
| 14 | Missing folder (`interests/k(a)` before anyone joins) | `list` behaviour on a missing path is undocumented | List the parent. If the child is absent, return an empty collection. Any other error is `io`. | G2 | **VERIFY** the actual behaviour at M0 |
| 15 | First record appears in a new folder | Watcher on `data/` subtree gets `created` | G3 re-lists that folder | G3 | none |
| 16 | Offline write | A local write probably succeeds and syncs later (**VERIFY**) | Show "Saved"; show presence `connected: false` as "Live view offline", not "No one here" | G5, G9 | Collaborators see it only after reconnecting |
| 17 | Disconnected peer | Lingers for 30 seconds | Viewing is informational; it never feeds counts | G5 | A stale "viewing" label for up to 30 seconds |
| 18 | Presence from a buggy or old client | Arbitrary JSON | G5 validates `{ v: 1, screen, activityId }` and ignores anything else; render as text only | G5 | none |
| 19 | Plan time in the past at demo time | Option expired | T5 blocks new confirmation; attendance "going" blocked after start; G6 picks options at least 7 days after the demo date | T5, G6 | Re-check seed dates the day before |
| 20 | Signed out | `currentUser` null | Read-only and "Sign in to join"; no write callbacks; never a made-up ID | G3, S1 | none |
| 21 | Preview masking a live failure | — | Preview only through an explicit toggle and banner. A live error shows an error panel. | S1, G7 | none |
| 22 | Unsafe ID in a path | `../`, `/`, control characters | T3 hex encoding. `paths.ts` is the only path builder; an invalid ID returns `id-invalid` before any I/O. | T3, G1 | none |
| 23 | Unsafe source URL | A `javascript:` link in seed data | C1 renders links only for `https:` URLs; anything else shows as plain text | C1 | none |

## What would need a backend in production

- Single-winner plan creation across devices (compare-and-swap or a server-side unique constraint).
- Organiser authority that collaborators cannot bypass by editing files.
- Private messaging, and any data a collaborator should not read.
- A trustworthy "delivered to the other person" signal.

The demo script must not imply any of these.

## Honest demo framing

Say: "Each person's choices are saved as their own files in the shared app, so two people can act at once without overwriting each other. Live presence shows who is looking right now; saved interest and attendance are separate and survive closing the app."

Do not say: "real-time sync", "guaranteed", "booked" or "private".
