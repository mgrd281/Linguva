import type { PrismaClient } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { prisma as defaultClient } from "../lib/db";
import { getTranslatableResource } from "../shopify/translations-api";
import { saveResourceTranslations, type SaveOutcome } from "./product-translation-service";
import { getRevision } from "./revisions";

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
