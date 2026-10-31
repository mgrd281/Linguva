/**
 * Flags: the country a language's flag shows (localeCountry), the vendored
 * pictures in public/flags (served as they are, so only plain drawing is
 * allowed in them), and the Flag component's markup.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Flag } from "../../app/components/Flag";
import { FLAG_COUNTRIES, localeCountry } from "../../app/lib/flags";

const FLAGS = join(__dirname, "..", "..", "public", "flags");
const svgs = readdirSync(FLAGS).filter((name) => name.endsWith(".svg"));

describe("the country of a language's flag", () => {
  it("is the locale's region, else the language's country", () => {
    expect(localeCountry("pt-BR")).toBe("BR");
    expect(localeCountry("zh-TW")).toBe("TW");
    expect(localeCountry("zh-Hant-TW")).toBe("TW");
    expect(localeCountry("en-us")).toBe("US");
    expect(localeCountry("da")).toBe("DK");
    expect(localeCountry("nb", ["US"])).toBe("NO");
    expect(localeCountry("de", ["AT", "CH"])).toBe("DE");
    // No country of its own and no rule: the code is shown instead.
    expect(localeCountry("hi")).toBeNull();
    expect(localeCountry("constructor")).toBeNull();
  });

  it("is a country the store sells to for a language of many countries, the preferred ones first", () => {
    expect(localeCountry("en")).toBeNull();
    expect(localeCountry("en", null)).toBeNull();
    expect(localeCountry("en", ["DE", "AT"])).toBeNull();
    expect(localeCountry("en", ["US", "GB"])).toBe("GB");
    expect(localeCountry("en", ["DE", "US"])).toBe("US");
    expect(localeCountry("en", ["DE", "IE", "CA"])).toBe("IE");
    expect(localeCountry("ar", ["DE", "AE", "SA"])).toBe("AE");
    // Plain Spanish is Spain's unless the markets name another Spanish-speaking country; Latin American Spanish never guesses.
    expect(localeCountry("es")).toBe("ES");
    expect(localeCountry("es", null)).toBe("ES");
    expect(localeCountry("es-419")).toBeNull();
    expect(localeCountry("es", ["MX", "ES"])).toBe("ES");
    expect(localeCountry("es", ["de", "mx"])).toBe("MX");
    // A region that isn't a country ("es-419", Latin America) counts as none.
    expect(localeCountry("es-419", ["CO"])).toBe("CO");
    expect(localeCountry("pt", ["AO", "BR"])).toBe("BR");
    expect(localeCountry("pt", ["AO"])).toBe("AO");
    expect(localeCountry("zh", ["SG"])).toBe("SG");
  });
});

describe("vendored flags", () => {
  it("has a picture for every country code the app uses, and the license", () => {
    const countries = svgs.map((name) => name.slice(0, -4)).filter((code) => /^[A-Z]{2}$/.test(code));
    expect([...FLAG_COUNTRIES].sort()).toEqual(countries.sort());
    for (const code of ["DE", "DK", "GB", "US", "CH", "BE", "NO", "JP", "AE"]) expect(FLAG_COUNTRIES.has(code), code).toBe(true);
    expect(readFileSync(join(FLAGS, "LICENSE.txt"), "utf8")).toMatch(/The MIT License[\s\S]*Permission is hereby granted, free of charge/);
  });

  it("are plain drawings: no scripts, styles, links or external references", () => {
    const elements = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "polygon"]);
    const attributes = new Set(["xmlns", "viewBox", "d", "fill", "fill-rule", "clip-rule", "stroke", "stroke-width", "stroke-miterlimit", "stroke-linejoin", "opacity", "cx", "cy", "r", "rx", "ry", "class"]);
    expect(svgs.length).toBeGreaterThan(250);
    for (const name of svgs) {
      const svg = readFileSync(join(FLAGS, name), "utf8");
      expect(svg, name).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg, name).not.toMatch(/<[!?]|javascript:|url\(|href|on[a-z]+\s*=/i);
      for (const [, tag] of svg.matchAll(/<([a-zA-Z][\w:-]*)/g)) expect(elements.has(tag!), `${name} <${tag}>`).toBe(true);
      for (const [, attribute] of svg.matchAll(/\s([\w:-]+)\s*=/g)) expect(attributes.has(attribute!), `${name} ${attribute}`).toBe(true);
    }
  });
});

describe("the Flag component", () => {
  const render = (props: Parameters<typeof Flag>[0]) => renderToStaticMarkup(createElement(Flag, props));

  it("shows the country's picture in a 3:2 frame, hidden from screen readers", () => {
    const html = render({ country: "dk", size: 28 });
    expect(html).toMatch(/^<span aria-hidden="true" style="[^"]*width:28px;height:19px;border:1px solid rgba\(0, 0, 0, 0.12\);border-radius:3px/);
    expect(html).toContain('<img src="/flags/DK.svg" alt="" aria-hidden="true" width="28" height="19"');
    expect(render({ country: "GB" })).toContain('width="20" height="13"');
    expect(render({ country: "US", size: 40 })).toContain('width="40" height="27"');
  });

  it("shows the language's code in a neutral box without a picture", () => {
    const html = render({ country: null, fallback: "en", size: 28 });
    expect(html).not.toContain("<img");
    expect(html).toMatch(/^<span aria-hidden="true" style="[^"]*background:#ebebeb[^"]*">EN<\/span>$/);
    expect(render({ country: null, fallback: "zh-CN" })).toContain(">ZH</span>");
    // A code without a picture (never a broken image or a made-up path).
    expect(render({ country: "ZZ" })).toContain(">ZZ</span>");
    expect(render({ country: "../x", fallback: "fil" })).toContain(">FIL</span>");
    expect(render({ country: "../x" })).toMatch(/^<span aria-hidden="true" style="[^"]*"><\/span>$/);
  });
});
