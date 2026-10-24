import type { ReactElement } from "react";
import { getSourcePresentation, type SourceInput } from "../domain/sourcePresentation";

export type { SourceInput };

export interface SourceBadgeProps {
  source: SourceInput;
  className?: string;
}

/**
 * Text-first source status. Colour, if S2 adds it, is extra: the label string
 * is always visible. Does not import a stylesheet or UI kit. The only markup
 * emitted is local text plus an optional https `<a>`; remote HTML is never
 * fetched or injected.
 */
export function SourceBadge({ source, className }: SourceBadgeProps): ReactElement {
  const presentation = getSourcePresentation(source);
  const rootClassName = className ? "myt-source-badge " + className : "myt-source-badge";
  return (
    <div className={rootClassName} data-kind={presentation.kind}>
      <span className="myt-source-badge__label">{presentation.label}</span>
      <span className="myt-source-badge__detail">{presentation.detail}</span>
      {presentation.href ? (
        <a className="myt-source-badge__link" href={presentation.href} target="_blank" rel="noopener noreferrer">
          View source
        </a>
      ) : null}
    </div>
  );
}
