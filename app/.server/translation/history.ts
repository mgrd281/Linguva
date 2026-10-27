import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { getTranslatableResource, removeTranslations } from "../shopify/translations-api";
import { externalDigest, saveResourceTranslations, type SaveOutcome } from "./product-translation-service";
import { getRevision, latestRevisions, revisionKey } from "./revisions";
import { withTenant } from "../tenancy/with-tenant";

type Admin = Pick<AdminApiContext, "graphql">;

export type RestoreResult =
  | { status: "restored" }
  | { status: "not_found" }
  | { status: "source_changed" }
  | { status: "failed"; outcome: SaveOutcome | undefined };

/**
 * Restores an earlier translation. Shopify accepts a translation only for
 * the current source (digest), so a revision can be restored only while the
 * source text is the same as when that revision was written. Restoring
 * creates a new revision that points to the restored one.
 */
export async function restoreRevision(
  input: {
    admin: Admin;
    shopId: string;
    actorId: string | null;
    revisionId: string;
    /** When set, only a revision of this resource is restored. */
    resourceGid?: string;
  },
  client: PrismaClient = defaultClient,
): Promise<RestoreResult> {
  const revision = await getRevision(input.shopId, input.revisionId, client);
  if (!revision) return { status: "not_found" };
  if (input.resourceGid && revision.resourceGid !== input.resourceGid) return { status: "not_found" };

  const resource = await getTranslatableResource(input.admin, revision.resourceGid, revision.locale);
  const field = resource?.content.find((f) => f.key === revision.key);
  if (!field?.digest) return { status: "not_found" };
  if (field.digest !== revision.sourceDigest) return { status: "source_changed" };

  const [outcome] = await saveResourceTranslations(
    {
      admin: input.admin,
      shopId: input.shopId,
      actorId: input.actorId,
      resourceId: revision.resourceGid,
      locale: revision.locale,
      edits: [
        {
          key: revision.key,
          value: revision.value,
          digest: field.digest,
          origin: "MANUAL",
          approved: true,
          restoredFromId: revision.id,
        },
      ],
    },
    client,
  );
  return outcome?.status === "saved" ? { status: "restored" } : { status: "failed", outcome };
}

export type RemoveResult = { status: "removed" } | { status: "not_found" } | { status: "failed"; message: string };

/**
 * Removes a field's translation in Shopify (the storefront then shows the
 * original text). The removed value is kept as a revision first, so it can
 * be restored while the source is unchanged. Only the market-independent
 * translation is removed.
 */
export async function removeTranslation(
  input: { admin: Admin; shopId: string; actorId: string | null; resourceGid: string; locale: string; key: string },
  client: PrismaClient = defaultClient,
): Promise<RemoveResult> {
  const resource = await getTranslatableResource(input.admin, input.resourceGid, input.locale);
  const field = resource?.content.find((f) => f.key === input.key);
  const current = resource?.translations.find((t) => t.key === input.key);
  if (!field?.digest || !current?.value) return { status: "not_found" };

  const latest = (await latestRevisions(input.shopId, [input.resourceGid], input.locale, client)).get(
    revisionKey(input.resourceGid, input.key),
  );
  if (latest?.value !== current.value) {
    // Not recorded by Linguva yet (made elsewhere): keep it as history.
    await withTenant(
      input.shopId,
      (tx) =>
        tx.translationRevision.createMany({
          data: [
            {
              shopId: input.shopId,
              resourceGid: input.resourceGid,
              key: input.key,
              locale: input.locale,
              value: current.value!,
              sourceDigest: externalDigest(field.digest!, current.outdated),
              origin: "EXTERNAL",
              approved: true,
            },
          ],
        }),
      client,
    );
  }

  const result = await removeTranslations(input.admin, input.resourceGid, input.locale, [input.key]);
  if (result.userErrors.length) return { status: "failed", message: result.userErrors[0]!.message };
  await client.auditLog.createMany({
    data: [
      {
        shopId: input.shopId,
        actorType: input.actorId ? "MERCHANT_USER" : "SYSTEM",
        actorId: input.actorId,
        action: "translations.removed",
        targetType: "TranslatableResource",
        targetId: input.resourceGid,
        metadata: { locale: input.locale, keys: [input.key] },
      },
    ],
  });
  return { status: "removed" };
}
