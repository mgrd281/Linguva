/**
 * A choice of two to four short options in one row (styles in
 * app/styles/ui.css, .lv-seg): native radio buttons in a fieldset, so the
 * form posts the chosen value, the arrow keys move between the options and
 * a screen reader hears the group's name ("Deutsch") with each option.
 * Uncontrolled (defaultValue): the form's change event says a choice was
 * made, as for the inputs it replaces.
 *
 * SegmentedButtons draws the same choice for a view that changes on the page
 * itself, without a form (the Overview's "Countries | Languages"): pressed
 * buttons (aria-pressed) in a named group, each with an optional icon.
 */
import { useId } from "react";
import type { IconName } from "../lib/icons";

export interface SegmentOption {
  value: string;
  label: string;
  /** Read instead of the label when the label alone is too short ("Sie" → "Formal: Sie"). */
  accessibilityLabel?: string;
}

/** A choice of SegmentedButtons: its value, its words and a Polaris icon before them. */
export interface SegmentButton<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** The choice as pressed buttons: `value` is the pressed one, `onChange` gets the one pressed next. */
export function SegmentedButtons<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** The group's name for assistive technology ("Show by"). */
  label: string;
  options: readonly SegmentButton<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="lv-seg lv-seg--buttons">
      {options.map((option) => (
        <span key={option.value} className="lv-seg__option">
          <button
            type="button"
            className="lv-seg__text"
            aria-pressed={option.value === value}
            onClick={() => {
              if (option.value !== value) onChange(option.value);
            }}
          >
            {option.icon ? (
              <span className="lv-seg__icon" aria-hidden="true">
                <s-icon type={option.icon} size="small" />
              </span>
            ) : null}
            {option.label}
          </button>
        </span>
      ))}
    </div>
  );
}

const VISUALLY_HIDDEN = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

export function Segmented({
  name,
  legend,
  options,
  defaultValue,
  fill = false,
  even = false,
  disabled = false,
}: {
  name: string;
  /** The group's name for assistive technology (shown elsewhere on the page). */
  legend: string;
  options: readonly SegmentOption[];
  defaultValue: string;
  /** The full width of its container. */
  fill?: boolean;
  /** One width for every row of a list (the full width on a narrow container), so the choices line up. */
  even?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className={["lv-seg", fill ? "lv-seg--fill" : null, even ? "lv-seg--even" : null].filter(Boolean).join(" ")} disabled={disabled}>
      <legend style={VISUALLY_HIDDEN}>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="lv-seg__option">
          <input type="radio" name={name} value={option.value} defaultChecked={option.value === defaultValue} id={`${id}-${option.value}`} {...(option.accessibilityLabel ? { "aria-label": option.accessibilityLabel } : {})} />
          <span className="lv-seg__text">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
