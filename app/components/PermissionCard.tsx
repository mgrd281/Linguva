/**
 * Asking for a permission Linguva doesn't have yet, in one look wherever it
 * is asked (the Content page's AccessCard is the same card): the lock in a
 * slate square (hidden on a phone), what the permission is for, what it
 * unlocks as chips with their icons, and the one button beside "You confirm
 * it once in Shopify.".
 */
import type { ReactNode } from "react";
import type { IconName } from "../lib/icons";
import { IconSquare } from "./IconSquare";
import { CARD, PLAIN_LIST } from "./LanguageLayout";

export function PermissionCard({
  id,
  heading,
  body,
  items,
  itemsLabel,
  action,
  note,
}: {
  /** The heading's id: the section's name and the way other pages link here. */
  id: string;
  heading: string;
  body: string;
  /** What the permission unlocks, each with its picture. */
  items: ReadonlyArray<{ icon: IconName; label: string }>;
  itemsLabel: string;
  /** The form with the one button that asks Shopify. */
  action: ReactNode;
  /** Beside the button: what happens next. */
  note: string;
}) {
  return (
    <section aria-labelledby={id}>
      <s-box {...CARD} padding="large">
        <s-query-container>
          <s-grid gridTemplateColumns="@container (inline-size > 560px) auto 1fr, 1fr" gap="base">
            <s-box display="@container (inline-size > 560px) auto, none">
              <IconSquare icon="lock" tint="slate" />
            </s-box>
            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="small-300">
                <h2 id={id} className="lv-h2">
                  {heading}
                </h2>
                <s-paragraph color="subdued">{body}</s-paragraph>
              </s-stack>
              <ul aria-label={itemsLabel} style={{ ...PLAIN_LIST, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {items.map((item) => (
                  <li key={item.label}>
                    <s-chip>
                      <s-icon slot="graphic" type={item.icon} />
                      {item.label}
                    </s-chip>
                  </li>
                ))}
              </ul>
              <s-stack direction="inline" gap="small-200 base" alignItems="center">
                {action}
                <s-text color="subdued">{note}</s-text>
              </s-stack>
            </s-stack>
          </s-grid>
        </s-query-container>
      </s-box>
    </section>
  );
}
