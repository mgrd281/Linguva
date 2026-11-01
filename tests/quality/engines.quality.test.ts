/**
 * Live contract check of Microsoft Azure and Google Cloud's markup handling
 * (docs/AI_ENGINES.md, "not documented" points): synthetic samples only, sent
 * through the adapters (HTML dialect) and, for comparison, in the native
 * dialect through the same request builders; every answer decoded and
 * checked against our codes. Records the raw output shapes (synthetic, safe
 * to print), which dialect round-trips, entities, whitespace and line breaks,
 * notes, Azure's X-metered-usage vs the text and wire lengths, and latency.
 * Writes docs/quality/ENGINE_CONTRACT.md.
 *
 * Safety: runs only on the owner's machine: CI unset, LINGUVA_ENGINE_CONTRACT=yes
 * and that engine's own credentials in the local environment (the vitest
 * projects of `pnpm test` blank them and refuse the hosts). A budget
 * (ENGINE_CONTRACT_MAX_CHARS, default 3,000 wire characters per engine) is
 * checked before any call. Keys, tokens and the credentials file are never
 * printed; errors show their status and code only.
 *
 *   LINGUVA_ENGINE_CONTRACT=yes AZURE_TRANSLATOR_KEY=… AZURE_TRANSLATOR_REGION=westeurope pnpm test:engines
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AzureTranslatorProvider, azureTranslateRequest, resolveAzureLanguage, type AzureOptions } from "../../app/.server/providers/azure";
import { parseServiceAccount, GoogleTokenSource } from "../../app/.server/providers/google-auth";
import { GoogleTranslateProvider, googleTranslateRequest, resolveGoogleLanguage, type GoogleAuth } from "../../app/.server/providers/google";
import { decodeSegment, encodeSegment, type WireSegment } from "../../app/.server/providers/html-transport";
import { assertSameCodes, parseMarkup } from "../../app/.server/translation/segment-markup";

const RUN = !process.env.CI && process.env.LINGUVA_ENGINE_CONTRACT === "yes";
const MAX_CHARS = Number(process.env.ENGINE_CONTRACT_MAX_CHARS ?? 3_000);
const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY?.trim();
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION?.trim().toLowerCase().replace(/\s+/g, "") || undefined;
const GOOGLE_KEY = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
const GOOGLE_CREDENTIALS = process.env.GOOGLE_TRANSLATE_CREDENTIALS ? parseServiceAccount(process.env.GOOGLE_TRANSLATE_CREDENTIALS) : null;

/** Synthetic samples (no store data). */
const SAMPLES = [
  'Buy <g id="1">two</g> jackets and save <x id="2"/> today.',
  'Use code <x id="1"/> &amp; get <g id="2"><g id="3">free</g> shipping</g>.',
  "Tom &amp; Jerry's \"best\" &lt;deal&gt;",
  "First line\nsecond line",
  "Warm socks 🧦 for winter",
  // An empty group (an icon <i>): how each engine serialises it (self-closed groups are refused).
  '<g id="1"></g> Free shipping',
];
const TARGETS = ["de", "fr", "ar", "ja", "zh-TW"];

interface Row {
  engine: string;
  dialect: "html" | "native";
  target: string;
  sample: number;
  output: string;
  ok: boolean;
  note: string;
  ms: number;
  metered?: string | null;
}

/** The source's codes by id and kind, as the pipeline checks them. */
function kinds(source: string): Map<number, "g" | "x"> {
  const codes = new Map<number, "g" | "x">();
  const visit = (nodes: ReturnType<typeof parseMarkup>) => {
    for (const node of nodes) {
      if (node.kind === "text") continue;
      codes.set(node.id, node.kind);
      if (node.kind === "g") visit(node.children);
    }
  };
  visit(parseMarkup(source));
  return codes;
}

/** "" when the decoded output passes parseMarkup + assertSameCodes, else the refusal's name. */
function roundTrips(source: string, decoded: string): string {
  try {
    assertSameCodes(parseMarkup(decoded), kinds(source));
    return "";
  } catch (error) {
    return (error as Error).name;
  }
}

function wireLength(dialect: "html" | "native"): number {
  return SAMPLES.reduce((sum, s) => sum + encodeSegment(s, { dialect }).wire.length, 0) * TARGETS.length;
}

/** One section per engine that ran; written once at the end. */
const sections: string[] = [];

function report(name: string, rows: Row[]) {
  const lines = [
    `## ${name}`,
    "",
    "| Dialect | Target | Sample | Round-trips | Note | ms | Metered | Raw output |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.dialect} | ${r.target} | ${r.sample + 1} | ${r.ok ? "yes" : "no"} | ${r.note} | ${Math.round(r.ms)} | ${r.metered ?? ""} | \`${r.output.replace(/\|/g, "\\|").replace(/\n/g, "⏎")}\` |`),
    "",
  ];
  return lines.join("\n");
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await fn();
  return [value, performance.now() - start];
}

describe.skipIf(!RUN || !AZURE_KEY)("Microsoft Azure Translator, live (owner's machine only)", () => {
  it("round-trips our markup and records what comes back", async () => {
    expect(wireLength("html") + wireLength("native"), "planned wire characters exceed ENGINE_CONTRACT_MAX_CHARS").toBeLessThanOrEqual(MAX_CHARS);
    const options: AzureOptions = { key: AZURE_KEY!, region: AZURE_REGION };
    const provider = new AzureTranslatorProvider(options);
    const codes = await provider.targetLanguages();
    const rows: Row[] = [];
    for (const target of TARGETS) {
      // HTML dialect through the adapter.
      const [result, ms] = await timed(() => provider.translate({ segments: SAMPLES, sourceLocale: "en", targetLocale: target, softBreaks: SAMPLES.map(() => false) }));
      result.translations.forEach((output, i) => {
        const note = result.notes?.find((n) => n.index === i)?.code ?? roundTrips(SAMPLES[i]!, output);
        rows.push({ engine: "azure", dialect: "html", target, sample: i, output, ok: note === "", note, ms: ms / SAMPLES.length });
      });
      // Native dialect: the same request builder, the real fetch.
      const encoded: WireSegment[] = SAMPLES.map((s) => encodeSegment(s, { dialect: "native" }));
      const to = resolveAzureLanguage(codes, target) ?? target;
      for (const mode of ["html", "plain"] as const) {
        const items = encoded.map((segment, index) => ({ segment, index })).filter((item) => item.segment.mode === mode);
        if (items.length === 0) continue;
        const { url, init } = azureTranslateRequest(options, items.map((item) => item.segment.wire), mode, "en", to);
        const [response, nativeMs] = await timed(() => fetch(url, init));
        if (!response.ok) {
          rows.push({ engine: "azure", dialect: "native", target, sample: items[0]!.index, output: "", ok: false, note: `HTTP ${response.status}`, ms: nativeMs });
          await response.body?.cancel();
          continue;
        }
        const metered = response.headers.get("x-metered-usage");
        const body = (await response.json()) as Array<{ translations: Array<{ text: string }> }>;
        items.forEach((item, k) => {
          const output = body[k]?.translations?.[0]?.text ?? "";
          const decoded = decodeSegment(output, item.segment, target);
          const note = decoded.note ?? roundTrips(SAMPLES[item.index]!, decoded.text);
          rows.push({ engine: "azure", dialect: "native", target, sample: item.index, output, ok: note === "", note, ms: nativeMs / items.length, metered });
        });
      }
    }
    // The operator card's key check (checkKey): one empty text through the same builder. Recorded:
    // its status and that Azure meters it at 0 characters.
    const check = azureTranslateRequest(options, [""], "plain", "en", "de");
    const checkResponse = await fetch(check.url, check.init);
    const checkMetered = checkResponse.headers.get("x-metered-usage");
    await checkResponse.body?.cancel();
    expect(await provider.checkKey()).toBe("ok");
    sections.push(`${report("Microsoft Azure Translator", rows)}\nKey check (empty translate call): HTTP ${checkResponse.status}, X-metered-usage ${checkMetered ?? "absent"}.\n`);
    expect(checkMetered === null || checkMetered === "0", "the key check must not be billed").toBe(true);
  });
});

describe.skipIf(!RUN || (!GOOGLE_KEY && !GOOGLE_CREDENTIALS))("Google Cloud Translation, live (owner's machine only)", () => {
  it("round-trips our markup and records what comes back", async () => {
    expect(wireLength("html") + wireLength("native"), "planned wire characters exceed ENGINE_CONTRACT_MAX_CHARS").toBeLessThanOrEqual(MAX_CHARS);
    const auth: GoogleAuth = GOOGLE_CREDENTIALS ? { kind: "serviceAccount", credentials: GOOGLE_CREDENTIALS } : { kind: "apiKey", apiKey: GOOGLE_KEY! };
    const provider = new GoogleTranslateProvider({ auth });
    const codes = await provider.targetLanguages();
    const tokens = GOOGLE_CREDENTIALS ? new GoogleTokenSource(GOOGLE_CREDENTIALS) : null;
    const rows: Row[] = [];
    for (const target of TARGETS) {
      const [result, ms] = await timed(() => provider.translate({ segments: SAMPLES, sourceLocale: "en", targetLocale: target, softBreaks: SAMPLES.map(() => false) }));
      result.translations.forEach((output, i) => {
        const note = result.notes?.find((n) => n.index === i)?.code ?? roundTrips(SAMPLES[i]!, output);
        rows.push({ engine: "google", dialect: "html", target, sample: i, output, ok: note === "", note, ms: ms / SAMPLES.length });
      });
      const encoded = SAMPLES.map((s) => encodeSegment(s, { dialect: "native" }));
      const to = resolveGoogleLanguage(codes, target) ?? target;
      for (const mode of ["html", "plain"] as const) {
        const items = encoded.map((segment, index) => ({ segment, index })).filter((item) => item.segment.mode === mode);
        if (items.length === 0) continue;
        const token = tokens ? await tokens.token() : null;
        const { url, init } = googleTranslateRequest(auth, token, items.map((item) => item.segment.wire), mode, "en", to);
        const [response, nativeMs] = await timed(() => fetch(url, init));
        if (!response.ok) {
          rows.push({ engine: "google", dialect: "native", target, sample: items[0]!.index, output: "", ok: false, note: `HTTP ${response.status}`, ms: nativeMs });
          await response.body?.cancel();
          continue;
        }
        const body = (await response.json()) as { data?: { translations?: Array<{ translatedText?: string }> }; translations?: Array<{ translatedText?: string }> };
        const entries = body.data?.translations ?? body.translations ?? [];
        items.forEach((item, k) => {
          const output = entries[k]?.translatedText ?? "";
          const decoded = decodeSegment(output, item.segment, target);
          const note = decoded.note ?? roundTrips(SAMPLES[item.index]!, decoded.text);
          rows.push({ engine: "google", dialect: "native", target, sample: item.index, output, ok: note === "", note, ms: nativeMs / items.length });
        });
      }
    }
    sections.push(report(`Google Cloud Translation (${auth.kind === "apiKey" ? "v2, API key" : "v3, EU endpoint"})`, rows));
  });
});

afterAll(() => {
  if (sections.length === 0) return;
  const markdown = [
    "# Translation engines: live markup contract",
    "",
    `Measured ${new Date().toISOString().slice(0, 10)} with synthetic samples (tests/quality/engines.quality.test.ts). Raw outputs are the engines' answers to these samples; no store data, no keys.`,
    "",
    "Samples:",
    ...SAMPLES.map((sample, i) => `${i + 1}. \`${sample.replace(/\n/g, "⏎")}\``),
    "",
    ...sections,
  ].join("\n");
  const dir = join(__dirname, "..", "..", "docs", "quality");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ENGINE_CONTRACT.md"), `${markdown}\n`);
});
