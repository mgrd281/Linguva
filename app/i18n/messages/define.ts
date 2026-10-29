/** A text, or a text with a singular and a plural form (picked by {count}). */
export type Message = string | { one: string; other: string };

/** The German catalogue must have exactly the English keys and the same kind of message. */
export type Translation<T extends Record<string, Message>> = {
  [K in keyof T]: T[K] extends string ? string : { one: string; other: string };
};
