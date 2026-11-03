/**
 * The Coverage pages' states, each with the icon the language pages give it
 * (ItemStates.tsx: done, waiting for approval, outdated, failed, missing;
 * drafts with and without quality notes both wait), never a colour dot
 * alone: the key under a bar, and the same key with each state opening its
 * items.
 */
import type { I18n } from "../i18n/i18n";
import { FIELD_STATES, type FieldState, type StateCounts } from "../lib/coverage-rules";
import { ITEM_STATE_OF } from "../lib/language-categories";
import { StateIcon } from "./ItemStates";

/** A field state's icon: the language pages' state it belongs to. */
export function FieldStateIcon({ state }: { state: FieldState }) {
  return <StateIcon state={ITEM_STATE_OF[state]} size="small" />;
}

/** "✓ Complete 11  ◷ Draft 18 …": the states with texts, as a key (no links). */
export function FieldStateList({ counts, i18n }: { counts: StateCounts; i18n: I18n }) {
  const shown = FIELD_STATES.filter((s) => counts[s] > 0);
  if (!shown.length) return null;
  return (
    <s-stack direction="inline" gap="small-100 base" alignItems="center">
      {shown.map((s) => (
        <s-stack key={s} direction="inline" gap="small-300" alignItems="center">
          <FieldStateIcon state={s} />
          <s-text color="subdued">
            {i18n.t(`coverage.state.${s}`)} {i18n.number(counts[s])}
          </s-text>
        </s-stack>
      ))}
    </s-stack>
  );
}

/** The same key, each state a link to its items ("Outdated: 3 texts. The original changed after it was translated"). */
export function FieldStateLinks({
  counts,
  i18n,
  hrefFor,
  states = FIELD_STATES,
}: {
  counts: StateCounts;
  i18n: I18n;
  hrefFor: (state: FieldState) => string;
  states?: readonly FieldState[];
}) {
  const shown = states.filter((s) => counts[s] > 0);
  if (!shown.length) return null;
  return (
    <s-stack direction="inline" gap="small-100 base" alignItems="center">
      {shown.map((s) => (
        <s-stack key={s} direction="inline" gap="small-300" alignItems="center">
          <FieldStateIcon state={s} />
          <s-link href={hrefFor(s)} accessibilityLabel={`${i18n.t("coverage.stateLink", { state: i18n.t(`coverage.state.${s}`), count: counts[s] })}. ${i18n.t(`coverage.stateHelp.${s}`)}`}>
            {i18n.t(`coverage.state.${s}`)} {i18n.number(counts[s])}
          </s-link>
        </s-stack>
      ))}
    </s-stack>
  );
}
