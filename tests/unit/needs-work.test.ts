import { describe, expect, it } from "vitest";
import { fieldsNeedingTranslation } from "../../app/.server/jobs/needs-work";

const content = [
  { key: "title", value: "Jacket", digest: "d1", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" },
  { key: "body_html", value: "<p>Warm</p>", digest: "d2", locale: "en", type: "HTML" },
  { key: "meta_title", value: "SEO", digest: "d3", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" },
  { key: "meta_description", value: "", digest: "d4", locale: "en", type: "MULTI_LINE_TEXT_FIELD" },
  { key: "handle", value: "jacket", digest: "d5", locale: "en", type: "URI" },
];

describe("fieldsNeedingTranslation", () => {
  it("selects missing and outdated machine-translatable fields only", () => {
    const keys = fieldsNeedingTranslation({
      resourceId: "gid://shopify/Product/1",
      content,
      translations: [
        { key: "title", value: "Jacke", outdated: false, updatedAt: null },
        { key: "body_html", value: "<p>Warm</p>", outdated: true, updatedAt: null },
        { key: "meta_title", value: " ", outdated: false, updatedAt: null },
      ],
    }).map((f) => f.key);
    // title is current (never overwritten), handle is manual-only, the empty
    // source is ignored.
    expect(keys).toEqual(["body_html", "meta_title"]);
  });

  it("returns nothing for a fully translated resource", () => {
    expect(
      fieldsNeedingTranslation({
        resourceId: "gid://shopify/Product/1",
        content: content.slice(0, 1),
        translations: [{ key: "title", value: "Jacke", outdated: false, updatedAt: null }],
      }),
    ).toEqual([]);
  });
});
