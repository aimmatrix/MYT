# MYT student redesign — 24 October 2026

The current visual reference is the supplied **MYT Student Redesign.html**, a self-contained 12-screen export. Its decoded templates match the screen set under `Planning/Redesign/screens`. Earlier implementation notes below are historical where they conflict with this section.

## Tokens and typography

`code/styles.css` defines `--myt-background` (#14111C), surface (#1F1A2B), raised (#2A2439), line (#352E47), disabled (#4A4160), text (#F5F2FA), muted (#A9A1BC), faint (#7E7694), accent (#D4FF4F) and button shadow (#8FB32A). Eight interest hues are paired with visible icons/labels. Existing `--lf-*` variables map locally to these tokens so confirmation, setup, participation and plan screens inherit the redesign. Meaningful small text uses muted rather than the lower-contrast faint token.

Bricolage Grotesque display weights 500–800 and DM Sans body weights 400–700 are bundled as WOFF2 files in `code/fonts/` (extracted unchanged from the supplied export, original Unicode ranges) and referenced relatively from `styles.css`; Lightfern's frame CSP blocks `data:` fonts. `tools/build-demo.cjs` inlines them for the single-file demo. No external font requests. System fonts cover characters missing from the supplied subsets. Licenses are in `code/FONT-LICENSES.txt` and embedded in the portable demo. External font loading inside Lightfern was not established and is unnecessary. The app stays dark even in a light host; no separate light palette was mapped.

## Components and navigation

Shared primitives are in `components/ui.tsx`: Button, ButtonLink, Chip, Panel, Field, SectionHeader, Icon, Wordmark, Avatar, AvatarStack, TabBar, BottomSheet, Switch, ProgressSteps, Toast, SegmentedTabs, ChatBubble and SwipeCard. PollCard lives in `components/PollCard.tsx`.

Cards have 20–30px radii, controls at least 44px, and the floating four-tab bar is 66px tall with a 24px radius. Tab icons and active lime fill follow the export. Profile preferences open from the top avatar; setup, diagnostics and explicit read-only preview are under App tools on the preferences screen. The bar is omitted on onboarding and in an individual chat so it cannot cover the composer. Scrollable pages reserve bottom padding.

Onboarding is sign up → university/year → free slots/budget → interests → matching. The email check is deliberately simulated at the user's request: code 123456, no email sent, and no email persisted. Returning profiles can edit preferences. Matching adds only a 900ms transition after a successful profile save.

Discover retains ranking reasons and source provenance, adds text search and a 600ms radar state, and reveals cards in batches of 12. My plans has Upcoming/Past segments. Activity detail uses the interest icon in a coloured hero and exposes its group-chat entry next to the interest controls.

Meet supports pointer dragging with a 110px commit threshold, ADD/PASS stamps, snapback and equivalent buttons. Samples are visibly fictional and cannot be friended. Requests distinguish received/sent, support accept/not now/undo/cancel, and never reveal a decline to the sender. Chats provides All/Groups/Friends, unread counts and group shortcuts. Group chats expose public-meeting guidance, a confirmed-plan link, quick replies, a composer and poll/time-poll builders; photo/meet-up tiles are disabled.

## Accessibility and motion

Native labelled form controls; one primary heading per normal screen; visible focus rings; aria-pressed toggles; switches with aria-checked; keyboard Arrow/Home/End segmented tabs. Native modal dialogs provide focus trapping, Escape dismissal and focus restoration. Swipe actions are available without gestures. Poll choices expose selected state and percentages as text. Anonymous-vote copy explains that underlying shared files identify voters.

Named keyframes were ported from the export (including rise, pop, shimmer, ring, orbit, ticker, flip, fall, typing, sheet, stamps and directional entries). The final reduced-motion rule disables animation, transitions and smooth scrolling for the app. Motion never gates a write.

The portable demo is generated from the same React source, with an isolated local-storage file adapter and a persistent fictional-data banner. It is distinct from the host app's explicit preview mode, which remains read-only.

---

## Historical class catalogue and accessibility notes

**Owner:** S2 (sole editor of `code/styles.css`, `code/src/components/ui.tsx`, this file). Other agents request new selectors in their own handoff; S2 or S1 adds them.

MYT looks like a friendly planner, not a Lightfern tool: warm copy, roomy cards, one calm accent, and a small local illustration language (coloured tiles with initials, not fetched images). Everything uses Lightfern's `--lf-*` tokens, so light and dark follow the app theme. The only extra palette is three interest hues plus a "warn" hue, defined once at the top of `styles.css`.

## Rules for screen authors

1. Wrap the whole app in `<div className="myt-app">` (S1 does this once). Never set page padding or width yourself.
2. Compose from the classes and controls below. Do not add inline colours, hex values, fixed heights or your own `box-shadow`. If something is missing, build it from `myt-stack` / `myt-cluster` and list the selector you want in your handoff.
3. No `<form>` elements. Use `fieldset` + `legend` for groups of chips or radios (`myt-fieldset`).
4. One primary action per panel or screen (`variant="primary"`). Secondary actions use the default variant, small or low-priority ones use `quiet`, withdrawing or declining uses `danger`.
5. Never rely on colour alone: selected chips show a check mark, and sample profiles carry a "Fictional" chip as well as a dashed edge.
6. Heading order: one `h1` per screen (use `SectionHeader level={1}`), panels use `h2`, items inside panels `h3`.

## Controls (`code/src/components/ui.tsx`)

All are named exports. They are presentation only.

| Export | Props that matter | Notes |
| --- | --- | --- |
| `Button` | `variant` (`primary` \| `secondary` default \| `quiet` \| `danger`), `size` (`md` \| `sm`), `pending`, `fullWidth`, plus normal button props | Always `type="button"`. `pending` shows a spinner, ignores clicks, sets `aria-busy` and keeps focus. The label stays in the DOM, so the accessible name never changes. Tell people what is happening in nearby text (G9's feedback). `aria-current="page"` on a quiet button styles it as the current nav item. |
| `ButtonLink` | `href`, `variant`, `size`, `fullWidth` | An `<a>` styled as a button. Opens in the user's default browser (`target=_blank`, `noopener noreferrer`). For "View original event". |
| `Chip` | `tone`, `selected`, `onSelectedChange`, `disabled`, `title` | No `selected` or handler: static label span. With either: a toggle `<button aria-pressed>` with a check mark when selected. Keyboard: Tab, Space, Enter. |
| `ChipGroup` | `label` | `role="group"` with an accessible name around toggle chips. |
| `Panel` | `title`, `description`, `actions`, `headingLevel` (2 default), `variant` (`card` \| `quiet`), `tone`, `as`, `aria-label` | Card with optional header. With a `title` it is a labelled region. `tone` adds a coloured left edge. |
| `Field` | `label`, `hint`, `error`, `required`, `optional`, `disabled`, `control` (`input` \| `textarea` \| `select`), `type`, `value`, `onChange(value: string)`, `placeholder`, `maxLength`, `rows`, `inputMode`, `autoComplete`, `options` | `<label htmlFor>` bound to the control. `hint` and `error` are linked with `aria-describedby`; `error` also sets `aria-invalid`. `required` adds a visible asterisk and `aria-required` (no native validation). For a custom control pass a render function as `children` and spread the supplied `FieldControlProps` on the focusable element. |
| `SectionHeader` | `title`, `eyebrow`, `description`, `actions`, `level` (1, 2 or 3), `size` (`page` \| `section` \| `small`) | Level controls the heading element, `size` the look (defaults follow level). Actions wrap under the title when narrow. |
| `Wordmark` | none | MYT mark and name. S1 puts it in the header. |
| `ActivityMark` | `interestId`, `title`, `size` (`sm` \| `md` \| `lg`) | Local tile: interest colour and pattern with the title's initials. Decorative (`aria-hidden`), so always show the title as text next to it. |
| `cx` | strings | Class name joiner. |

`Tone` is `neutral | accent | success | danger | warn | football | karting | cinema`. Use the interest tones only for the matching `InterestId`; use `success` for "Verified event", `warn` for "Demo activity idea", "Unverified", "Estimate" and "Fictional", `accent` for "You".

G9's feedback components, G5's presence strip, S10's people list and C4's avatar are separate files. Their markup should use the classes below.

## Class catalogue

Prefix is always `myt-`. Layout tools:

| Class | Use |
| --- | --- |
| `myt-app` | Root wrapper. Max width 1040, responsive padding, 15px type. |
| `myt-header`, `myt-nav`, `myt-who` | Top bar: `Wordmark` left, nav of quiet small Buttons and the signed-in name right. Wraps on narrow screens. |
| `myt-main` | Page content column with section spacing. |
| `myt-stack` (`--xs`, `--sm`, `--lg`) | Vertical rhythm. Default gap 12px. |
| `myt-cluster` (`--between`, `--end`) | Wrapping horizontal group. |
| `myt-actions` | Row of buttons. Becomes a full-width column under 640px. |
| `myt-banner` + `data-tone`, `myt-banner__text`, `myt-banner__title` | Page notice with a coloured left edge, for example preview mode or setup needed. Put a small Button after the text. |
| `myt-muted`, `myt-subtle`, `myt-small`, `myt-strong`, `myt-nowrap`, `myt-clamp-2`, `myt-wrap-anywhere`, `myt-link`, `myt-lede`, `myt-eyebrow`, `myt-visually-hidden` | Text helpers. |
| `myt-heading`, `myt-heading--page`/`--section`/`--small`, `myt-section-header*` | Emitted by `SectionHeader`. |
| `myt-fieldset`, `myt-form-grid`, `myt-span-all` | Form layout. Two columns, one column under 640px. Add `myt-span-all` to a grid child to span both. |

### Welcome and preferences (S3)

```
<div className="myt-welcome">                     two columns, one under 860px
  <div className="myt-hero">
    <SectionHeader level={1} eyebrow=… title="Find something to do. Find someone to go with." />
    <p className="myt-lede">…</p>
    <ul className="myt-hero__points"><li>…</li></ul>
  </div>
  <Panel title="Your preferences">
    <div className="myt-form-grid"> <Field …/> <div className="myt-span-all"><fieldset className="myt-fieldset"><legend>Interests</legend><ChipGroup label="Interests">…</ChipGroup></fieldset></div> </div>
    <div className="myt-actions"><Button variant="primary">Find activities</Button></div>
  </Panel>
</div>
```

### Discover (S4)

```
<div className="myt-stack myt-stack--lg">
  <SectionHeader level={1} title=… description=… actions={<Button>My plans</Button>} />
  <div className="myt-filters">
    <div className="myt-filters__row"><span className="myt-filters__label">Interests</span><ChipGroup label="Filter by interest">…</ChipGroup></div>
  </div>
  <div className="myt-grid">                       auto-fill, cards at least 300px wide
    <article className="myt-activity-card">
      <div className="myt-activity-card__top">
        <ActivityMark … />
        <div className="myt-activity-card__heading">
          <h3><button type="button" className="myt-activity-card__link">Title</button></h3>
          <div className="myt-badges"><Chip tone="football">football</Chip><Chip tone="success">Verified event</Chip></div>
        </div>
      </div>
      <div className="myt-activity-card__meta"><span>Area · when</span><span>Price</span></div>
      <ul className="myt-activity-card__reasons"><li>Reason from G4</li></ul>
      <div className="myt-activity-card__footer">
        <span className="myt-count">3 interested</span>
        <span className="myt-live">1 viewing now</span>      use myt-live--off for "not connected"
      </div>
    </article>
  </div>
</div>
```

The title button stretches over the whole card, so the card is one tab stop and one large click target. Any other interactive child needs `position: relative; z-index: 1`. The persistent count (`myt-count`) and the temporary viewers (`myt-live`) are separate elements on purpose: viewers are never counted as interested.

Empty state: `myt-empty` with `myt-empty__title`, `myt-empty__body` and a Button ("Relax filters"), centred in a quiet band. Loading: the same `myt-grid` filled with `myt-activity-card` skeletons (`aria-hidden`), built from `myt-skeleton` (`--title`, `--short`, `--block`, `--mark`). Shimmer stops under reduced motion.

### Activity detail (S5, S6, S7, S10)

```
<div className="myt-stack myt-stack--lg">
  <Button variant="quiet" size="sm" className="myt-back">← All activities</Button>
  <div className="myt-detail">                    main + aside, one column under 860px
    <div className="myt-detail__main">
      <div className="myt-detail__hero"><ActivityMark size="lg" …/><div><SectionHeader level={1} …/><div className="myt-badges">…</div></div></div>
      <Panel title="About"> <p>…</p> <dl className="myt-facts"><dt>Where</dt><dd>…</dd>…</dl> </Panel>
      <Panel title="Pick a time"> …time options… </Panel>
    </div>
    <div className="myt-detail__aside">
      <Panel title="Who's interested"> <div className="myt-presence">…</div> <ul className="myt-people">…</ul> <div className="myt-actions">…</div> </Panel>
      <Panel title="People like you" variant="quiet"> …sample people… </Panel>
    </div>
  </div>
</div>
```

`myt-facts` is a label/value list (two columns, one column under 640px). Values wrap anywhere, so long URLs and meeting points are safe.

### Participant rows (S6, S10)

```
<ul className="myt-people">
  <li className="myt-person myt-person--me">             --me tints the current user's row
    <span className="myt-avatar">A</span>                 or C4's ProfileAvatar inside .myt-avatar sizing
    <span className="myt-person__text"><span className="myt-person__name">Name</span><span className="myt-person__meta">University</span></span>
    <span className="myt-person__trail"><Chip tone="accent">You</Chip></span>
  </li>
  <li className="myt-person myt-person--sample">          dashed edge: fictional example, also add <Chip tone="warn">Fictional</Chip>
</ul>
```

`myt-avatar` is 40px round, `myt-avatar--sm` 28px, `myt-avatar-row` is a wrapping row of avatars. `myt-presence` is a quiet strip for G5's content (a `myt-live` or `myt-live--off` span plus text).

### Time options (S7)

Use a native radio inside a label, so arrow keys, focus and screen readers work. The radio is drawn from tokens, not the OS default.

```
<fieldset className="myt-fieldset">
  <legend className="myt-visually-hidden">Time choices</legend>
  <div className="myt-options" role="radiogroup" aria-label="Time choices">
    <label className="myt-option">
      <input className="myt-option__input" type="radio" name=… checked=… onChange=… disabled=… />
      <span className="myt-option__body"><span className="myt-option__title">Sat 14 Nov, 14:00</span><span className="myt-option__meta">Weekend day</span></span>
      <span className="myt-option__tally"><span className="myt-bar"><span style={{ width: "40%" }} /></span>2 votes</span>
    </label>
  </div>
</fieldset>
```

The only inline style is the bar width, a computed percentage. The checked option gets an accent edge and wash; a disabled option is dimmed. Under 640px the tally drops under the text. Clearing a vote is a `quiet` small Button, not a radio.

### Plan card (S8, S9, G10)

```
<article className="myt-plan" data-tone="karting">          data-tone = the activity's interest tone
  <div className="myt-plan__when"><span className="myt-plan__day">Sat</span><span className="myt-plan__date">14</span><span className="myt-plan__month">Nov</span></div>
  <div className="myt-plan__body">
    <h2 className="myt-plan__title">…</h2>
    <p className="myt-plan__time">14:00 to 16:00, London time</p>
    <dl className="myt-facts">…meeting point, organiser, going…</dl>
  </div>
  <div className="myt-plan__foot"> <Button variant="primary">I'm going</Button> <Button variant="quiet">I can't make it</Button> <ButtonLink href=…>View original event</ButtonLink> </div>
</article>
```

For the My plans list use `myt-plan-list` (auto-fill grid, 420px minimum) containing `myt-plan myt-plan--compact` cards (smaller date block, no foot required). Make the card clickable the same way as the activity card, with a stretched title button. Under 640px the date block becomes a single line above the title.

### Skeleton and empty layouts

`myt-skeleton` plus a modifier gives a pulsing block. Reuse the real layout (`myt-activity-card`, `myt-panel`, `myt-person`) with skeleton children so nothing jumps when data arrives. `myt-empty` is the standard empty and "nothing yet" state.

## Narrow viewports and touch

- Breakpoints: 860px (welcome and detail go single column), 640px (padding shrinks, forms go single column, `myt-actions` stack full width, facts stack, plan card stacks, time option tally drops under the text).
- The grid, header, nav, chip groups and filter rows wrap; nothing has a fixed height.
- Controls are 40px tall (32px for `size="sm"`), and 44px on coarse pointers.
- No hover-only information. Hover only adds a wash over the existing fill.

## Accessibility notes

- Focus: a 2px ring in `--lf-ring` with offset on every interactive element, including a ring on a whole activity card when its title button is focused.
- Primary buttons and accent text use `--myt-accent-fill` and `--myt-accent-ink` (accent pulled toward the content colour) to keep contrast in both themes. Tone chips mix the ink from the tone hue and `--lf-content`.
- Reduced motion: transitions and the spinner and shimmer animations are removed under `prefers-reduced-motion`.
- Text is never truncated with an ellipsis except where `myt-clamp-2` is explicitly applied.

## Not covered here

Feedback banners with retry, error boundary and loading wrappers are G9's. The presence strip, participant list and plan summary logic belong to their owners; they only need the classes above.
