import type { ReactElement } from "react";

/**
 * Local initials avatar for one participant (C4).
 * Draws text or a neutral person mark. It does not fetch a photo, call an avatar service,
 * open a host connection, or store anything.
 *
 * S2 colours the circle from `data-palette-slot` ("0" … "5"). This file sets no colours.
 * The slot is a hash of `userId`, so it stays put across rerenders. Shared initials or a
 * shared display name do not make two users the same person and do not pick the colour.
 *
 * Accessibility:
 * - Default: this avatar is the identity label (`role="img"` plus the person's name).
 * - `decorative`: a name is already visible beside it, so the avatar is hidden from
 *   accessibility APIs and does not repeat a Demo marker.
 * - `isDemo` with the default labelling shows a visible "Demo" marker. The parent
 *   companion card still labels fictional profiles when the avatar is decorative.
 *   There is no online dot and no verified-student icon.
 */

// pure:start

/** Anonymous CSS slots. S2 maps each value to one theme colour. */
export const PROFILE_AVATAR_PALETTE_SLOTS: readonly string[] = ["0", "1", "2", "3", "4", "5"];

export interface ProfileAvatarProps {
  userId: string;
  displayName: string;
  isDemo?: boolean;
  size?: "small" | "medium";
  /** Hide this avatar from accessibility APIs when the full name is already shown beside it. */
  decorative?: boolean;
  className?: string;
}

export interface ProfileAvatarModel {
  initials: string;
  paletteSlot: number;
  /** DOM value for `data-palette-slot`. Undefined only if the slot falls outside the six values. */
  paletteSlotValue: string | undefined;
  sizeClass: "myt-avatar--small" | "myt-avatar--medium";
  ariaLabel: string | undefined;
  ariaHidden: true | undefined;
  showDemoMarker: boolean;
  fallback: boolean;
  demo: boolean;
}

let graphemeSegmenter: Intl.Segmenter | null | undefined;

function segmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter;
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  } else {
    graphemeSegmenter = null;
  }
  return graphemeSegmenter;
}

/** First user-perceived character. Does not cut a surrogate pair or drop a combining mark. */
function firstGrapheme(word: string): string {
  if (word.length === 0) return "";
  const graphemes = segmenter();
  if (graphemes !== null) {
    const step = graphemes.segment(word)[Symbol.iterator]().next();
    return step.done ? "" : step.value.segment;
  }
  let grapheme = "";
  for (const char of word) {
    if (grapheme.length === 0) {
      grapheme = char;
      continue;
    }
    if (/^\p{M}$/u.test(char)) {
      grapheme += char;
      continue;
    }
    break;
  }
  return grapheme;
}

function upperGrapheme(grapheme: string): string {
  if (grapheme.length === 0) return "";
  return grapheme.toLocaleUpperCase("en-GB");
}

/**
 * Initials for a display name.
 * One word → its first grapheme. More than one word → first grapheme of the first and last words.
 * Whitespace-only and empty names return "" so the avatar can draw a neutral fallback.
 * Case folding is en-GB so the letters do not change with the viewer's locale.
 */
export function getInitials(displayName: string): string {
  if (typeof displayName !== "string" || displayName.length === 0) return "";
  const trimmed = displayName.normalize("NFC").trim();
  if (trimmed.length === 0) return "";
  const words = trimmed.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return "";
  const first = upperGrapheme(firstGrapheme(words[0] ?? ""));
  if (words.length === 1) return first;
  const last = upperGrapheme(firstGrapheme(words[words.length - 1] ?? ""));
  return `${first}${last}`;
}

/** Stable palette index in `0 .. PROFILE_AVATAR_PALETTE_SLOTS.length - 1`, from `userId` only. */
export function profilePaletteSlot(userId: string): number {
  const source = typeof userId === "string" ? userId : "";
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const count = PROFILE_AVATAR_PALETTE_SLOTS.length;
  if (count === 0) return 0;
  return (hash >>> 0) % count;
}

const UNNAMED_PARTICIPANT = "Unnamed participant";

/** Pure view model used by `ProfileAvatar`. Same inputs always produce the same model. */
export function profileAvatarPresentation(props: ProfileAvatarProps): ProfileAvatarModel {
  const initials = getInitials(props.displayName);
  const decorative = props.decorative === true;
  const demo = props.isDemo === true;
  const trimmed = typeof props.displayName === "string" ? props.displayName.trim() : "";
  const who = trimmed.length > 0 ? trimmed : UNNAMED_PARTICIPANT;
  const paletteSlot = profilePaletteSlot(props.userId);
  return {
    initials,
    paletteSlot,
    paletteSlotValue: PROFILE_AVATAR_PALETTE_SLOTS[paletteSlot],
    sizeClass: props.size === "small" ? "myt-avatar--small" : "myt-avatar--medium",
    ariaLabel: decorative ? undefined : demo ? `${who}, Demo` : who,
    ariaHidden: decorative ? true : undefined,
    showDemoMarker: demo && !decorative,
    fallback: initials.length === 0,
    demo,
  };
}

// pure:end

function classNames(parts: Array<string | undefined>): string {
  return parts.filter((part) => typeof part === "string" && part.length > 0).join(" ");
}

/** Neutral stand-in when the name has no initials. Stroke uses currentColor; no status colour. */
function NeutralPersonMark(): ReactElement {
  return (
    <svg className="myt-avatar__fallback" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
      <circle cx="12" cy="9" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.2 18.4c1.15-2.5 3.15-3.7 5.8-3.7s4.65 1.2 5.8 3.7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function ProfileAvatar({ userId, displayName, isDemo, size, decorative, className }: ProfileAvatarProps): ReactElement {
  const model = profileAvatarPresentation({ userId, displayName, isDemo, size, decorative });
  const circleIsLabel = model.showDemoMarker === false && model.ariaLabel !== undefined;
  const circle = (
    <span
      className={classNames(["myt-avatar", model.sizeClass, className])}
      data-palette-slot={model.paletteSlotValue}
      data-demo={model.demo ? "true" : undefined}
      data-fallback={model.fallback ? "neutral" : undefined}
      role={circleIsLabel ? "img" : undefined}
      aria-label={circleIsLabel ? model.ariaLabel : undefined}
      aria-hidden={model.ariaHidden === true || model.showDemoMarker ? true : undefined}
      translate="no"
    >
      <span className="myt-avatar__initials" dir="auto" aria-hidden="true">
        {model.fallback ? <NeutralPersonMark /> : model.initials}
      </span>
    </span>
  );

  if (!model.showDemoMarker) return circle;

  return (
    <span className="myt-avatar-with-demo" role="img" aria-label={model.ariaLabel} translate="no">
      {circle}
      {/* Visible word. aria-hidden avoids a second announcement; the image name already ends in "Demo". */}
      <span className="myt-avatar__demo" aria-hidden="true">Demo</span>
    </span>
  );
}
