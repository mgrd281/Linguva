/**
 * Polaris icon names the app may use: the public union of polaris-types
 * (IconType), which s-icon, s-button and s-badge accept. Names only in
 * Polaris' private list draw nothing, and TypeScript rejects them here.
 */
export type IconName = Exclude<NonNullable<JSX.IntrinsicElements["s-icon"]["type"]>, "" | "empty">;
