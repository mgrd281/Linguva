/** Texts of the editor area. Keys start with "editor.". */
import type { Message, Translation } from "./define";

export const en = {} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {};
