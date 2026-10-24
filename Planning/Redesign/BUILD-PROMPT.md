# Prompt: build the MYT redesign

Paste everything below the line into ChatGPT (or Codex), with the whole `MYT` folder attached or connected.

---

You are a senior React + TypeScript engineer working on **MYT**, a Lightfern app that helps London university students find something to do (football, karting, cinema, gigs, socials…) and find other students to go with. I've attached the whole `MYT` folder. Your job is to (1) restyle the existing app to match a new design, and (2) build the new features that the design adds. Work in phases, and make sure each phase type-checks before you start the next.

## 1. Read these first, in this order

1. `Planning/Architecture.md`: data layout, identity rules, module boundaries. These rules are binding.
2. `Planning/Contract.md`: frozen TypeScript interfaces and file paths.
3. `Planning/Design.md`: the current class catalogue and the accessibility rules for screens. Keep the rules and replace the look.
4. `Planning/Integration.md`: how `App.tsx` wires everything, what has been verified, and known issues.
5. `code/manifest.json`, `code/src/host.ts` (the only module that imports the `lightfern:host` SDK), `code/src/App.tsx`, `code/src/types.ts`, `code/src/data-contract.ts`, `code/src/ui-contract.ts`, `code/src/paths.ts`, `code/src/data/repository.ts`, `code/styles.css`, and `code/src/components/ui.tsx`.
6. **The design: `Planning/Redesign/screens/*.dc.html`** (described in section 2).

Don't change the architecture rules without saying so. In particular:
- Every participant only ever writes files keyed by their own `currentUser.id`.
- Use `keyForId()` for every ID in a path.
- Write compact JSON with `schemaVersion: 1`.
- Never delete files. Withdrawing or cancelling writes a status instead.
- Sample profiles (`sample:` IDs) are never counted, and are always labelled as fictional.
- Only `host.ts` touches the SDK.
- Screens are prop-driven.

## 2. How to read the design files

Each `.dc.html` file is one 390×844 phone screen from a design tool. Treat each one as a **visual and behavioural spec, not code to paste in**:
- **Markup** sits inside `<x-dc>…</x-dc>`. Inline `style="…"` gives the exact sizes, spacing, radii and colours.
- **CSS and animations** sit in `<helmet><style>`. Every `@keyframes` there is part of the design, and every animation is switched off under `prefers-reduced-motion`.
- **Templating:** `{{ name }}` is a value bound from the script, `<sc-for list=… as=…>` is a loop and `<sc-if value=…>` is a conditional.
- **Behaviour** is in the `<script type="text/x-dc">` class: `state`, `renderVals()` and its handlers. It shows exactly what each interaction does (e.g. swipe thresholds, the poll vote rules, how the tab pill moves).
- The files reference `./support.js`, which isn't included, so they won't render on their own. Read the source.
- `canvas.json` lists the screens and their titles.

| Design file | Screen | Status |
| --- | --- | --- |
| `Onboard1.dc.html` | Sign up: first name, uni email, animated "myt" mark | new (onboarding step 1/5) |
| `Onboard2.dc.html` | Pick university + year of study | new (2/5) |
| `Onboard3.dc.html` | Free-time grid (7 days × daytime/evening) + usual spend | new (3/5) |
| `Main.dc.html` | Welcome + pick interests | restyle of current Onboarding (4/5) |
| `Onboard4.dc.html` | "Finding your people" matching animation, then Discover | new (5/5) |
| `Discover.dc.html` | Search with radar "searching" animation, interest filter chips, activity cards | restyle of `screens/Discover.tsx` + new free-text search |
| `Activity.dc.html` | Activity detail: who's in, time vote, "I'm interested", Group chat button | restyle of `ActivityDetail.tsx` + `InterestPanel`, `TimeVotePanel`, `CompanionList`, `PresenceStrip` |
| `Plans.dc.html` | My plans: confirmed-plan ticket, voting, waiting, Upcoming/Past tabs | restyle of `MyPlans.tsx` / `PlanSummary.tsx` |
| `Meet.dc.html` | Swipe cards of other students: right = friend request, left = pass | new |
| `Requests.dc.html` | Friend requests: received / sent, accept / not now / undo, "going to the same plans" | new |
| `Chats.dc.html` | Chats list: All / Groups / Friends, activity group circles, "you've been added" banner, unread, typing | new |
| `GroupChat.dc.html` | Activity group chat: pinned plan, messages, quick replies, **+ menu → poll builder**, votable polls | new |

`ConfirmPlan.tsx` and `Setup.tsx` have no new mock. Restyle them with the same tokens and components so they match.

## 3. Design system to implement

Put these in `code/styles.css` as `--myt-*` custom properties and use them everywhere. Don't scatter hex values through the components.

- **Ground and surfaces:**
  - background `#14111C`
  - surface `#1F1A2B`
  - raised surface `#2A2439`
  - line `#352E47`
  - dashed/disabled `#4A4160`
- **Text:**
  - main text `#F5F2FA`
  - muted `#A9A1BC`
  - faint `#7E7694`
- **Accent:** lime `#D4FF4F`, with text `#14111C` on it. Primary buttons have a solid lower shadow `0 6px 0 #8FB32A`.
- **Interest colours** (always paired with an icon or label, never colour alone):
  - football `#6EA8FF`
  - karting `#FF9A4D`
  - cinema `#C79BFF`
  - music/gigs `#FF6FA8`
  - social `#4FE3C1`
  - theatre `#FFD24F`
  - Pick sensible colours for fitness and comedy.
- **Type:** "Bricolage Grotesque" (700/800) for display text and "DM Sans" (400–700) for body text, from Google Fonts. Check whether Lightfern allows external font loading. If it doesn't, bundle the fonts or fall back to a system stack, and tell me which you did.
- **Shape:**
  - cards: 20–30px radius
  - chips: fully rounded
  - minimum touch target: 44px
  - floating bottom tab bar: 66px tall, 24px radius
- **Motion:** port the keyframes from the design files, keeping them named and reusable (rise, pop, shimmer, ring, orbit, ticker, flip, confetti, typing dots, slide-in sheet…). Add one global `@media (prefers-reduced-motion: reduce)` rule that turns them all off.
- **Light mode:** the design is dark-first. Keep it working inside the Lightfern host, and tell me whether you also mapped a light theme.

Update `components/ui.tsx` (Button, Chip, Panel, Field, SectionHeader, etc.) to the new look, and add the components these screens need:
- `TabBar`
- `BottomSheet`
- `Switch`
- `Avatar` / `AvatarStack`
- `ProgressSteps`
- `Toast`
- `SegmentedTabs` with a sliding pill
- `PollCard`
- `ChatBubble`
- `SwipeCard`

Update `Planning/Design.md` to describe the new system.

## 4. Navigation

Replace the header nav with the floating bottom **tab bar**: Discover / Meet / Chats / Plans. Chats shows an unread badge, the active tab is a lime pill, and the profile is reached from the avatar on Discover. Onboarding runs Sign up → Uni → Free time → Interests → Matching → Discover. Show it once, until a profile is saved, and keep a way to edit preferences later.

## 5. New features and data

Follow the existing pattern for each feature:
- add types to `types.ts`
- add validators to `domain/validation.ts`
- add path builders to `paths.ts`
- add repository methods
- load data through `useMytData` or `useParticipation`
- pass props to the screens

Propose any schema change in `Contract.md` before you code it. Below is a suggested data model. Improve it if you find a problem, but explain why.

### 5.1 Richer profile (onboarding)
- Extend `Profile` with:
  - `universityId`
  - `yearOfStudy` (`"1" | "2" | "3+" | "postgrad"`)
  - `freeSlots` (e.g. `"mon-day" | "mon-eve" | …`)
  - `budgetBand` (`"free" | "u15" | "u30" | "any"`)
  - keep `interestIds`
- Derive the existing `AvailabilityKey`s from `freeSlots`, so matching keeps working.
- Bump the schema version, or make the new fields optional, and decode old profiles safely.
- **Uni email:** the app has no backend for sending codes. Don't fake verification. The signed-in Lightfern user is the identity. Keep the email field as optional display info, or drop it, and tell me what you chose. Never show the email to other students.
- University list: a static list in code (the London unis in the design, plus "Other").
- The matching screen (`Onboard4`) is a short animated transition. Its three ticks can finish once the data has loaded. Don't add an artificial wait of more than about 2.5s.

### 5.2 Search on Discover
Free-text search over title, area and interest. The radar "searching" state shows while results load or recompute (at least ~600ms, so it doesn't flash), then the cards stagger in. Keep the existing ranking reasons and the source badges ("Verified", "Group idea", "Check listing").

### 5.3 Meet (swipe) and friends
- **Candidates:**
  - Real profiles other than me, ranked by shared interests and overlapping free slots (reuse `domain/matching.ts` ideas).
  - Exclude anyone already a friend, already requested, or blocked.
  - Then sample profiles, clearly marked **"Sample"/"Fictional"**, which can never be friended.
- **Cards** show name, university, shared-interest chips, a free-time summary, and one activity they're interested in.
- **Swipe interaction:**
  - drag with pointer events
  - "ADD"/"PASS" stamps fade in as you drag
  - a fling past 110px commits; anything shorter snaps back
  - buttons do the same, for keyboard and screen-reader users
- **Friend requests**, one file per writer:
  - `data/friends/requests/k(fromId)/k(toId).json`, written by the sender, `{ status: "pending" | "cancelled", createdAt }`.
  - `data/friends/responses/k(toId)/k(fromId).json`, written by the recipient, `{ status: "accepted" | "declined", respondedAt }`.
  - Friends = a pending request with an accepted response, in either direction.
  - "Not now" = declined. The sender still just sees "Waiting for a reply"; never tell them they were declined. Undo rewrites the response.
- **Passes** are private to me: `data/meet/k(me).json` `{ passedIds: [] }`.
- **Requests screen:**
  - Received and Sent tabs.
  - Accept shows "You're friends now" with a "Say hi" button that opens the DM.
  - "Going to the same plans" suggests people who are interested in the same activities.
- **Safety (must have):**
  - "Block" on profile cards and in chat. Store it privately at `data/blocks/k(me).json`; it hides that person from Meet, Requests and DMs for me.
  - "Report" can be a placeholder that explains it isn't connected yet.
  - Never show emails.
  - Meeting points must be public places, as the existing plan rules already say.

### 5.4 Chats
- **Activity group chats:** one per activity. **Membership is derived, not stored.** It's every real user whose latest interest record for that activity is `interested`. Tapping "I'm interested" adds you automatically, and withdrawing removes you. Show the "You've been added to a group" banner the first time you appear in a group.
- **Direct messages:** only between friends. Chat ID `dm:<smaller id>|<larger id>`.
- **Messages**, one file per message, written only by its author:
  - Path: `data/chats/k(chatId)/messages/k(authorId)/k(messageId).json`.
  - Fields: `{ schemaVersion, id, chatId, authorId, kind: "text" | "poll", text?, poll?, createdAt }`.
  - Sort by `createdAt`, then `id`. Use the existing `data/` watcher for live updates, and debounce it.
  - Text limit: 1–1000 characters, trimmed.
  - Only members can read or post in the UI. Note honestly that collaborators with file access could still read the files.
- **Read state:** `data/chats/k(chatId)/read/k(me).json` `{ lastReadAt }` drives the unread counts on the list and on the Chats tab.
- **Typing indicator:** use multiplayer presence in the existing room `myt-v1`. Extend the presence payload with `typingIn: chatId | null`, clear it after 4s of no input, and exclude me.
- **Chats screen:**
  - All / Groups / Friends tabs.
  - Activity-group circles with a spinning ring when there's something unread.
  - Rows showing the last message, time and an unread badge.
  - An empty state.
- **Group chat screen:**
  - Header with the activity colour and icon, member count and online count from presence.
  - A pinned plan banner when a plan is confirmed, linking to it.
  - Quick-reply chips.
  - Message box and send.
  - Auto-scroll to the newest message.
  - The Activity screen shows a "Group chat" button once you're interested.

### 5.5 Polls in chat (the + button)
- A **+** button sits left of the message box. It rotates into an × and opens a bottom sheet called **"Add to chat"** with these tiles:
  - **Poll**
  - **Time poll**: the same builder, prefilled with the activity's time options and with multiple answers on
  - **Meet-up spot** and **Photo**: show them disabled with "Coming soon"
- **Poll builder:**
  - a question (1–80 characters)
  - 2–6 options (1–40 characters each), with add and remove
  - switches for "Allow more than one answer" and "Anonymous votes"
  - the post button stays disabled, with a helper label, until it's valid
- A poll is posted as a message with `kind: "poll"` and `poll: { question, options: [{ id, label }], multi, anonymous }`. Polls are immutable once posted.
- **Votes**, one file per voter: `data/chats/k(chatId)/polls/k(messageId)/k(voterId).json` `{ optionIds: string[], updatedAt }`.
  - Single-choice: tapping your current choice clears it (empty array).
  - Multi-choice: toggles.
- **Display:**
  - bars fill as percentages
  - "N votes · Pick one/Pick any · Anonymous"
  - your own poll shows on the right with a lime border and a "NEW POLL" sticker when it's just posted
  - non-anonymous polls let you tap the count to see who voted
  - anonymous polls show totals only in the UI (be honest in the copy that it's a display setting)

## 6. Quality bar

- **Accessibility:** keep `Design.md`'s rules:
  - real `<button>`, `<a>` and `<input>` + `<label>`
  - one `h1` per screen
  - `aria-pressed` / `aria-checked` / `role="switch"` / `role="tab"` where the design uses them
  - text contrast ≥ 4.5:1
  - focus outlines visible on the dark background
  - the swipe works with buttons alone
  - the bottom sheet traps focus and closes on Escape
- **Motion:** respect `prefers-reduced-motion` everywhere.
- **Layout:** no horizontal scroll at 390px wide. Check the tab bar doesn't cover content (pad scroll areas).
- **States:** loading (skeletons with shimmer), empty, error and signed-out (read-only, with "Sign in to join"). Preview mode stays explicit and never writes.
- **Copy:** keep it honest. Group ideas aren't bookings, votes are advice, and "Saved" means saved on this device.
- **Types:** run `tsc --strict` over `code/src` (see how `Integration.md` does it). It must pass with no new `any` and no casts that hide mismatches.
- **Tests:**
  - Add domain tests next to `code/src/qa/domain-checks.ts` for friend status, chat membership, unread counts, poll validation and vote tallies (single vs. multi, clearing, anonymous).
  - Extend `Planning/Checks/e2e-flow.cjs.txt`'s in-memory two-account flow: request → accept → DM, join activity → appear in group, post poll → vote → change vote.
  - Run them and report the pass counts.

## 7. How to work and what to give back

1. First reply with a short plan:
   - phases
   - files you'll add or change
   - your final data model (section 5), with any changes you made to my proposal
   - open questions
   
   Then go ahead unless something is blocking.
2. Suggested phases:
   1. design tokens + ui components + tab bar
   2. restyle existing screens
   3. onboarding + profile schema
   4. search
   5. friends + Meet + Requests
   6. chats + group chat
   7. polls
   8. tests + docs
3. After each phase: type-check, list the files changed, and note anything you couldn't verify. In particular, real two-device sync and presence can only be tested inside Lightfern with two signed-in accounts. Say so; don't claim it works.
4. Keep `Contract.md`, `Architecture.md`, `Design.md` and `Integration.md` up to date with what you built.
