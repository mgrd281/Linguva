/**
 * Editor support for resources attached to the edited resource: image alt
 * text and translatable metafields.
 *
 * Security: the attached resources are always listed from Shopify for the
 * edited parent. Form values are only read under names built from that
 * list, so a value posted for any other GID (another product's image, a
 * metafield of another owner) is never read, let alone written.
 */
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { logger } from "../lib/logger";
import { listAttachedResources, type AttachedResource } from "../shopify/attached-resources";
import type { ResourceKind, TranslatableKind } from "../../lib/resource-kinds";
import { collectEditorEdits } from "./editor-edits";
import { sameRichTextStructure } from "./rich-text";
import { isMachineTranslatable } from "./translate-fields";
import { translationDigest, type TranslationEdit } from "./product-translation-service";

type Admin = Pick<AdminApiContext, "graphql">;

/** Owners that can have image alt text or metafields Linguva edits. */
const ATTACHED_KINDS = new Set<TranslatableKind>(["PRODUCT", "COLLECTION", "PAGE", "ARTICLE", "BLOG"] satisfies ResourceKind[]);

/**
 * Content types edited here. Rich text, JSON, lists, links and file
 * references have a structure a text box can break; they are counted and
 * left to Shopify's own editor for now.
 */
const EDITABLE_TYPES = new Set(["SINGLE_LINE_TEXT_FIELD", "MULTI_LINE_TEXT_FIELD", "STRING", "HTML", "INLINE_RICH_TEXT", "RICH_TEXT_FIELD"]);

/** At most this many attached resources per AI request (cost and time). */
export const MAX_ATTACHED_AI_RESOURCES = 25;

/** Form field name of an attached resource's field, e.g. value:gid://shopify/MediaImage/1:alt. */
export function attachedFieldName(part: "value" | "digest" | "origin" | "confirm" | "current", resourceId: string, key: string) {
  return `${part}:${resourceId}:${key}`;
}

export function attachedRef(resourceId: string, key: string) {
  return `${resourceId}:${key}`;
}

export function isEditableAttachedField(field: { type: string }) {
  return EDITABLE_TYPES.has(field.type);
}

export async function listEditorAttachments(admin: Admin, kind: TranslatableKind, parentGid: string, locale: string) {
  if (!ATTACHED_KINDS.has(kind)) return [];
  return listAttachedResources(admin, parentGid, locale);
}

/** Loader data for the editor's "Images and custom fields" section. */
export async function loadAttachedData(admin: Admin, kind: TranslatableKind, parentGid: string, locale: string) {
  let resources: AttachedResource[];
  try {
    resources = await listEditorAttachments(admin, kind, parentGid, locale);
  } catch (error) {
    // The main editor keeps working when this optional section can't load.
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "attached resources unavailable");
    return { available: false, items: [], imagesWithoutAlt: 0, unsupported: 0 };
  }
  let imagesWithoutAlt = 0;
  let unsupported = 0;
  const items = resources.flatMap((r) => {
    const translations = new Map(r.translations.map((t) => [t.key, t]));
    const withValue = r.content.filter((c) => c.value && c.value.trim() && c.digest);
    if (r.kind === "IMAGE" && withValue.length === 0) imagesWithoutAlt++;
    const fields = withValue.filter((c) => {
      if (isEditableAttachedField(c)) return true;
      unsupported++;
      return false;
    });
    if (!fields.length) return [];
    return [
      {
        id: r.resourceId,
        kind: r.kind,
        label: r.label,
        detail: r.detail ?? null,
        previewUrl: r.previewUrl ?? null,
        valueType: r.valueType ?? null,
        fields: fields.map((c) => ({
          key: c.key,
          type: c.type,
          source: c.value!,
          digest: c.digest!,
          translation: translations.get(c.key)?.value ?? "",
          currentDigest: translationDigest(translations.get(c.key)?.value),
          outdated: translations.get(c.key)?.outdated ?? false,
          machine: isMachineTranslatable({ key: c.key, value: c.value, type: c.type }),
        })),
      },
    ];
  });
  return { available: true, items, imagesWithoutAlt, unsupported };
}

/** Edits per attached resource, read only under names built from the server's list. */
export function collectAttachedEdits(
  resources: readonly AttachedResource[],
  form: Pick<FormData, "get">,
): Array<{ resource: AttachedResource; edits: TranslationEdit[]; rejected: string[] }> {
  return resources.flatMap((resource) => {
    const scoped = {
      get(name: string) {
        const match = /^(value|digest|origin|confirm|current):(.+)$/.exec(name);
        if (!match) return form.get(name);
        return form.get(attachedFieldName(match[1] as "value", resource.resourceId, match[2]!));
      },
    };
    const editable = { ...resource, content: resource.content.filter(isEditableAttachedField) };
    const sources = new Map(editable.content.map((c) => [c.key, c]));
    const edits: TranslationEdit[] = [];
    const rejected: string[] = [];
    for (const edit of collectEditorEdits(editable, scoped)) {
      const source = sources.get(edit.key);
      // Rich text is saved only as rich text with the original's structure
      // and links (a posted value is never trusted to be well-formed).
      if (source?.type === "RICH_TEXT_FIELD" && !sameRichTextStructure(edit.value, source.value ?? "")) rejected.push(edit.key);
      else edits.push(edit);
    }
    return edits.length || rejected.length ? [{ resource, edits, rejected }] : [];
  });
}

/** Attached fields worth sending to AI: machine-translatable and missing or outdated. */
export function attachedAiTargets(resources: readonly AttachedResource[]) {
  return resources
    .map((r) => {
      const translations = new Map(r.translations.map((t) => [t.key, t]));
      const keys = r.content
        .filter((c) => c.value && c.value.trim() && c.digest && isEditableAttachedField(c) && isMachineTranslatable(c))
        .filter((c) => {
          const t = translations.get(c.key);
          return !t?.value || t.outdated;
        })
        .map((c) => c.key);
      return { resourceId: r.resourceId, keys };
    })
    .filter((t) => t.keys.length)
    .slice(0, MAX_ATTACHED_AI_RESOURCES);
}
