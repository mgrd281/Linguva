/** Texts of the memory area. Keys start with "memory.". */
import type { Message, Translation } from "./define";

export const en = {} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {};
