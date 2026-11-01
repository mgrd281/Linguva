import {
  escapeXml,
  parseMarkup,
  type MarkupNode,
} from "../translation/segment-markup";
import {
  TranslationProviderError,
  type ProviderErrorKind,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "./types";

export interface MockProviderOptions {
  /** Fail the next N calls with this error kind (for failure tests). `Infinity`: every call. */
  failNext?: { count: number; kind: ProviderErrorKind };
  /** The provider's id and the errors' provider; default "mock" (the Own key plan's mock members use the engine id). */
  id?: string;
}

function serialize(nodes: MarkupNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "x") return `<x id="${node.id}"/>`;
      if (node.kind === "g") return `<g id="${node.id}">${serialize(node.children)}</g>`;
      return escapeXml(node.value);
    })
    .join("");
}

/**
 * Deterministic pseudo-translation for development and tests: prefixes each
 * segment with the target locale ("[de] Blue jacket") and keeps every inline
 * code and number intact, so results pass validation like a real provider's
 * would. Refused in production by config validation.
 */
export class MockTranslationProvider implements TranslationProvider {
  readonly id: string;
  readonly requests: TranslationRequest[] = [];
  private failuresLeft: number;

  constructor(private readonly options: MockProviderOptions = {}) {
    this.id = options.id ?? "mock";
    this.failuresLeft = options.failNext?.count ?? 0;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.requests.push(request);
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new TranslationProviderError(this.id, this.options.failNext!.kind, "simulated failure");
    }
    const tag = `[${request.targetLocale}] `;
    return {
      translations: request.segments.map((s) => tag + serialize(parseMarkup(s))),
      billedCharacters: request.segments.reduce((sum, s) => sum + s.length, 0),
      provider: this.id,
    };
  }
}
