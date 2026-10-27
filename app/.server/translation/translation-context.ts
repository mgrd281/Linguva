import type { PrismaClient } from "@prisma/client";
import { resolveGlossary, type ResolvedGlossary } from "../glossary/glossary";
import { prisma as defaultClient } from "../lib/db";
import { lookupExact, type MemoryContext } from "../memory/translation-memory";
import type { MemoryLookup } from "./translate-fields";

export interface TranslationContext {
  glossary: ResolvedGlossary;
  memory: MemoryLookup;
  memoryContext: MemoryContext;
}

/** Glossary and memory for one shop, language pair and market. */
export async function loadTranslationContext(
  input: {
    shopId: string;
    sourceLocale: string;
    targetLocale: string;
    market?: string;
    reuseMachineMemory: boolean;
  },
  client: PrismaClient = defaultClient,
): Promise<TranslationContext> {
  const memoryContext: MemoryContext = {
    shopId: input.shopId,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    market: input.market ?? "",
  };
  return {
    glossary: await resolveGlossary(input.shopId, input.targetLocale, input.market ?? "", client),
    memoryContext,
    memory: {
      lookup: (sources) =>
        lookupExact(memoryContext, sources, { allowMachine: input.reuseMachineMemory }, client),
    },
  };
}
