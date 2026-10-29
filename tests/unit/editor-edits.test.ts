import { describe, expect, it } from "vitest";
import { collectEditorEdits } from "../../app/.server/translation/editor-edits";

const resource = {
  resourceId: "gid://shopify/Product/1",
  content: [
    { key: "title", value: "Jacket", digest: "d1", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" },
    { key: "body_html", value: "<p>Warm</p>", digest: "d2", locale: "en", type: "HTML" },
    { key: "meta_title", value: "SEO", digest: "d3", locale: "en", type: "SINGLE_LINE_TEXT_FIELD" },
  ],
  translations: [
    { key: "title", value: "Jacke", outdated: true, updatedAt: null },
    { key: "body_html", value: "<p>Warm DE</p>", outdated: false, updatedAt: null },
  ],
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("collectEditorEdits", () => {
  it("never re-saves an unchanged outdated translation silently", () => {
    const edits = collectEditorEdits(
      resource,
      form({ "value:title": "Jacke", "digest:title": "d1", "value:body_html": "<p>Neu</p>", "digest:body_html": "d2" }),
    );
    expect(edits.map((e) => e.key)).toEqual(["body_html"]);
  });

  it("re-saves an unchanged outdated translation only when the merchant confirms it", () => {
    const edits = collectEditorEdits(resource, form({ "value:title": "Jacke", "digest:title": "d1", "confirm:title": "on" }));
    expect(edits).toEqual([
      { key: "title", value: "Jacke", digest: "d1", origin: "MANUAL", provider: null, approved: true },
    ]);
  });

  it("ignores confirmation of a current translation and empty untouched fields", () => {
    const edits = collectEditorEdits(
      resource,
      form({ "value:body_html": "<p>Warm DE</p>", "digest:body_html": "d2", "confirm:body_html": "on", "value:meta_title": "", "digest:meta_title": "d3" }),
    );
    expect(edits).toEqual([]);
  });

  it("marks AI-filled fields with their origin and provider", () => {
    const edits = collectEditorEdits(
      resource,
      form({ "value:meta_title": "SEO DE", "digest:meta_title": "d3", "origin:meta_title": "AI", provider: "deepl" }),
    );
    expect(edits[0]).toMatchObject({ key: "meta_title", origin: "AI", provider: "deepl", approved: true });
  });
});
