// Films the real SQUAWK page against the live speedrun coin on testnet, and logs when each shot
// happens. Every click is the page's own button, and every transaction is real.
//
//   node tools/video/film.mjs <coin> <output folder>
//
// Before running:
//   1. the page on http://localhost:8766            (npx vite web --port 8766)
//   2. the stand-in wallet for the viewer account   (node tools/video/wallet-server.mjs ana.<parent> <coin> social)
//      on 127.0.0.1:38767, or on WALLET_PORT if that is set
//   3. `private/cast.json` from scripts/cast.mjs
//
// The film follows one full round: bake, feed, a second fan feeds another post, the viewer feeds
// again to reach the target, the round ends, the viewer wakes Polly, and Polly squawks.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const [coin, out] = process.argv.slice(2);
if (!coin || !out) {
  console.error("usage: node tools/video/film.mjs <coin> <output folder>");
  process.exit(1);
}
const project = fileURLToPath(new URL("../../", import.meta.url));
const cast = JSON.parse(readFileSync(join(project, "private", "cast.json"), "utf8"));
const ME = cast.fans[0].account;
const OTHER = cast.fans[1].account;
const [first, second] = cast.writers;
const PAGE = `http://localhost:8766/?coin=${coin}`;
mkdirSync(out, { recursive: true });

const RPC = "https://near-testnet.drpc.org";
async function view(method, args = {}) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "call_function", finality: "optimistic", account_id: coin, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  return JSON.parse(Buffer.from((await response.json()).result.result).toString());
}
/** Runs one of the project's scripts, as the second fan. */
function play(...args) {
  return execFileSync(process.execPath, [join(project, "scripts", "play.mjs"), ...args], { cwd: project, encoding: "utf8", env: { ...process.env, NEAR_RPC: RPC } });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  recordVideo: { dir: out, size: { width: 1600, height: 900 } },
});
// A headless recording shows no pointer, so the page gets one that follows the mouse.
await context.addInitScript(() => {
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;border-radius:50%;background:rgba(27,27,31,.85);border:3px solid #fff;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);opacity:0;box-shadow:0 2px 10px rgba(0,0,0,.45)";
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; c.style.opacity = 1; });
    addEventListener("mousedown", () => c.animate([{ transform: "translate(-50%,-50%) scale(1)" }, { transform: "translate(-50%,-50%) scale(.55)" }, { transform: "translate(-50%,-50%) scale(1)" }], { duration: 320 }));
  });
});

const page = await context.newPage();
const t0 = Date.now();
const marks = {};
const save = () => writeFileSync(join(out, "marks.json"), JSON.stringify(marks, null, 1));
const mark = (name) => { marks[name] = +((Date.now() - t0) / 1000).toFixed(2); console.log(`${marks[name]}s ${name}`); save(); };
const wait = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000));

async function open(url) {
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById("mood")?.dataset.mood !== "loading", null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("#feed-list .post").length > 0, null, { timeout: 60000 });
  await wait(2);
}

/** Offers the page a wallet that forwards signing to the local stand-in. */
async function connect() {
  await page.evaluate(([me, port]) => {
    const base = `http://127.0.0.1:${port}`;
    window.dispatchEvent(new CustomEvent("near-wallet-injected", { detail: {
      manifest: { id: "squawk-film-wallet", name: "Local test wallet", icon: "", website: "http://localhost", description: "Local stand-in for filming", version: "1.0.0", executor: "", type: "injected", platform: [], permissions: {},
        features: { signMessage: false, signTransaction: false, signAndSendTransaction: true, signAndSendTransactions: false, signInWithoutAddKey: true, signInAndSignMessage: false, signInWithFunctionCallKey: false, signDelegateActions: false, mainnet: false, testnet: true } },
      signIn: async () => [{ accountId: me }],
      signOut: async () => {},
      getAccounts: async () => [{ accountId: me }],
      signAndSendTransaction: async (p) => {
        const r = await fetch(`${base}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
        const j = await r.json();
        if (j.error) throw new Error(j.error);
        return j;
      },
    } }));
  }, [ME, process.env.WALLET_PORT ?? "38767"]);
  await wait(1);
  await page.evaluate(() => document.getElementById("wallet").click());
  await page.waitForSelector(".connect-item", { timeout: 20000 });
  await wait(0.5);
  await page.locator(".connect-item", { hasText: "Local test" }).click();
  await page.waitForFunction((me) => document.getElementById("purse-sub").textContent.includes(me.split(".")[0]), ME, { timeout: 20000 });
  await wait(2);
}

const scrollTo = async (selector, block = "center") => {
  await page.evaluate(([s, b]) => document.querySelector(s).scrollIntoView({ behavior: "smooth", block: b }), [selector, block]);
  await wait(1.6);
};
const top = async () => { await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" })); await wait(1.6); };

async function moveTo(locator) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 220, y - 130);
  await wait(0.2);
  await page.mouse.move(x, y, { steps: 28 });
  await wait(0.35);
  return { x, y };
}

async function press(selector) {
  const locator = typeof selector === "string" ? page.locator(selector).first() : selector;
  await moveTo(locator);
  await page.mouse.down();
  await wait(0.08);
  await page.mouse.up();
}

async function type(selector, text) {
  const { x, y } = await moveTo(page.locator(selector));
  await page.mouse.click(x, y);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text, { delay: 140 });
  await wait(0.8);
}

const toast = (text, timeout = 90000) => page.waitForFunction((t) => {
  const box = document.getElementById("toast");
  return !box.hidden && box.textContent.includes(t);
}, text, { timeout });
const mood = (wanted, timeout = 420000) => page.waitForFunction((m) => document.getElementById("mood").dataset.mood === m, wanted, { timeout });
/** The Feed button on the card of one post, in the list of posts to feed. */
const feedButton = (key) => page.locator(`#feed-list .post[data-key="${key}"] [data-feed]`);
/**
 * A feed of about `want` crackers that the contract will accept right now. Every feed must pay
 * for its own storage out of Polly's cut, and the cut shrinks as the streak grows, so the
 * smallest feed depends on the moment.
 */
async function amount(who, post, want) {
  const floor = Number(BigInt(await view("feed_floor", { account_id: who, post })) / 10n ** 16n) / 100;
  return String(Math.max(want, Math.ceil(floor + 1)));
}

try {
  // Start early in a round, so the whole story fits before it ends.
  let status = await view("status");
  const roundMs = Number((await view("rules")).round_ms);
  let left = Number(status.round_ends_ms) - Number(status.now_ms);
  if (left < roundMs - 45_000) {
    console.log(`waiting ${Math.ceil(left / 1000)}s for a fresh round`);
    await wait(left / 1000 + 4);
  }

  await open(PAGE);
  await connect();
  await top();
  mark("hook_start");
  await wait(15);
  mark("hook_end");

  // Bake.
  await scrollTo("#bake-form");
  mark("bake_start");
  await type("#bake-near", "0.5");
  await press("#bake");
  mark("bake_click");
  await toast("Baked");
  mark("bake_done");
  await wait(4);

  // Find the first writer's post by account, and feed it.
  await scrollTo("#find-title", "start");
  await wait(1);
  mark("feed_start");
  await press('.tab[data-tab="account"]');
  await wait(0.8);
  await type("#find-input", first.account);
  await press('#find-form button[type="submit"]');
  await page.waitForSelector(`#feed-list .post[data-key="${first.post}"]`, { timeout: 60000 });
  await wait(1.5);
  await press(feedButton(first.post));
  await page.waitForSelector("#feed-dialog[open]");
  await wait(1.2);
  // Enough to lead, and well short of the target, so the flock still has work to do.
  const target = Number(BigInt((await view("rules")).target) / 10n ** 18n);
  const opening = await amount(ME, first.post, Math.round(target * 0.55));
  await type("#feed-amount", opening);
  mark("feed_dialog");
  await wait(4);
  await press("#feed-go");
  mark("feed_click");
  await toast("was just sent");
  mark("feed_done");
  await wait(5);

  // The piles. A second fan feeds another post from the command line, as anyone could.
  await scrollTo("#piles-title", "start");
  mark("pile_start");
  await wait(2);
  console.log(play("bake", coin, "--as", OTHER, "--near", "0.2").trim());
  const fed = Number(BigInt((await view("status")).fed) / 10n ** 18n);
  const second_feed = await amount(OTHER, second.post, Math.max(20, Math.round((target - fed) * 0.45)));
  console.log(play("feed", coin, "--as", OTHER, "--post", second.post, "--crackers", second_feed).trim());
  await page.waitForFunction(() => document.querySelectorAll("#pile-list li").length >= 2, null, { timeout: 60000 });
  mark("pile_two");
  await wait(4);

  // Back to the top: the target is not reached yet, so the first fan feeds again.
  await top();
  mark("target_short");
  await wait(4);
  await scrollTo("#piles-title", "start");
  await press(page.locator(`#pile-list .post[data-key="${first.post}"] [data-feed]`));
  await page.waitForSelector("#feed-dialog[open]");
  await wait(1);
  const now = Number(BigInt((await view("status")).fed) / 10n ** 18n);
  await type("#feed-amount", await amount(ME, first.post, Math.max(10, target - now + 10)));
  await press("#feed-go");
  await toast("was just sent");
  mark("feed2_done");
  await wait(2);
  await top();
  await mood("fed", 60000);
  mark("full");
  await wait(6);

  // Wait for the round to end. Polly falls asleep with a winner waiting.
  status = await view("status");
  left = Number(status.round_ends_ms) - Number(status.now_ms);
  console.log(`round ends in ${Math.ceil(left / 1000)}s`);
  if (left > 14_000) await wait(left / 1000 - 12);
  mark("countdown");
  await mood("asleep");
  mark("asleep");
  await wait(6);
  await press("#wake-btn");
  mark("wake_click");
  await mood("squawk", 90000);
  mark("squawk");
  await wait(9);

  // What Polly said: her own post, read back from near.social's data.
  await scrollTo("#said-title", "start");
  await page.waitForFunction(() => document.querySelector("#squawk-list .polly-post header") !== null, null, { timeout: 90000 });
  await wait(1);
  mark("said_start");
  await wait(14);
  mark("said_end");

  // The streak grew with that squawk, and Polly's cut came down.
  await top();
  mark("streak_start");
  await wait(9);
  mark("streak_end");

  // The books, the log and the proof that there are no keys.
  await scrollTo("#books-title", "start");
  mark("books_start");
  await wait(9);
  await scrollTo("#log-title", "start");
  mark("log_start");
  await wait(6);
  await scrollTo("#rules-title", "start");
  mark("keys_start");
  await wait(8);

  // The end: Polly again.
  await top();
  mark("end_start");
  await wait(10);
  mark("end_end");
} finally {
  await context.close();
  await browser.close();
  const file = readdirSync(out).find((name) => name.endsWith(".webm") && name !== "raw.webm");
  if (file) renameSync(join(out, file), join(out, "raw.webm"));
  save();
  console.log(`footage in ${join(out, "raw.webm")}`);
}
