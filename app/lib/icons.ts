/**
 * Any icon name of Polaris' public list (@shopify/polaris-types), as
 * `<s-icon type>` takes it: a private or misspelt name fails the type check
 * (and would draw nothing).
 */
export type IconType = Exclude<HTMLElementTagNameMap["s-icon"]["type"], "" | "empty">;
