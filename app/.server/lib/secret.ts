/**
 * The only form a merchant's engine key takes on the server once it is typed
 * or decrypted (Own key plan, docs/SECURITY_MODEL.md). The value lives in an
 * ES private field, which JSON.stringify, Object.keys, object spread,
 * structuredClone and util.inspect never see, so a SecretValue nested at any
 * depth in loader data, job data or a log context prints "[REDACTED]".
 */
const REDACTED = "[REDACTED]";

export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Only where an outgoing request is built (adapter construction inside SealedProvider, the key check). */
  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
