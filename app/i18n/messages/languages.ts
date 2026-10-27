/** Texts of the languages area. Keys start with "languages.". */
import type { Message, Translation } from "./define";

export const en = {} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {};
