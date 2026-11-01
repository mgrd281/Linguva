import { describe, expect, it } from "vitest";
import {
  decodeSegment,
  encodeSegment,
  UNMAPPABLE_SEGMENT,
  type WireSegment,
} from "../../app/.server/providers/html-transport";
import { assertSameCodes, parseMarkup, SegmentStructureError } from "../../app/.server/translation/segment-markup";

const SOURCE = 'Buy <g id="1">two</g> and save <x id="2"/>';

function decode(source: string, output: string, target = "de", options: { softBreaks?: boolean } = {}) {
  return decodeSegment(output, encodeSegment(source, options), target);
}

function kinds(segment: WireSegment): Map<number, "g" | "x"> {
  return new Map([...segment.codes].map(([id, shape]) => [id, shape.kind]));
}

/** Decodes and checks the result the way the pipeline does (parseMarkup + assertSameCodes). */
function accepted(source: string, output: string, target = "de"): string {
  const segment = encodeSegment(source);
  const { text, note } = decodeSegment(output, segment, target);
  expect(note).toBeUndefined();
  assertSameCodes(parseMarkup(text), kinds(segment));
  return text;
}

const refused = { text: UNMAPPABLE_SEGMENT, note: "ENGINE_MARKUP" };

describe("encodeSegment", () => {
  it("sends segments without codes as plain text and segments with codes as HTML elements", () => {
    expect(encodeSegment("Blue jacket &amp; scarf")).toMatchObject({ mode: "plain", wire: "Blue jacket & scarf", hasAmpersand: true, codes: new Map() });
    const html = encodeSegment(SOURCE);
    expect(html.mode).toBe("html");
    expect(html.wire).toBe('Buy <span id="lg1">two</span> and save <img id="lx2"/>');
    expect(encodeSegment(SOURCE, { dialect: "native" }).wire).toBe('Buy <g id="1">two</g> and save <x id="2"></x>');
  });

  it("escapes &, < and > in text and counts the text without codes", () => {
    const segment = encodeSegment('Tom &amp; Jerry &lt;3&gt; <g id="1">deals</g>');
    expect(segment.wire).toBe('Tom &amp; Jerry &lt;3&gt; <span id="lg1">deals</span>');
    expect(segment).toMatchObject({ hasAmpersand: true, hasLessThan: true, textChars: "Tom & Jerry <3> deals".length });
    expect(encodeSegment(SOURCE).textChars).toBe("Buy two and save ".length);
  });

  it("sends real line breaks as <br/> and keeps soft ones (HTML fields) as whitespace", () => {
    const source = 'Line one\r\nLine <x id="1"/>\ntwo';
    expect(encodeSegment(source)).toMatchObject({ wire: 'Line one<br/>Line <img id="lx1"/><br/>two', breaks: 2, newline: "\r\n" });
    expect(encodeSegment(source, { softBreaks: true })).toMatchObject({ wire: 'Line one\r\nLine <img id="lx1"/>\ntwo', breaks: 0 });
    expect(encodeSegment("a\nb").newline).toBe("\n");
    // Plain mode keeps line breaks as they are.
    expect(encodeSegment("a\nb")).toMatchObject({ mode: "plain", wire: "a\nb", breaks: 1 });
  });

  it("sends plain text holding an Azure dynamic-dictionary tag escaped in HTML mode", () => {
    const source = 'Buy &lt;mstrans:dictionary translation="cheap"&gt;phone&lt;/MSTRANS:dictionary&gt; now';
    const segment = encodeSegment(source);
    expect(segment.mode).toBe("html");
    expect(segment.wire).toBe('Buy &lt;mstrans:dictionary translation="cheap"&gt;phone&lt;/MSTRANS:dictionary&gt; now');
    expect(segment.wire).not.toMatch(/<mstrans/i);
    expect(decodeSegment('Kaufe &lt;mstrans:dictionary translation="cheap"&gt;Telefon&lt;/mstrans:dictionary&gt; jetzt', segment, "de").text).toBe(
      'Kaufe &lt;mstrans:dictionary translation="cheap"&gt;Telefon&lt;/mstrans:dictionary&gt; jetzt',
    );
  });

  it("records each code's shape", () => {
    const segment = encodeSegment('Buy <g id="1"> two</g>now <x id="2"/> and <g id="3">!</g>');
    expect(segment.codes.get(1)).toEqual({ kind: "g", innerLead: true, innerTrail: false, outerLead: true, outerTrail: false, hasWords: true, hasCodes: false, empty: false });
    expect(segment.codes.get(2)).toEqual({ kind: "x", outerLead: true, outerTrail: true });
    expect(segment.codes.get(3)).toMatchObject({ kind: "g", outerLead: true, outerTrail: false, hasWords: false, hasCodes: false, empty: false });
    expect(encodeSegment('<g id="1"></g> Free <g id="2"><x id="3"/></g>').codes.get(1)).toMatchObject({ empty: true, hasCodes: false });
    expect(encodeSegment('<g id="1"></g> Free <g id="2"><x id="3"/></g>').codes.get(2)).toMatchObject({ empty: false, hasCodes: true, hasWords: false });
  });

  it("notes when the source text itself holds a line-break tag", () => {
    expect(encodeSegment('Insert &lt;br&gt; for a break <g id="1">here</g>').hasBrText).toBe(true);
    expect(encodeSegment('Insert a break <g id="1">here</g>').hasBrText).toBe(false);
  });
});

describe("decodeSegment accepts our codes in every form engines return", () => {
  it.each([
    ['Kaufe <span id="lg1">zwei</span> und spare <x id="2"></x>', 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
    ['Kaufe <span id="lg1">zwei</span> und spare <x id="2"/>', 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
    ['Kaufe <span id="lg1">zwei</span> <x id="2" /> und spare', 'Kaufe <g id="1">zwei</g> <x id="2"/> und spare'],
    ["Kaufe <span id=\"lg1\">zwei</span> und spare <IMG ID='lx2'/>", 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
    ['Kaufe <span id="lg1">zwei</span> und spare <img id=lx2></img>', 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
    ["Kaufe <SPAN ID='LG1' style=\";text-align:right;direction:rtl\">zwei</SPAN> und spare <img id=\"lx2\"/>", 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
    ["Kaufe <span class=\"notranslate\" dir='rtl' id='lg1'>zwei</span> und spare <img alt=\"\" id=\"LX2\">", 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
    ['<img id="lx2"/> Spare, und kaufe <span id="lg1">zwei</span>', '<x id="2"/> Spare, und kaufe <g id="1">zwei</g>'],
    ['Kaufe <g id="1">zwei</g> und spare <x id="2"></x>', 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
    ['Kaufe <span id="lg1">zwei</span> und spare <span id="lx2"></span>', 'Kaufe <g id="1">zwei</g> und spare <x id="2"/>'],
  ])("%s", (output, expected) => {
    expect(accepted(SOURCE, output)).toBe(expected);
  });

  it("keeps nested groups", () => {
    expect(
      accepted('Use code <x id="1"/> &amp; get <g id="2"><g id="3">free</g> shipping</g>.', 'Code <img id="lx1"/> nutzen &amp; <span id="lg2"><span id="lg3">kostenlosen</span> Versand</span> erhalten.'),
    ).toBe('Code <x id="1"/> nutzen &amp; <g id="2"><g id="3">kostenlosen</g> Versand</g> erhalten.');
  });
});

describe("decodeSegment pre-tokeniser", () => {
  const source = 'Note <x id="1"/>';
  it.each([
    ['a <b <img id="lx1"/>', 'a &lt;b <x id="1"/>'],
    ['x < y <img id="lx1"/>', 'x &lt; y <x id="1"/>'],
    ['Größe <M und L <img id="lx1"/>', 'Größe &lt;M und L <x id="1"/>'],
    ['Cut&copy paste <img id="lx1"/>', 'Cut&amp;copy paste <x id="1"/>'],
    ['Tom&Jerry <img id="lx1"/>', 'Tom&amp;Jerry <x id="1"/>'],
    ['&notanentity; <img id="lx1"/>', '&amp;notanentity; <x id="1"/>'],
    ['&notin; <img id="lx1"/>', '∉ <x id="1"/>'],
    ['AT&T&amp; <img id="lx1"/>', 'AT&amp;T&amp; <x id="1"/>'],
    ['a <3 b <img id="lx1"/>', 'a &lt;3 b <x id="1"/>'],
    ['<!DOCTYPE x> <img id="lx1"/>', '&lt;!DOCTYPE x&gt; <x id="1"/>'],
  ])("%s", (output, expected) => {
    expect(decode(source, output)).toEqual({ text: expected });
  });

  it("refuses an element or a comment that only looks like text", () => {
    expect(decode(source, 'Größe <M> und L <img id="lx1"/>')).toEqual(refused);
    expect(decode(source, 'Hinweis <!-- x --> <img id="lx1"/>')).toEqual(refused);
  });

  it("refuses a broken closing tag kept as text, unless the source itself had a '<'", () => {
    expect(decode(source, 'Hinweis <img id="lx1"/> x</span')).toEqual(refused);
    expect(decode('a &lt; b <x id="1"/>', 'a &lt; b <img id="lx1"/> x</span')).toEqual({ text: 'a &lt; b <x id="1"/> x&lt;/span' });
  });

  it("refuses the source's own tag text when the engine un-escaped it (parse5 would drop it or make it a break)", () => {
    // "</span>" closes nothing: parse5 drops it, and the word with it.
    expect(decode('Use the &lt;/span&gt; tag <g id="1">carefully</g>', 'Verwende das </span> Tag <span id="lg1">vorsichtig</span>')).toEqual(refused);
    // "<br>" would become a space (or a break) in place of the merchant's text.
    expect(decode('Insert &lt;br&gt; for a break <g id="1">here</g>', 'Füge <br> für einen Umbruch <span id="lg1">hier</span> ein')).toEqual(refused);
    expect(decode('Insert &lt;br&gt; for a break <g id="1">here</g>', 'Füge </br> für einen Umbruch <span id="lg1">hier</span> ein')).toEqual(refused);
    // Kept escaped: accepted.
    expect(decode('Insert &lt;br&gt; for a break <g id="1">here</g>', 'Füge &lt;br&gt; für einen Umbruch <span id="lg1">hier</span> ein')).toEqual({
      text: 'Füge &lt;br&gt; für einen Umbruch <g id="1">hier</g> ein',
    });
    // <img …></img> is still accepted when the source has a "<" (parse5 records no end tag for it).
    expect(decode('a &lt; b <x id="2"/>', 'a &lt; b <img id="lx2"></img>')).toEqual({ text: 'a &lt; b <x id="2"/>' });
    // Correctly closed groups are counted as closed.
    expect(decode('a &lt; b <g id="1"><g id="2">c</g> d</g>', 'a &lt; b <span id="lg1"><span id="lg2">c</span> d</SPAN >')).toEqual({ text: 'a &lt; b <g id="1"><g id="2">c</g> d</g>' });
  });

  it("drops a stray end tag as today when the source has no '<' (no text is lost)", () => {
    expect(decode('Buy <g id="1">two</g> now', 'Kaufe <span id="lg1">zwei</span></span> jetzt')).toEqual({ text: 'Kaufe <g id="1">zwei</g> jetzt' });
  });
});

describe("decodeSegment entities", () => {
  const source = 'Note <x id="1"/>';
  it.each([
    ["L&#39;art <img id=\"lx1\"/>", "L'art <x id=\"1\"/>"],
    ["&quot;Hallo&quot; <img id=\"lx1\"/>", '"Hallo" <x id="1"/>'],
    ["&eacute;t&eacute; <img id=\"lx1\"/>", 'été <x id="1"/>'],
    ["a&nbsp;b <img id=\"lx1\"/>", 'a b <x id="1"/>'],
    ["&#x1F600; <img id=\"lx1\"/>", '😀 <x id="1"/>'],
    ["&amp;lt; <img id=\"lx1\"/>", '&amp;lt; <x id="1"/>'],
  ])("%s", (output, expected) => {
    expect(decode(source, output)).toEqual({ text: expected });
  });

  it("decodes &amp;lt; to literal text, never to markup", () => {
    const { text } = decode(source, '&amp;lt;b&amp;gt; <img id="lx1"/>');
    expect(parseMarkup(text)).toEqual([{ kind: "text", value: "&lt;b&gt; " }, { kind: "x", id: 1 }]);
  });
});

describe("decodeSegment line breaks", () => {
  it("keeps as many breaks as the source had, with the source's line ending", () => {
    expect(decode('Line one\nLine <x id="1"/> two', 'Zeile eins<br></br>Zeile <img id="lx1"/> zwei')).toEqual({ text: 'Zeile eins\nZeile <x id="1"/> zwei' });
    expect(decode('Line one\r\nLine <x id="1"/> two', 'Zeile eins<BR/>Zeile <img id="lx1"/> zwei')).toEqual({ text: 'Zeile eins\r\nZeile <x id="1"/> zwei' });
    expect(decode('Line one\nLine <x id="1"/> two', 'Zeile eins Zeile <img id="lx1"/> zwei')).toEqual({ text: 'Zeile eins Zeile <x id="1"/> zwei' });
  });

  it("turns an invented break in a one-line source into a space", () => {
    expect(decode('Buy <g id="1">two</g>', 'Kaufe<br/><span id="lg1">zwei</span>')).toEqual({ text: 'Kaufe <g id="1">zwei</g>' });
  });

  it("refuses more breaks than a multi-line source had", () => {
    expect(decode('Line one\nLine <x id="1"/> two', 'Zeile<br/>eins<br/>Zeile <img id="lx1"/> zwei')).toEqual(refused);
  });
});

describe("decodeSegment whitespace next to codes", () => {
  it("moves space the engine put inside a group outside it, never losing a word separator", () => {
    expect(decode('Buy <g id="1">two</g> now', 'Kaufe<span id="lg1"> zwei </span>jetzt')).toEqual({ text: 'Kaufe <g id="1">zwei</g> jetzt' });
    expect(decode('Buy <g id="1">two</g> now', 'Kaufe <span id="lg1"> zwei</span> jetzt')).toEqual({ text: 'Kaufe <g id="1">zwei</g> jetzt' });
    // Through nested groups.
    expect(decode('Get <g id="1"><g id="2">free</g> shipping</g> now', 'Hol<span id="lg1"><span id="lg2"> gratis</span> Versand </span>jetzt')).toEqual({
      text: 'Hol <g id="1"><g id="2">gratis</g> Versand</g> jetzt',
    });
    // A group that starts with a space in the source keeps it.
    expect(decode('Buy<g id="1"> two</g>', 'Kaufe<span id="lg1"> zwei</span>')).toEqual({ text: 'Kaufe<g id="1"> zwei</g>' });
  });

  it("collapses runs of spaces next to a code", () => {
    expect(decode('Buy <g id="1">two</g> now', 'Kaufe  <span id="lg1">zwei</span> \t jetzt')).toEqual({ text: 'Kaufe <g id="1">zwei</g> jetzt' });
    // Elsewhere the engine's spacing stays.
    expect(decode('Buy <g id="1">two</g> now', 'Kaufe   bitte <span id="lg1">zwei</span> jetzt').text).toBe('Kaufe   bitte <g id="1">zwei</g> jetzt');
  });

  it.each([
    ["ja", '今すぐ <span id="lg1">二つ</span> 買う', '今すぐ<g id="1">二つ</g>買う'],
    ["zh-TW", '立即 <span id="lg1">兩件</span> 購買', '立即<g id="1">兩件</g>購買'],
    ["th", 'ซื้อ <span id="lg1">สอง</span> ตอนนี้', 'ซื้อ<g id="1">สอง</g>ตอนนี้'],
    ["ja", 'iPhone <span id="lg1">二つ</span> 買う', 'iPhone <g id="1">二つ</g>買う'],
    ["de", 'Kaufe <span id="lg1">zwei</span> jetzt', 'Kaufe <g id="1">zwei</g> jetzt'],
  ])("%s: removes a space next to a code only between scripts written without spaces", (target, output, expected) => {
    expect(decode('Buy <g id="1">two</g> now', output, target)).toEqual({ text: expected });
  });

  it("flags glued words in a target written with spaces, without changing the text", () => {
    expect(decode('Buy <g id="1">two</g> now', 'Kaufe<span id="lg1">zwei</span>jetzt')).toEqual({ text: 'Kaufe<g id="1">zwei</g>jetzt', note: "SPACING_CHANGED" });
    expect(decode('Save <x id="1"/> today', 'Spare<img id="lx1"/>heute')).toEqual({ text: 'Spare<x id="1"/>heute', note: "SPACING_CHANGED" });
    // The same glued output in Japanese is how the language is written.
    expect(decode('Buy <g id="1">two</g> now', '買う<span id="lg1">二つ</span>今', "ja")).toEqual({ text: '買う<g id="1">二つ</g>今' });
    // No space in the source at that boundary: nothing lost.
    expect(decode('Buy<g id="1">two</g>now', 'Kaufe<span id="lg1">zwei</span>jetzt')).toEqual({ text: 'Kaufe<g id="1">zwei</g>jetzt' });
  });

  it.each([
    // A protected term, URL or e-mail renders as a word: one lost side is enough to glue it.
    ['Buy <x id="1"/> today', 'Kaufen Sie <img id="lx1"/>heute', 'Kaufen Sie <x id="1"/>heute'],
    ['Buy <x id="1"/> today', 'Kaufen Sie<img id="lx1"/> heute', 'Kaufen Sie<x id="1"/> heute'],
    ['Buy <g id="1"><x id="2"/> now</g> today', 'Kaufen Sie<span id="lg1"><img id="lx2"/> jetzt</span> heute', 'Kaufen Sie<g id="1"><x id="2"/> jetzt</g> heute'],
    ['Buy <x id="1"/> <x id="2"/> today', 'Kaufe <img id="lx1"/><img id="lx2"/> heute', 'Kaufe <x id="1"/><x id="2"/> heute'],
  ])("flags a placeholder glued on one side: %s → %s", (source, output, text) => {
    expect(decode(source, output)).toEqual({ text, note: "SPACING_CHANGED" });
  });

  it.each([
    ['Buy <x id="1"/> today', 'Kaufen Sie <img id="lx1"/> heute', "de"],
    // No space in the source on that side.
    ['Buy<x id="1"/> today', 'Kaufen Sie<img id="lx1"/> heute', "de"],
    // Punctuation after the code.
    ['Buy <x id="1"/> today', 'Kaufen Sie <img id="lx1"/>, heute', "de"],
    ['Buy <x id="1"/> today', '今日<img id="lx1"/>を買う', "ja"],
  ])("doesn't flag a placeholder whose separators survived: %s → %s", (source, output, target) => {
    expect(decode(source, output, target).note).toBeUndefined();
  });

  it("trims the segment (render restores the outer whitespace)", () => {
    expect(decode('<g id="1">Buy</g> now', '  <span id="lg1"> Kaufe</span> jetzt \n')).toEqual({ text: '<g id="1">Kaufe</g> jetzt' });
  });
});

describe("decodeSegment groups that would swallow the sentence", () => {
  it.each([
    // A dropped </span>: the bold would run to the end.
    ['Buy <g id="1">two</g> and save today', 'Kaufen Sie <span id="lg1">zwei und sparen Sie heute'],
    // A self-closed link around an e-mail: the link would swallow "für Hilfe".
    ['<g id="1"><x id="2"/></g> for help', '<span id="lg1"/><img id="lx2"/> für Hilfe'],
    // A self-closed group that had words.
    ['Buy <g id="1">two</g>', 'Kaufe <span id="lg1"/> zwei'],
    ['Buy <g id="1">two</g>', 'Kaufe <g id="1"/> zwei'],
  ])("refuses %s → %s", (source, output) => {
    expect(decode(source, output)).toEqual(refused);
  });

  it("accepts an empty source group (an icon) that comes back self-closed, with the text after it", () => {
    expect(decode('<g id="1"></g> Free shipping', '<span id="lg1"/> Kostenloser Versand')).toEqual({ text: '<g id="1"></g> Kostenloser Versand' });
    expect(accepted('<g id="1"></g> Free shipping', '<span id="lg1"></span> Kostenloser Versand')).toBe('<g id="1"></g> Kostenloser Versand');
  });

  it("still accepts end tags in other spellings and closed nested groups", () => {
    expect(accepted(SOURCE, 'Kaufe <span id="lg1">zwei</SPAN > und spare <img id="lx2"/>')).toBe('Kaufe <g id="1">zwei</g> und spare <x id="2"/>');
  });
});

describe("decodeSegment groups that held only a placeholder", () => {
  it.each([
    // A linked URL or e-mail: an empty link next to unlinked text.
    ['Visit <g id="1"><x id="2"/></g> today', 'Besuchen Sie <span id="lg1"></span><img id="lx2"/> heute'],
    ['Write to <g id="1"><x id="2"/></g> for help', 'Schreiben Sie an <span id="lg1"></span> <img id="lx2"/> für Hilfe'],
    // <strong>{{ price }}</strong>
    ['Only <g id="1"><x id="2"/></g> today', 'Nur <img id="lx2"/><span id="lg1"></span> heute'],
    // <a><strong><img></strong></a>: the inner group moved out of the link.
    ['See <g id="1"><g id="2"><x id="3"/></g></g> now', 'Siehe <span id="lg1"></span><span id="lg2"><img id="lx3"/></span> jetzt'],
  ])("refuses %s → %s", (source, output) => {
    expect(decode(source, output)).toEqual(refused);
  });

  it("accepts the placeholder still inside its group", () => {
    expect(accepted('Visit <g id="1"><x id="2"/></g> today', 'Besuchen Sie <span id="lg1"><img id="lx2"/></span> heute')).toBe('Besuchen Sie <g id="1"><x id="2"/></g> heute');
    expect(accepted('See <g id="1"><g id="2"><x id="3"/></g></g> now', 'Siehe <span id="lg1"><span id="lg2"><img id="lx3"/></span></span> jetzt')).toBe(
      'Siehe <g id="1"><g id="2"><x id="3"/></g></g> jetzt',
    );
  });
});

describe("decodeSegment fails closed", () => {
  it.each([
    'Kaufe <b>zwei</b> und spare <img id="lx2"/>',
    'Kaufe <a href="https://evil.example">zwei</a> und spare <img id="lx2"/>',
    'Kaufe <span id="lg1">zwei</span> <script>alert(1)</script> <img id="lx2"/>',
    'Kaufe <td>zwei</td> und spare <img id="lx2"/>',
    'Kaufe <img id="lg1"> und spare <img id="lx2"/>',
    'Kaufe <span id="lg1"> </span> und spare <img id="lx2"/>',
    'Kaufe <span id="lg1">zwei</span> und <span>spare</span> <img id="lx2"/>',
    'Kaufe <span id="lg1">zwei</span> und spare <img id="lx2"/><col>',
    '<html>Kaufe <span id="lg1">zwei</span> und spare <img id="lx2"/>',
  ])("%s", (output) => {
    expect(decode(SOURCE, output)).toEqual(refused);
  });

  it("produces a result parseMarkup rejects", () => {
    expect(() => parseMarkup(UNMAPPABLE_SEGMENT)).toThrow(SegmentStructureError);
    try {
      parseMarkup(UNMAPPABLE_SEGMENT);
    } catch (error) {
      expect((error as SegmentStructureError).code).toBe("UNBALANCED_TAGS");
    }
  });
});

describe("decodeSegment never introduces markup", () => {
  const codes = kinds(encodeSegment(SOURCE));
  const check = (output: string) => () => assertSameCodes(parseMarkup(decode(SOURCE, output).text), codes);

  it("keeps unknown, repeated and missing codes for assertSameCodes to reject", () => {
    expect(decode(SOURCE, 'Kaufe <span id="lg9">zwei</span> und spare <img id="lx2"/>').text).toBe('Kaufe <g id="9">zwei</g> und spare <x id="2"/>');
    expect(check('Kaufe <span id="lg9">zwei</span> und spare <img id="lx2"/>')).toThrow(/UNKNOWN_CODE/);
    expect(check('Kaufe <span id="lg1">zwei</span> und <img id="lx2"/> spare <img id="lx2"/>')).toThrow(/DUPLICATE_CODE/);
    expect(check('Kaufe <span id="lg1">zwei</span> und spare')).toThrow(/MISSING_CODE/);
    expect(check('Kaufe <span id="lg2">zwei</span> und spare <img id="lx1"/>')).toThrow(/CODE_KIND_MISMATCH/);
  });

  it("keeps escaped markup in the output as text", () => {
    const { text } = decode(SOURCE, 'Kaufe &lt;g id="1"&gt;zwei <span id="lg1">zwei</span> <img id="lx2"/>');
    expect(text).toBe('Kaufe &lt;g id="1"&gt;zwei <g id="1">zwei</g> <x id="2"/>');
    expect(parseMarkup(text)[0]).toEqual({ kind: "text", value: 'Kaufe <g id="1">zwei ' });
    // An escaped closing tag from a source without "<" reads as a broken tag: refused.
    expect(decode(SOURCE, 'Kaufe zwei&lt;/g&gt; <span id="lg1">zwei</span> <img id="lx2"/>')).toEqual(refused);
  });
});

describe("decodeSegment in plain mode", () => {
  it("decodes the engine's entities when the source had no '&'", () => {
    expect(decode("The art", "L&#39;art")).toEqual({ text: "L'art" });
    expect(decode("Tom and Jerry", "Tom &amp; Jerry")).toEqual({ text: "Tom &amp; Jerry" });
  });

  it("leaves entity-like text literal when the source had a '&', and escapes '<'", () => {
    expect(decode("Tom &amp; Jerry", "L&#39;art &amp; <b>")).toEqual({ text: "L&amp;#39;art &amp;amp; &lt;b&gt;" });
    expect(decode("Size", "  Größe <M>  ")).toEqual({ text: "Größe &lt;M&gt;" });
  });
});
