#!/usr/bin/env node
// Runs every rule of a live SQUAWK coin as real transactions, and writes what happened, with a
// link to each transaction, to docs/EVIDENCE.md. Use the speedrun coin: it plays two full rounds,
// one that reaches the target and one that doesn't, so it takes about eleven minutes.
//
//   node scripts/prove.mjs fast.squawk-hq.testnet --daily coin.squawk-hq.testnet
//
// It signs as the demo accounts in private/cast.json (from scripts/cast.mjs). Testnet only.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXPLORER, KV, NETWORK, ONE, accessKeys, accountInfo, argv, attempt as attemptCall, crackers, kvLatest, kvWait, near, sleep, units, view, yocto,
} from "./lib.mjs";

const { positional, flags } = argv();
const coin = positional[0];
if (!coin || NETWORK !== "testnet") {
  console.error("usage: node scripts/prove.mjs <speedrun coin> [--daily <daily coin>]   (testnet only)");
  process.exit(1);
}
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const cast = JSON.parse(readFileSync(here("../private/cast.json"), "utf8"));
const [maya, leo, zoe] = cast.writers;
const [ana, sam] = cast.fans.map((fan) => fan.account);
const rules = await view(coin, "rules");
const social = rules.social;
const price = BigInt(rules.yocto_per_unit);

const rows = [];
let failures = 0;
let [lastHash, lastGas] = [null, null];
/** `attempt`, remembering the gas of the last call so its evidence row can show it. */
const attempt = async (...args) => {
  const result = await attemptCall(...args);
  [lastHash, lastGas] = [result.hash, result.gas];
  return result;
};
const tx = (hash, gas) => (hash ? `[${hash.slice(0, 8)}...](${EXPLORER}/txns/${hash})${gas ? `, ${gas} TGas` : ""}` : "");
const kvLink = (account, key) => `${KV}/v0/latest/${social}/${account}/${encodeURIComponent(key)}`;
/** One line of evidence. `pass` says whether the chain did what the README says it does. */
function record(rule, what, pass, hash, extra = "") {
  rows.push({ rule, what, pass, hash, extra, gas: hash && hash === lastHash ? lastGas : null });
  console.log(`${pass ? "PASS" : "FAIL"}  ${rule}: ${what}${hash ? `  ${EXPLORER}/txns/${hash}` : ""}`);
  if (!pass) failures++;
}

const status = () => view(coin, "status");
const left = (s) => Number(s.round_ends_ms) - Number(s.now_ms);
/** Waits for a round that has at least `ms` to go. */
async function freshRound(ms) {
  const s = await status();
  if (left(s) < ms) {
    console.log(`... waiting ${Math.ceil(left(s) / 1000)} s for the next round`);
    await sleep(left(s) + 3_000);
  }
}
async function roundEnd() {
  const s = await status();
  console.log(`... waiting ${Math.ceil(left(s) / 1000)} s for the round to end`);
  await sleep(left(s) + 3_000);
}
/** A feed of at least `want` crackers that the contract will accept right now. */
async function feedable(who, post, want) {
  const floor = BigInt(await view(coin, "feed_floor", { account_id: who, post }));
  const amount = units(want);
  return amount > floor ? amount : floor;
}
const balance = async (account) => BigInt((await accountInfo(account, "optimistic")).amount);
const has = (result, event) => result.logs.some((line) => line.includes(`"event":"${event}"`));

console.log(`Proving ${coin}, as ${ana} and ${sam}\n`);

// ----- the launch -------------------------------------------------------------------------------

const deployment = (id) => {
  const file = here(`../deployments/${id}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
for (const id of [coin, flags.daily].filter(Boolean)) {
  const launch = deployment(id);
  const keys = await accessKeys(id);
  if (launch?.launched_tx) record("Launch", `${id} deployed and initialised in one transaction`, true, launch.launched_tx);
  record("No admin key", `${id} deleted its only key, and has ${keys.length} access keys now`, keys.length === 0, launch?.locked_tx);
  const profile = await kvLatest(social, id, { key_prefix: "profile/" });
  const name = profile.find((row) => row.key === "profile/name");
  record(
    "Polly's voice",
    `${id} wrote its own near.social profile ("${name?.value ?? "missing"}") at launch, with no key`,
    Boolean(name) && name.predecessor_id === id,
    null,
    `[FastData row](${kvLink(id, "profile/name")})`,
  );
}

// ----- round A: the flock reaches the target ---------------------------------------------------

await freshRound(Number(rules.round_ms) - 40_000);
let s = await status();
const roundA = Number(s.round);
console.log(`\nRound ${roundA + 1}: the flock reaches the target`);

let r = await attempt(ana, coin, "bake", {}, { deposit: yocto("0.6") });
record("Bake", `${ana} baked ${crackers(r.value ?? 0)} crackers for 0.6 NEAR, at the fixed price`, r.ok && has(r, "ft_mint"), r.hash);

s = await status();
const [cutA, streakA] = [s.cut_bps, s.streak];
const firstFeed = await feedable(ana, maya.post, "70");
const before = await balance(maya.account);
r = await attempt(ana, coin, "feed", { post: maya.post, amount: firstFeed.toString() }, { tgas: 80n });
await sleep(3_000);
const after = await balance(maya.account);
const fed = r.value;
record(
  "Feed pays the writer at once",
  `${ana} fed ${crackers(firstFeed)} crackers to ${maya.post}. ${near(fed?.paid ?? 0)} NEAR went to ${maya.account} in the same transaction (balance up ${near(after - before)} NEAR), ${near(fed?.cut ?? 0)} NEAR was Polly's cut`,
  r.ok && has(r, "ft_burn") && after - before === BigInt(fed.paid),
  r.hash,
);
const cutFor = (streak) => Math.max(rules.cut_min_bps, rules.cut_max_bps - rules.cut_step_bps * streak);
record(
  "The cut",
  `with a streak of ${streakA}, Polly kept ${Number((BigInt(fed.cut) * 10_000n) / (firstFeed * price)) / 100}% of the tip, as the rules say`,
  cutA === cutFor(streakA) && BigInt(fed.cut) * 10_000n === firstFeed * price * BigInt(cutA),
  r.hash,
);

const floor = BigInt(await view(coin, "feed_floor", { account_id: ana, post: leo.post }));
r = await attempt(ana, coin, "feed", { post: leo.post, amount: (floor - 1n).toString() }, { tgas: 80n });
record("Refused: a feed too small to pay for its storage", `${crackers(floor - 1n)} crackers, refused: "${r.said}"`, !r.ok && /SQUAWK\[SMALL\]/.test(r.said), r.hash);
r = await attempt(ana, coin, "feed", { post: `${leo.account}/0123`, amount: units("50").toString() }, { tgas: 80n });
record("Refused: a post reference that isn't one", `"${leo.account}/0123", refused: "${r.said}"`, !r.ok && /SQUAWK\[POST\]/.test(r.said), r.hash);

r = await attempt(sam, coin, "bake", {}, { deposit: yocto("0.3") });
record("Bake", `${sam} baked ${crackers(r.value ?? 0)} crackers`, r.ok, r.hash);

// Halfway through the round, a cracker counts for a little more than half.
s = await status();
const halfway = Number(s.round_ends_ms) - Number(rules.round_ms) / 2;
if (Number(s.now_ms) < halfway) {
  console.log(`... waiting ${Math.ceil((halfway - Number(s.now_ms)) / 1000)} s for the middle of the round`);
  await sleep(halfway - Number(s.now_ms));
}
const lateFeed = await feedable(sam, leo.post, "50");
r = await attempt(sam, coin, "feed", { post: leo.post, amount: lateFeed.toString() }, { tgas: 80n });
const late = r.value;
const share = late ? Number((BigInt(late.weight) * 10_000n) / lateFeed) / 100 : 0;
record(
  "Early crackers weigh more",
  `${sam} fed ${crackers(lateFeed)} crackers past the middle of the round; they count ${share}% toward the squawk, ${crackers(late?.weight ?? 0)} crackers' worth`,
  r.ok && BigInt(late.weight) < lateFeed && BigInt(late.weight) > (lateFeed * BigInt(rules.late_weight_bps)) / 10_000n,
  r.hash,
);

s = await status();
const short = BigInt(s.target) > BigInt(s.fed) ? BigInt(s.target) - BigInt(s.fed) : 0n;
if (short > 0n) {
  const topUp = await feedable(ana, zoe.post, String(Number(short / ONE) + 5));
  r = await attempt(ana, coin, "feed", { post: zoe.post, amount: topUp.toString() }, { tgas: 80n });
  record("Feed", `${ana} fed ${crackers(topUp)} crackers to ${zoe.post}`, r.ok, r.hash);
}
s = await status();
record("Target", `the flock fed ${crackers(s.fed)} of ${crackers(s.target)} crackers in round ${roundA + 1}`, BigInt(s.fed) >= BigInt(s.target), null);
const leader = s.top;

await roundEnd();
s = await status();
record("Polly falls asleep", `after the round, the contract reports a squawk waiting for round ${Number(s.waiting_round) + 1}`, s.asleep && s.waiting_squawk, null);
r = await attempt(sam, coin, "squawk", {});
const records = await view(coin, "records", { from: Number((await status()).records_len) - 1, limit: 1 });
const won = records[0];
record(
  "Squawk",
  `${sam} woke Polly. She squawked round ${Number(won.round) + 1}: ${won.top} won with ${crackers(won.pile)} crackers, streak ${won.streak}, and ${sam} was paid ${near(won.bounty)} NEAR`,
  r.ok && has(r, "squawk") && won.squawked && won.top === leader && won.woken_by === sam && BigInt(won.bounty) > 0n,
  r.hash,
);

// What Polly wrote, read back from near.social's own data store.
const postKey = `post/${won.polly_post}`;
const post = await kvWait(social, coin, postKey, { tries: 60 });
record(
  "Written by the contract",
  post
    ? `FastData has a post by ${post.predecessor_id} that quotes ${post.value.quote}: "${post.value.text.slice(0, 90)}..."`
    : `no post ${postKey} by ${coin} in FastData yet`,
  Boolean(post) && post.predecessor_id === coin && post.value.quote === won.top,
  post?.tx_hash ?? r.hash,
  `[FastData row](${kvLink(coin, postKey)})`,
);
const writer = won.top.split("/")[0];
const like = await kvWait(social, coin, `like/${won.top}`, { tries: 20 });
const follow = await kvWait(social, coin, `graph/follow/${writer}`, { tries: 20 });
record("Like and follow", `Polly liked the winning post and followed ${writer}`, Boolean(like) && Boolean(follow), null, `[like](${kvLink(coin, `like/${won.top}`)}), [follow](${kvLink(coin, `graph/follow/${writer}`)})`);

// ----- round B: the flock falls short ------------------------------------------------------------

s = await status();
console.log(`\nRound ${Number(s.round) + 1}: the flock falls short`);
const cutNow = s.cut_bps;
const small = await feedable(ana, maya.post, "40");
r = await attempt(ana, coin, "feed", { post: maya.post, amount: small.toString() }, { tgas: 80n });
record(
  "A streak lowers the cut",
  `the streak is now ${s.streak}, so Polly kept ${cutNow / 100}% of ${ana}'s next tip, down from ${cutA / 100}%`,
  r.ok && s.streak === streakA + 1 && cutNow === cutFor(s.streak) && (cutNow < cutA || cutA === rules.cut_min_bps) &&
    BigInt(r.value.cut) * 10_000n === small * price * BigInt(cutNow),
  r.hash,
);
await roundEnd();
r = await attempt(ana, coin, "squawk", {});
const missed = (await view(coin, "records", { from: Number((await status()).records_len) - 1, limit: 1 }))[0];
s = await status();
record(
  "A round that misses",
  `round ${Number(missed.round) + 1} ended with ${crackers(missed.fed)} of ${crackers(rules.target)} crackers: no squawk, no bounty, and the streak went back to ${s.streak}`,
  r.ok && has(r, "miss") && !missed.squawked && s.streak === 0 && BigInt(missed.bounty) === 0n,
  r.hash,
);
// Her profile is rewritten whenever the streak changes. Wait for the version written just now.
let about = "";
for (let i = 0; i < 40 && !/Streak: 0 \(best [1-9]/.test(about); i++) {
  about = (await kvLatest(social, coin, { key: "profile/about" }, { pages: 1 }))[0]?.value ?? "";
  if (!/Streak: 0 \(best [1-9]/.test(about)) await sleep(1_500);
}
record(
  "Polly keeps her profile current",
  `her near.social profile, rewritten by the contract, now says "${about.match(/Streak: [^.]+\./)?.[0] ?? "?"}"`,
  /Streak: 0 \(best [1-9]/.test(about),
  null,
  `[FastData row](${kvLink(coin, "profile/about")})`,
);

// ----- things nobody can do ----------------------------------------------------------------------

console.log("\nThings the contract refuses");
const refused = async (rule, who, method, args, needle, options) => {
  const result = await attempt(who, coin, method, args, options);
  record(`Refused: ${rule}`, `"${result.said}"`, !result.ok && needle.test(result.said ?? ""), result.hash);
};
await refused("setting the rules again", ana, "new", {
  name: "x", symbol: "X", icon: null, rules, profile_name: "x", website: "https://example.com", avatar: null, genesis_ms: null,
}, /already been initialized|already initialized/i);
await refused("calling the token's private callback", ana, "ft_resolve_transfer", { sender_id: ana, receiver_id: sam, amount: "1" }, /private/i);
await refused("leaving while holding crackers", ana, "storage_unregister", { force: true }, /SQUAWK\[CRUMBS\]/, { deposit: 1n });
await refused("registering Polly as a holder", ana, "storage_deposit", { account_id: coin }, /SQUAWK\[SELF\]/, { deposit: yocto("0.00125") });
await refused("sending crackers to Polly", ana, "ft_transfer", { receiver_id: coin, amount: ONE.toString() }, /not registered/i, { deposit: 1n });
await refused("baking with almost nothing", ana, "bake", {}, /SQUAWK\[SMALL\]/, { deposit: 1n });

// ----- the token standard ------------------------------------------------------------------------

console.log("\nThe token standard");
r = await attempt(ana, coin, "ft_transfer", { receiver_id: sam, amount: units("5").toString() }, { deposit: 1n });
record("NEP-141 transfer", `${ana} sent 5 crackers to ${sam}`, r.ok && r.logs.some((line) => line.includes('"event":"ft_transfer"')), r.hash);
const fee = BigInt((await view(coin, "storage_balance_bounds")).min);
const heldBefore = BigInt((await status()).deposits);
r = await attempt(zoe.account, coin, "storage_deposit", {}, { deposit: fee });
const heldDuring = BigInt((await status()).deposits);
record("NEP-145 registration", `${zoe.account} registered for ${near(fee, 5)} NEAR; ${near(heldDuring - heldBefore, 5)} NEAR of it is held for the account, never spent`, r.ok && heldDuring > heldBefore, r.hash);
const zoeBefore = await balance(zoe.account);
r = await attempt(zoe.account, coin, "storage_unregister", {}, { deposit: 1n });
await sleep(3_000);
const zoeAfter = await balance(zoe.account);
record("Leaving", `${zoe.account} left with no crackers and got the whole fee back`, r.ok && BigInt((await status()).deposits) === heldBefore && zoeAfter > zoeBefore, r.hash);

// ----- the daily coin gets its first feed ------------------------------------------------------

if (flags.daily) {
  console.log(`\nThe daily coin, ${flags.daily}`);
  r = await attempt(ana, flags.daily, "bake", {}, { deposit: yocto("0.25") });
  record("Daily coin: bake", `${ana} baked ${crackers(r.value ?? 0)} crackers`, r.ok, r.hash);
  const amount = BigInt(await view(flags.daily, "feed_floor", { account_id: ana, post: maya.post })) + units("10");
  r = await attempt(ana, flags.daily, "feed", { post: maya.post, amount: amount.toString() }, { tgas: 80n });
  record("Daily coin: feed", `${ana} fed ${crackers(amount)} crackers to ${maya.post}`, r.ok, r.hash);
}

// ----- the books ---------------------------------------------------------------------------------

const verify = (id) => {
  try {
    return { ok: true, out: execFileSync(process.execPath, [here("./verify.mjs"), id], { encoding: "utf8" }) };
  } catch (error) {
    return { ok: false, out: String(error.stdout ?? error.message) };
  }
};
const checks = [coin, flags.daily].filter(Boolean).map((id) => ({ id, ...verify(id) }));
for (const check of checks) {
  const passes = (check.out.match(/^PASS/gm) ?? []).length;
  record("verify.mjs", `${check.id}: ${passes} checks passed${check.ok ? ", everything matches" : ", some failed"}`, check.ok, null);
}

// ----- the evidence page -------------------------------------------------------------------------

const date = new Date().toISOString().slice(0, 16).replace("T", " ");
const lines = [
  "# Evidence from testnet",
  "",
  `Every rule in the README, run as real transactions on NEAR testnet by \`scripts/prove.mjs\` on ${date} UTC.`,
  `The speedrun coin is [\`${coin}\`](${EXPLORER}/address/${coin})${flags.daily ? ` and the daily coin is [\`${flags.daily}\`](${EXPLORER}/address/${flags.daily})` : ""}.`,
  `The accounts that bake and feed (${ana}, ${sam}) and the writers (${cast.writers.map((w) => w.account).join(", ")}) are demo accounts made by \`scripts/cast.mjs\`.`,
  "A refused call is a transaction that failed on chain, and its link shows the contract's own reason.",
  "",
  "| | Rule | What happened | Transaction |",
  "|---|---|---|---|",
  ...rows.map((row) => `| ${row.pass ? "✅" : "❌"} | ${row.rule} | ${row.what.replace(/\|/g, "\\|")}${row.extra ? ` ${row.extra}` : ""} | ${tx(row.hash, row.gas)} |`),
  "",
  "Run it again on any coin:",
  "",
  "```",
  `node scripts/prove.mjs ${coin}${flags.daily ? ` --daily ${flags.daily}` : ""}`,
  "```",
  "",
  "## verify.mjs, at the end of the run",
  "",
  ...checks.flatMap((check) => ["```", check.out.trim(), "```", ""]),
];
writeFileSync(here("../docs/EVIDENCE.md"), lines.join("\n"));
console.log(`\n${rows.length - failures} of ${rows.length} passed. Wrote docs/EVIDENCE.md`);
process.exit(failures ? 1 : 0);
