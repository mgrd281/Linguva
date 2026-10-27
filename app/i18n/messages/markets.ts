/** Texts of the markets area. Keys start with "markets.". */
import type { Message, Translation } from "./define";

export const en = {} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {};
