/**
 * Value of the "All …" option in Polaris selects. An option with an empty
 * value submits its visible text instead ("All languages"), so these use a
 * fixed value that the server reads as "no filter".
 */
export const ALL = "all";

/** A select's submitted value, or null for the "All …" option or nothing chosen. */
export function chosen(value: FormDataEntryValue | string | null | undefined): string | null {
  return typeof value === "string" && value && value !== ALL ? value : null;
}
