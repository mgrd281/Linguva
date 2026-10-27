/** Texts of the plan area. Keys start with "plan.". */
import type { Message, Translation } from "./define";

export const en = {} as const satisfies Record<string, Message>;

export const de: Translation<typeof en> = {};
