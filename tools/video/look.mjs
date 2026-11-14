// Takes full-size screenshots of the page as the video will see it, to check the layout before
// filming. Signs nothing.
//
//   node tools/video/look.mjs <coin> <output folder>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [coin, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: "light" });
await page.goto(`http://localhost:8766/?coin=${coin}`);
await page.waitForFunction(() => document.getElementById("mood")?.dataset.mood !== "loading", null, { timeout: 60000 });
await page.waitForTimeout(4000);
const shots = [
  ["top", null],
  ["piles", "#piles-title"],
  ["find", "#find-title"],
  ["said", "#said-title"],
  ["books", "#books-title"],
  ["log", "#log-title"],
  ["rules", "#rules-title"],
];
for (const [name, selector] of shots) {
  if (selector) await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "start" }), selector);
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${name}.png`) });
}
await page.screenshot({ path: join(out, "full.png"), fullPage: true });
console.log(`screenshots in ${out}`);
await browser.close();
