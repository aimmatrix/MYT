import { useEffect, useRef, useState, useId, type ComponentPropsWithRef, type ReactNode } from "react";
import type { InterestId } from "../types";

/*
 * MYT shared controls (S2). Presentation only: no data access, no host connection, no state of
 * their own beyond generated ids. Class names live in code/styles.css and are listed in
 * Planning/Design.md. Feedback and error components belong to G9, not this file.
 */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone =
  | "neutral"
  | "accent"
  | "success"
  | "danger"
  | "warn"
  | "football"
  | "karting"
  | "cinema"
  | "music"
  | "social"
  | "fitness"
  | "comedy"
  | "theatre";

/* ---------------------------------------------------------------- Button */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends Omit<ComponentPropsWithRef<"button">, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and ignores clicks. The accessible name does not change; announce progress elsewhere. */
  pending?: boolean;
  fullWidth?: boolean;
}

/**
 * Always renders `type="button"`: the sandbox has no form submission. While `pending`, the button
 * stays focusable (`aria-disabled`) so keyboard focus is not lost, and keeps its label in place.
 */
export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  fullWidth = false,
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={cx("myt-button", `myt-button--${variant}`, size === "sm" && "myt-button--sm", fullWidth && "myt-button--block", className)}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      onClick={pending ? (event) => event.preventDefault() : onClick}
    >
      <span className="myt-button__label">{children}</span>
      {pending ? <span className="myt-spinner" aria-hidden="true" /> : null}
    </button>
  );
}

export interface ButtonLinkProps extends Omit<ComponentPropsWithRef<"a">, "target" | "rel"> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/** An external link that looks like a Button. Opens in the user's default browser, never claims to book anything. */
export function ButtonLink({ variant = "secondary", size = "md", fullWidth = false, className, children, ...rest }: ButtonLinkProps) {
  return (
    <a
      {...rest}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("myt-button", `myt-button--${variant}`, size === "sm" && "myt-button--sm", fullWidth && "myt-button--block", className)}
    >
      <span className="myt-button__label">{children}</span>
    </a>
  );
}

/* ------------------------------------------------------------------ Chip */

export interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  /**
   * Present (even as `false`) makes the chip an interactive toggle button with `aria-pressed`.
   * Omit it for a static, non-interactive label.
   */
  selected?: boolean;
  /** Receives the next selected value. Providing it makes the chip interactive. */
  onSelectedChange?: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}

/**
 * Static label (`<span>`) or keyboard-operable toggle (`<button aria-pressed>`). Selected state is
 * shown with a check mark as well as colour. Space and Enter work because it is a native button.
 */
export function Chip({ children, tone, selected, onSelectedChange, disabled, className, title }: ChipProps) {
  const interactive = onSelectedChange !== undefined || selected !== undefined;
  if (!interactive) {
    return (
      <span className={cx("myt-chip", className)} data-tone={tone ?? "neutral"} title={title}>
        {children}
      </span>
    );
  }
  const isSelected = selected === true;
  return (
    <button
      type="button"
      className={cx("myt-chip", "myt-chip--toggle", className)}
      data-tone={tone ?? "accent"}
      aria-pressed={isSelected}
      disabled={disabled}
      title={title}
      onClick={() => onSelectedChange?.(!isSelected)}
    >
      {children}
    </button>
  );
}

export interface ChipGroupProps {
  /** Accessible name for the set, for example "Interests". */
  label: string;
  children: ReactNode;
  className?: string;
}

/** Wrapper for a row of toggle chips. Gives the set a name for assistive technology. */
export function ChipGroup({ label, children, className }: ChipGroupProps) {
  return (
    <div role="group" aria-label={label} className={cx("myt-chip-group", className)}>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- Panel */

export interface PanelProps {
  children?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned header content, usually a Button or Chip. */
  actions?: ReactNode;
  /** Heading level for `title`. Defaults to 2. */
  headingLevel?: 2 | 3 | 4;
  variant?: "card" | "quiet";
  tone?: Tone;
  as?: "section" | "div" | "article" | "aside";
  className?: string;
  /** Accessible name when there is no visible `title`. */
  "aria-label"?: string;
}

/** A card-shaped container with an optional header. A titled Panel is a labelled region. */
export function Panel({
  children,
  title,
  description,
  actions,
  headingLevel = 2,
  variant = "card",
  tone,
  as = "section",
  className,
  "aria-label": ariaLabel,
}: PanelProps) {
  const headingId = useId();
  const Tag = as;
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <Tag
      className={cx("myt-panel", variant === "quiet" && "myt-panel--quiet", tone && "myt-panel--tone", className)}
      data-tone={tone}
      aria-labelledby={title !== undefined && !ariaLabel ? headingId : undefined}
      aria-label={ariaLabel}
    >
      {hasHeader ? (
        <div className="myt-panel__header">
          <div className="myt-panel__heading">
            {title !== undefined ? (
              <Heading id={headingId} className="myt-panel__title">
                {title}
              </Heading>
            ) : null}
            {description !== undefined ? <p className="myt-panel__description">{description}</p> : null}
          </div>
          {actions !== undefined ? <div className="myt-panel__actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

/* ----------------------------------------------------------------- Field */

/** Attributes to spread on a custom control inside `Field` so label, hint and error stay associated. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
}

export interface FieldOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  /** Error text. Presence marks the control invalid and links the message to it. */
  error?: ReactNode;
  required?: boolean;
  /** Adds a visible "(optional)" after the label. */
  optional?: boolean;
  disabled?: boolean;
  /** Built-in control. Defaults to "input". "select" needs `options`. */
  control?: "input" | "textarea" | "select";
  type?: "text" | "search" | "number" | "email" | "url";
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  inputMode?: "text" | "numeric" | "decimal" | "search";
  autoComplete?: string;
  options?: FieldOption[];
  className?: string;
  /** Replaces the built-in control, for example a group of chips. Spread the supplied props on the focusable element. */
  children?: (control: FieldControlProps) => ReactNode;
}

/**
 * Label, control, hint and error as one unit. The label is a real `<label>` bound to the control,
 * and hint and error are referenced through `aria-describedby`. There is no form element.
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  disabled,
  control = "input",
  type = "text",
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 3,
  inputMode,
  autoComplete,
  options,
  className,
  children,
}: FieldProps) {
  const base = useId();
  const hintId = hint !== undefined && hint !== null && hint !== false ? `${base}-hint` : undefined;
  const errorId = error !== undefined && error !== null && error !== false ? `${base}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const aria: FieldControlProps = {
    id: base,
    "aria-describedby": describedBy,
    "aria-invalid": errorId ? true : undefined,
    "aria-required": required ? true : undefined,
  };

  let body: ReactNode;
  if (children) {
    body = children(aria);
  } else if (control === "textarea") {
    body = (
      <textarea
        {...aria}
        className="myt-input myt-input--textarea"
        value={value ?? ""}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  } else if (control === "select") {
    body = (
      <select
        {...aria}
        className="myt-input myt-input--select"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {(options ?? []).map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else {
    body = (
      <input
        {...aria}
        className="myt-input"
        type={type}
        value={value ?? ""}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  return (
    <div className={cx("myt-field", className)}>
      <label className="myt-field__label" htmlFor={base}>
        {label}
        {required ? (
          <span className="myt-field__flag" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
        {optional ? <span className="myt-field__optional"> (optional)</span> : null}
      </label>
      {body}
      {hintId ? (
        <p id={hintId} className="myt-field__hint">
          {hint}
        </p>
      ) : null}
      {errorId ? (
        <p id={errorId} className="myt-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- SectionHeader */

export interface SectionHeaderProps {
  title: ReactNode;
  /** Small line above the title, for example a step or category. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls. They wrap under the title on narrow screens. */
  actions?: ReactNode;
  /** Heading level. Pages use 1, sections 2. Visual size follows `size`. */
  level?: 1 | 2 | 3;
  size?: "page" | "section" | "small";
  className?: string;
}

export function SectionHeader({ title, eyebrow, description, actions, level = 2, size, className }: SectionHeaderProps) {
  const Heading = `h${level}` as "h1" | "h2" | "h3";
  const visual = size ?? (level === 1 ? "page" : level === 2 ? "section" : "small");
  return (
    <header className={cx("myt-section-header", className)}>
      <div className="myt-section-header__text">
        {eyebrow !== undefined ? <p className="myt-eyebrow">{eyebrow}</p> : null}
        <Heading className={cx("myt-heading", `myt-heading--${visual}`)}>{title}</Heading>
        {description !== undefined ? <p className="myt-section-header__description">{description}</p> : null}
      </div>
      {actions !== undefined ? <div className="myt-section-header__actions">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------- Wordmark and activity marks */

/** The MYT wordmark: three linked dots (people meeting up) and the name. Decorative mark, readable name. */
export function Wordmark({ className }: { className?: string }) {
 return <span className={cx("myt-wordmark", className)} aria-label="myt"><span className="myt-wordmark__name">myt<span aria-hidden="true">✳</span></span></span>;
}
export function Icon({name}:{name:string}) {
 const paths:Record<string,string> = {
 discover:"M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
 meet:"M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 12a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5zM8.5 17a3.5 3.5 0 0 1 7 0",
 chats:"M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
 plans:"M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
 football:"M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM12 7.5l4 2.9-1.5 4.6h-5L8 10.4z",
 karting:"M5 21V4M5 4h12l-2 4 2 4H5",cinema:"M4 6h16v12H4zM8 6v12M16 6v12M4 10h4M4 14h4M16 10h4M16 14h4",
 music:"M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z",
 social:"M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
 theatre:"M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v10",
 fitness:"M3 9v6M7 6v12M17 6v12M21 9v6M7 12h10",comedy:"M4 5h16v7a8 8 0 0 1-16 0zM8 9h1M15 9h1M8 13q4 5 8 0"
 };
 return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]??paths.social}/></svg>;
}

function initialsOf(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

export interface ActivityMarkProps {
  interestId: InterestId;
  /** Used only for the initials. The mark is decorative (aria-hidden). */
  title: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** A locally drawn tile for an activity: interest colour, a simple pattern, and the title's initials. No images fetched. */
export function ActivityMark({ interestId, title, size = "md", className }: ActivityMarkProps) {
  return (
    <span className={cx("myt-mark", `myt-mark--${size}`, `myt-mark--${interestId}`, className)} data-tone={interestId} aria-hidden="true">
      <Icon name={interestId}/>
    </span>
  );
}

/* Redesign primitives. Screens supply state and callbacks; these do no I/O. */
export function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={cx("myt-avatar", large && "myt-avatar--large")} aria-hidden="true">{name.split(/\s+/).filter(w => w && !w.startsWith("(")).map(w => Array.from(w)[0]).slice(0, 2).join("").toUpperCase()}</span>;
}
export function AvatarStack({ names }: { names: string[] }) {
  return <span className="myt-avatar-stack" aria-label={names.join(", ")}>{names.slice(0, 4).map((name, i) => <Avatar key={i} name={name} />)}</span>;
}
export function ProgressSteps({ step }: { step: number }) {
  return <div className="myt-progress" aria-label={`Step ${step} of 5`}>{[1,2,3,4,5].map(n => <span key={n} data-done={n <= step} />)}</div>;
}
export function Toast({ children }: { children: ReactNode }) {
  return <div className="myt-toast" role="status">{children}</div>;
}
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return <button type="button" className="myt-switch" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>{label}<span aria-hidden="true" /></button>;
}
export function SegmentedTabs<T extends string>({ options, value, onChange }: { options: readonly { id: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const active = Math.max(0, options.findIndex(o => o.id === value));
  return <div className="myt-segments" role="tablist" aria-label="View"><span className="myt-segments__pill" style={{ width: `${100 / options.length}%`, transform: `translateX(${active * 100}%)` }} />{options.map((o, i) => <button type="button" role="tab" aria-selected={o.id === value} key={o.id} tabIndex={o.id === value ? 0 : -1} onClick={() => onChange(o.id)} onKeyDown={e => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length; onChange(options[next].id); const buttons = e.currentTarget.parentElement?.querySelectorAll("button"); buttons?.[next]?.focus(); } }}>{o.label}</button>)}</div>;
}
export function TabBar({ active, unread, onChange }: { active: string; unread: number; onChange: (tab: "discover" | "meet" | "chats" | "plans") => void }) {
  const tabs = [{id:"discover", label:"Discover", icon:"◈"}, {id:"meet",label:"Meet",icon:"♧"}, {id:"chats",label:"Chats",icon:"☏"}, {id:"plans",label:"Plans",icon:"▦"}] as const;
  return <nav className="myt-tabbar" aria-label="Main">{tabs.map(t => <button key={t.id} type="button" aria-current={active === t.id ? "page" : undefined} onClick={() => onChange(t.id)}><Icon name={t.id}/>{t.label}{t.id === "chats" && unread > 0 ? <b className="myt-unread">{unread}</b> : null}</button>)}</nav>;
}

export function BottomSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="myt-sheet" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="myt-stack"><div className="myt-row"><h2>{title}</h2><Button aria-label="Close sheet" onClick={onClose}>×</Button></div>{children}</div></dialog>;
}
export function ChatBubble({ mine, name, children }: { mine: boolean; name: string; children: ReactNode }) {
  return <article className="myt-bubble" data-mine={mine}><strong className="myt-small">{name}</strong>{children}</article>;
}
export function SwipeCard({ children, onPass, onAdd, disabled }: { children: ReactNode; onPass: () => void; onAdd?: () => void; disabled?: boolean }) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const finish = () => { if (start.current === null) return; start.current = null; if (!disabled) { if (dx > 110 && onAdd) onAdd(); else if (dx < -110) onPass(); } setDx(0); };
  return <div className="myt-swipe-wrap"><article className="myt-swipe" style={{ transform: `translateX(${dx}px) rotate(${dx / 18}deg)` }} onPointerDown={e => { if (disabled || (e.target instanceof HTMLElement && e.target.closest("button"))) return; start.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (start.current !== null) setDx(e.clientX - start.current); }} onPointerUp={finish} onPointerCancel={() => { start.current = null; setDx(0); }}><span className="myt-swipe__stamp" style={{ opacity: Math.min(1, Math.abs(dx) / 110) }} aria-hidden="true">{dx > 0 ? onAdd ? "ADD" : "SAMPLE" : "PASS"}</span>{children}</article><div className="myt-actions"><Button disabled={disabled} onClick={onPass}>× Pass</Button><Button variant="primary" disabled={disabled || !onAdd} onClick={onAdd}>+ Add friend</Button></div></div>;
}
