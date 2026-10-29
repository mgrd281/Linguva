/**
 * Touch targets on a phone (WCAG 2.2, 2.5.8 Target Size, level AA): every
 * control is at least 24 x 24 px, or a 24 px circle around it touches no
 * other control (the standard's spacing exception). A checkbox counts with
 * its label, which also toggles it.
 */
import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

const PAGES = ["/app", "/app/products?lang=fr", "/app/products/2?lang=fr", "/app/review", "/app/jobs", "/app/coverage", "/app/translations", "/app/glossary", "/app/memory", "/app/settings", "/app/plan", "/app/content", "/app/languages", "/app/markets"];

for (const path of PAGES) {
  test(`touch targets on ${path} @responsive`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "phone layout only");
    await openApp(page, "full", path);
    await page.waitForLoadState("networkidle");
    const problems = await page.evaluate(() => {
      type Box = { x: number; y: number; w: number; h: number; label: string };
      const boxes: Box[] = [];
      const visit = (root: Document | ShadowRoot) => {
        for (const el of Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role=button], [role=link]"))) {
          if (el instanceof HTMLInputElement && el.type === "hidden") continue;
          let r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
          // A checkbox or radio is activated by its label as well.
          if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
            const label = el.closest("label") ?? (el.id ? (el.getRootNode() as ShadowRoot | Document).querySelector(`label[for="${el.id}"]`) : null);
            if (label) r = label.getBoundingClientRect();
          }
          boxes.push({ x: r.x, y: r.y, w: r.width, h: r.height, label: (el.innerText || el.getAttribute("aria-label") || el.tagName).slice(0, 40) });
        }
        for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) if (el.shadowRoot) visit(el.shadowRoot);
      };
      visit(document);
      const centre = (b: Box) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
      const circleHitsBox = (cx: number, cy: number, b: Box) => {
        const dx = Math.max(b.x - cx, 0, cx - (b.x + b.w));
        const dy = Math.max(b.y - cy, 0, cy - (b.y + b.h));
        return dx * dx + dy * dy < 12 * 12;
      };
      const out: string[] = [];
      boxes.forEach((b, i) => {
        if (b.w >= 24 && b.h >= 24) return;
        const { cx, cy } = centre(b);
        const clash = boxes.find((o, j) => {
          if (j === i) return false;
          // Same control reported twice (host and inner element).
          if (Math.abs(o.x - b.x) < 1 && Math.abs(o.y - b.y) < 1 && Math.abs(o.w - b.w) < 1) return false;
          if (o.x <= b.x && o.y <= b.y && o.x + o.w >= b.x + b.w && o.y + o.h >= b.y + b.h) return false;
          if (circleHitsBox(cx, cy, o)) return true;
          // Two undersized targets: their 24 px circles must not overlap.
          if (o.w < 24 || o.h < 24) {
            const c = centre(o);
            return (c.cx - cx) ** 2 + (c.cy - cy) ** 2 < 24 * 24;
          }
          return false;
        });
        if (clash) out.push(`${b.label} (${Math.round(b.w)}x${Math.round(b.h)}) is close to ${clash.label}`);
      });
      return out;
    });
    expect(problems).toEqual([]);
  });
}
