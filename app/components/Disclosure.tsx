/**
 * More words on demand: a native disclosure, closed at first (`open`: open at
 * first), its summary in semibold with a chevron at its end that turns when
 * open, 44 px high (ui.css, .lv-more). The app's one way to fold text, instead
 * of the browser's triangle.
 */
import type { ReactNode, SyntheticEvent } from "react";

export function Disclosure({ summary, children, open, onToggle }: { summary: ReactNode; children: ReactNode; open?: boolean; onToggle?: (open: boolean) => void }) {
  return (
    <details className="lv-more" {...(open ? { open: true } : {})} {...(onToggle ? { onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => onToggle(event.currentTarget.open) } : {})}>
      <summary className="lv-more__summary">
        <span>{summary}</span>
        <span className="lv-more__chevron" aria-hidden="true">
          <s-icon type="chevron-down" color="subdued" size="small" />
        </span>
      </summary>
      <div className="lv-more__body">
        <s-stack direction="block" gap="small-200">
          {children}
        </s-stack>
      </div>
    </details>
  );
}
