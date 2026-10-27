import { parseFragment, serialize } from "parse5";
import { describe, expect, it } from "vitest";
import {
  segmentHtml,
  segmentPlainText,
} from "../../app/.server/translation/html-segmenter";
import { SegmentStructureError } from "../../app/.server/translation/segment-markup";

const normalized = (html: string) => serialize(parseFragment(html));

function translateAll(
  html: string,
  fn: (source: string) => string,
  options = {},
) {
  const doc = segmentHtml(html, options);
  const map = new Map(doc.segments.map((s) => [s.id, fn(s.source)]));
  return { doc, output: doc.render(map) };
}

describe("segmentHtml: segmentation", () => {
  it("creates one segment per block and keeps inline elements as codes", () => {
    const doc = segmentHtml(
      '<h2>Features</h2><p>Buy <strong>two</strong> and <a href="/sale">save</a> today.</p>',
    );
    expect(doc.segments.map((s) => s.source)).toEqual([
      "Features",
      'Buy <g id="1">two</g> and <g id="2">save</g> today.',
    ]);
    expect(doc.segments[1]!.text).toBe("Buy two and save today.");
  });

  it("never exposes attributes such as href or class to the provider", () => {
    const doc = segmentHtml('<p class="x" data-id="7">See <a href="https://shop.test/p?a=1">this</a></p>');
    for (const s of doc.segments) {
      expect(s.source).not.toMatch(/href|class|data-id|shop\.test/);
    }
  });

  it("splits list items and table cells into separate segments", () => {
    const doc = segmentHtml(
      "<ul><li>Waterproof</li><li>Lightweight</li></ul><table><tr><td>Weight</td><td>2 kg</td></tr></table>",
    );
    expect(doc.segments.map((s) => s.source)).toEqual([
      "Waterproof",
      "Lightweight",
      "Weight",
      "2 kg",
    ]);
  });

  it("skips script, style, pre, code blocks and translate=no content", () => {
    const doc = segmentHtml(
      '<p>Hello</p><script>var a = "text";</script><style>p{}</style><pre>keep me</pre>' +
        '<div translate="no">Brand Name GmbH</div><p class="notranslate">Fixed</p>',
    );
    expect(doc.segments.map((s) => s.source)).toEqual(["Hello"]);
  });

  it("keeps inline code and notranslate spans as opaque codes", () => {
    const doc = segmentHtml('<p>Run <code>npm i</code> with <span class="notranslate">ACME</span> now</p>');
    expect(doc.segments[0]!.source).toBe('Run <x id="1"/> with <x id="2"/> now');
  });

  it("protects Liquid, placeholders, URLs and e-mails", () => {
    const doc = segmentHtml(
      "<p>Hi {{ customer.first_name }}, {% if x %}visit{% endif %} https://example.com/a or mail info@example.com {name}</p>",
    );
    const source = doc.segments[0]!.source;
    expect(source).not.toContain("customer.first_name");
    expect(source).not.toContain("example.com");
    expect(source).not.toContain("{name}");
    expect(source).toContain("visit");
  });

  it("protects merchant terms with word boundaries and SKU patterns", () => {
    const doc = segmentHtml("<p>The KARINEX Pro and Product SKU-1234-AB</p>", {
      protectedTerms: [{ term: "KARINEX Pro" }, { term: "Pro" }],
      patterns: [/SKU-\d{4}-[A-Z]{2}/],
    });
    const source = doc.segments[0]!.source;
    expect(source).toBe('The <x id="1"/> and Product <x id="2"/>');
  });

  it("extracts translatable attributes but not URLs", () => {
    const doc = segmentHtml('<p><img src="/a.png" alt="Red running shoe"> <a title="Open details" href="/x">Details</a></p>');
    const attrs = doc.segments.filter((s) => s.kind === "attribute").map((s) => s.source);
    expect(attrs).toEqual(["Red running shoe", "Open details"]);
  });

  it("produces no segments for content without letters", () => {
    expect(segmentHtml("<p>  </p><p>2024</p><p>{{ price }}</p>").segments).toEqual([]);
  });
});

describe("segmentHtml: rendering", () => {
  it("returns the normalized source when nothing is translated", () => {
    const html = '<p>Buy <b>now</b></p><img alt="Shoe" src="a.png">';
    expect(segmentHtml(html).render(new Map())).toBe(normalized(html));
  });

  it("is an identity transform when translations equal the source", () => {
    const html =
      '<div><h1>Title</h1><p>Hello <em>big</em> {{ shop.name }} <br>world &amp; more&nbsp;!</p>' +
      '<img src="x.png" alt="Alt text"><ul><li>One</li></ul></div>';
    const { output } = translateAll(html, (s) => s);
    expect(output).toBe(normalized(html));
  });

  it("restores tags and attributes from the source and allows reordering", () => {
    const html = '<p>Buy <strong>two</strong> and <a href="/sale" class="c">save</a>.</p>';
    const doc = segmentHtml(html);
    const output = doc.render(
      new Map([["c0", 'Mit <g id="2">Sparen</g> beim Kauf von <g id="1">zwei</g>.']]),
    );
    expect(output).toBe('<p>Mit <a href="/sale" class="c">Sparen</a> beim Kauf von <strong>zwei</strong>.</p>');
  });

  it("restores protected spans verbatim", () => {
    const html = "<p>Hi {{ customer.name }}, see https://example.com/x</p>";
    const { output } = translateAll(html, (s) => s.replace("Hi", "Hallo").replace("see", "siehe"));
    expect(output).toBe("<p>Hallo {{ customer.name }}, siehe https://example.com/x</p>");
  });

  it("escapes markup returned by a provider instead of rendering it", () => {
    const html = "<p>Hello world</p>";
    const doc = segmentHtml(html);
    const output = doc.render(
      new Map([["c0", '<script>alert(1)</script><img src=x onerror=alert(1)> Hallo']]),
    );
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;script&gt;");
    const fragment = parseFragment(output);
    const p = fragment.childNodes[0] as { childNodes: unknown[] };
    expect(p.childNodes).toHaveLength(1); // a single text node
  });

  it("escapes markup returned for attributes", () => {
    const doc = segmentHtml('<img src="a.png" alt="Shoe">');
    const output = doc.render(new Map([[doc.segments[0]!.id, '" onerror="alert(1)']]));
    expect(output).toBe('<img src="a.png" alt="&quot; onerror=&quot;alert(1)">');
  });

  it("translates alt text of images that sit inside a sentence", () => {
    const html = '<p>Look <img src="a.png" alt="Red shoe"> here</p>';
    const doc = segmentHtml(html);
    const map = new Map(
      doc.segments.map((s) => [s.id, s.kind === "attribute" ? "Roter Schuh" : 'Schau <x id="1"/> hier']),
    );
    expect(doc.render(map)).toBe('<p>Schau <img src="a.png" alt="Roter Schuh"> hier</p>');
  });

  it("decodes entities sent back by providers", () => {
    const doc = segmentHtml("<p>Fish &amp; chips</p>");
    expect(doc.segments[0]!.source).toBe("Fish &amp; chips");
    expect(doc.render(new Map([["c0", "Fisch &amp; Pommes &lt;3"]]))).toBe(
      "<p>Fisch &amp; Pommes &lt;3</p>",
    );
  });

  it("keeps surrounding whitespace of a run", () => {
    const doc = segmentHtml("<p>\n  Hello\n</p>");
    expect(doc.segments[0]!.source).toBe("Hello");
    expect(doc.render(new Map([["c0", "Hallo"]]))).toBe("<p>\n  Hallo\n</p>");
  });

  it("renders the same document twice independently", () => {
    const doc = segmentHtml("<p>Hello</p>");
    expect(doc.render(new Map([["c0", "Hallo"]]))).toBe("<p>Hallo</p>");
    expect(doc.render(new Map([["c0", "Bonjour"]]))).toBe("<p>Bonjour</p>");
  });
});

describe("segmentHtml: structure validation", () => {
  const html = '<p>Buy <b>two</b> now <br> ok</p>';

  it.each([
    ["missing code", 'Kaufe zwei jetzt <x id="2"/> ok', "MISSING_CODE"],
    ["duplicated code", 'Kaufe <g id="1">zwei</g> <g id="1">x</g> <x id="2"/>', "DUPLICATE_CODE"],
    ["unknown code", 'Kaufe <g id="1">zwei</g> <x id="2"/> <x id="9"/>', "UNKNOWN_CODE"],
    ["kind mismatch", 'Kaufe <x id="1"/> <x id="2"/>', "CODE_KIND_MISMATCH"],
    ["unbalanced", 'Kaufe <g id="1">zwei <x id="2"/>', "UNBALANCED_TAGS"],
  ])("rejects a translation with a %s", (_label, target, code) => {
    const doc = segmentHtml(html);
    expect(() => doc.render(new Map([["c0", target]]))).toThrowError(
      expect.objectContaining({ code }),
    );
    expect(() => doc.render(new Map([["c0", target]]))).toThrow(SegmentStructureError);
  });

  it("accepts tolerant code spellings from providers", () => {
    const doc = segmentHtml(html);
    expect(
      doc.render(new Map([["c0", "Kaufe <g id='1'>zwei</g> jetzt <x id=\"2\" /> ok"]])),
    ).toBe("<p>Kaufe <b>zwei</b> jetzt <br> ok</p>");
  });
});

describe("segmentPlainText", () => {
  it("translates titles and keeps protected spans", () => {
    const doc = segmentPlainText("  Winter Jacket {{ size }}  ");
    expect(doc.segments[0]!.source).toBe('Winter Jacket <x id="1"/>');
    expect(doc.render(new Map([["c0", 'Winterjacke <x id="1"/>']]))).toBe("  Winterjacke {{ size }}  ");
  });

  it("treats angle brackets in plain text as text", () => {
    const doc = segmentPlainText("Size <M> & up");
    expect(doc.segments[0]!.source).toBe("Size &lt;M&gt; &amp; up");
    expect(doc.render(new Map([["c0", "Größe &lt;M&gt; &amp; mehr"]]))).toBe("Größe <M> & mehr");
  });

  it("returns the source when no translation is given or nothing is translatable", () => {
    expect(segmentPlainText("Shoe").render(new Map())).toBe("Shoe");
    expect(segmentPlainText("12345").segments).toEqual([]);
  });

  it("rejects plain-text translations that drop a protected span", () => {
    const doc = segmentPlainText("Hello {name}");
    expect(() => doc.render(new Map([["c0", "Hallo"]]))).toThrow(/MISSING_CODE/);
  });
});
