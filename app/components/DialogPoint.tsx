/**
 * One point of a confirm dialog: an icon in a soft square, a short title
 * and what it means (TranslateConfirm, Review's approve dialog). A point
 * without a title is one sentence beside its icon.
 */
import type { ReactNode } from "react";
import type { IconName } from "../lib/icons";

export function DialogPoint({ icon, title, children }: { icon: IconName; title?: string; children: ReactNode }) {
  return (
    <s-grid gridTemplateColumns="auto minmax(0, 1fr)" gap="base" alignItems={title ? "start" : "center"}>
      <s-stack background="subdued" borderRadius="base" inlineSize="32px" blockSize="32px" alignItems="center" justifyContent="center">
        <s-icon type={icon} color="subdued" />
      </s-stack>
      <s-stack direction="block" gap="small-500">
        {title ? <s-text type="strong">{title}</s-text> : null}
        {children}
      </s-stack>
    </s-grid>
  );
}
