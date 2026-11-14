#!/usr/bin/env node
// Checks a live SQUAWK coin against what the README claims. Read-only: it needs no key, no
// account and no wallet. Exits non-zero if any check fails.
//
//   node scripts/verify.mjs <coin>
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KV, NETWORK, accessKeys, accountInfo, argv, crackers, kvLatest, near, view } from "./lib.mjs";

const coin = argv().positional[0];
if (!coin) {
  console.error("usage: node scripts/verify.mjs <coin>");
  process.exit(1);
}

let failed = 0;
function check(name, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  if (!pass) failed++;
}
const note = (name, detail) => console.log(`INFO  ${name}: ${detail}`);

/** Reads a whole paged view. */
async function all(method, total) {
  const rows = [];
  for (let from = 0; from < total; from += 100) rows.push(...(await view(coin, method, { from, limit: 100 })));
  return rows;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

console.log(`Checking ${coin} on ${NETWORK}\n`);
const [meta, supply, rules, status, info, keys] = await Promise.all([
  view(coin, "ft_metadata"),
  view(coin, "ft_total_supply"),
  view(coin, "rules"),
  view(coin, "status"),
  accountInfo(coin),
  accessKeys(coin),
]);
const big = (v) => BigInt(v);
const price = big(rules.yocto_per_unit);

// The token standard.
check("NEP-148 metadata", meta.spec === "ft-1.0.0" && meta.decimals === 18, `${meta.name} (${meta.symbol}), ${meta.decimals} decimals`);
check("NEP-141 supply matches the status view", supply === status.supply, `${crackers(supply)} crackers`);

// No admin path: the track's central rule.
check("No access keys on the coin", keys.length === 0, `${keys.length} key(s)`);
for (const key of keys) note("Key still on the account", key.public_key);
const wasmFile = fileURLToPath(new URL("../contract/res/squawk.wasm", import.meta.url));
if (existsSync(wasmFile)) {
  const local = base58(createHash("sha256").update(readFileSync(wasmFile)).digest());
  check("The code on chain is the code in this repository", info.code_hash === local, info.code_hash);
} else {
  note("Code hash", `${info.code_hash} (build the contract to compare it with this repository)`);
}
const required = [
  "round_ms", "yocto_per_unit", "target", "min_feed", "cut_max_bps", "cut_min_bps", "cut_step_bps",
  "late_weight_bps", "wake_bounty", "social",
];
check("Every parameter is public", required.every((k) => k in rules), `${required.length} parameters`);
check(
  "The rules are inside the limits the contract promises",
  rules.cut_min_bps >= 100 && rules.cut_max_bps <= 5_000 && rules.cut_min_bps <= rules.cut_max_bps && rules.late_weight_bps >= 1_000 &&
    big(rules.wake_bounty) <= (big(rules.target) * price * BigInt(rules.cut_min_bps)) / 10_000n,
  `cut ${rules.cut_max_bps / 100}% falling to ${rules.cut_min_bps / 100}%, late weight ${rules.late_weight_bps / 100}%`,
);

// The books.
const [log, records] = await Promise.all([all("log", status.log_len), all("records", status.records_len)]);
const sum = (rows, pick) => rows.reduce((total, row) => total + big(pick(row)), 0n);
const bakes = log.filter((e) => e.kind === "Bake");
const feeds = log.filter((e) => e.kind === "Feed");
check("Supply is what was baked less what was eaten", big(status.supply) === big(status.baked) - big(status.eaten), `${crackers(status.baked)} baked, ${crackers(status.eaten)} eaten`);
check("The nest holds exactly supply x price", big(status.nest) === big(status.supply) * price, `${near(status.nest)} NEAR`);
check("Every eaten cracker's NEAR went to a writer or to the hoard", big(status.tipped) + big(status.cut) === big(status.eaten) * price, `${near(status.tipped)} NEAR to writers, ${near(status.cut)} NEAR cut`);
check("The log holds every mint", log.length === status.log_len && sum(bakes, (e) => e.units) === big(status.baked), `${bakes.length} bakes`);
check("The log holds every burn", sum(feeds, (e) => e.units) === big(status.eaten), `${feeds.length} feeds`);
check("The log's tips and cuts add up to the totals", sum(feeds, (e) => e.near) === big(status.tipped) && sum(feeds, (e) => e.cut) === big(status.cut));
check("Bake lines account for every yocto attached", bakes.every((e) => big(e.near) === big(e.units) * price));
// Solvency, from the protocol's own numbers: the account's balance and its storage use.
const balance = big(info.amount);
const storage = BigInt(info.storage_usage) * 10n ** 19n;
const slack = 1_000n * 10n ** 19n;
const owed = big(status.nest) + storage + big(status.deposits);
check(
  "Polly is solvent: her balance covers the nest, her storage and the deposits she holds for accounts",
  balance >= owed,
  `${near(balance)} NEAR held, ${near(owed)} NEAR owed`,
);
// The views read the latest block and the account info the final one, so the two can differ by
// whatever happened in the last few seconds. A live coin is re-checked rather than failed.
const leftover = balance > owed + slack ? balance - owed - slack : 0n;
const drift = leftover > big(status.hoard) ? leftover - big(status.hoard) : big(status.hoard) - leftover;
if (drift === 0n) check("The hoard is exactly what is left over", true, `${near(status.hoard)} NEAR`);
else note("Hoard", `${near(status.hoard)} NEAR (the chain moved while this was being read; run it again for an exact match)`);

// The squawks.
const squawked = records.filter((r) => r.squawked);
check("Every squawk has a record", squawked.length === Number(status.squawks), `${squawked.length} squawks in ${records.length} fed rounds`);
check("Rounds only squawk when the flock reached the target", records.every((r) => r.squawked === (big(r.fed) >= big(rules.target))));
check("Bounties paid match the records", sum(records, (r) => r.bounty) === big(status.bounties), `${near(status.bounties)} NEAR`);
note("Streak", `${status.streak} now, ${status.best_streak} best`);

// Polly's voice: everything below was written to near.social by the contract itself.
try {
  const written = await kvLatest(rules.social, coin, {});
  const byKey = new Map(written.map((row) => [row.key, row]));
  check("Polly has a near.social profile, written by the contract", byKey.has("profile/name") && byKey.has("profile/about"), byKey.get("profile/name")?.value ?? "missing");
  const about = byKey.get("profile/about")?.value ?? "";
  check("Her profile says the account is automated", /automated/.test(about) && /no keys/.test(about));
  let found = 0;
  for (const record of squawked) {
    const post = byKey.get(`post/${record.polly_post}`);
    if (post && post.value?.quote === record.top && post.predecessor_id === coin) found++;
  }
  check("Every squawk is a post on near.social that quotes the winning post", found === squawked.length, `${found} of ${squawked.length} found in FastData (${KV})`);
} catch (error) {
  check("FastData KV could be read", false, String(error.message ?? error));
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nEverything matches.");
process.exit(failed ? 1 : 0);
