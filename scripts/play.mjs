#!/usr/bin/env node
// Everything a person or an agent can do with a SQUAWK coin, from the command line. Each command
// signs with the key of `--as` from the NEAR CLI keychain (~/.near-credentials).
//
//   node scripts/play.mjs bake   <coin> --as you.testnet --near 0.5
//   node scripts/play.mjs feed   <coin> --as you.testnet --post alice.testnet/1759140000000 --crackers 60
//   node scripts/play.mjs squawk <coin> --as you.testnet
//   node scripts/play.mjs post   <coin> --as you.testnet --text "gm #near"     (writes to near.social)
//   node scripts/play.mjs floor  <coin> --as you.testnet --post alice.testnet/1759140000000
import { EXPLORER, argv, call, crackers, kvWait, logsOf, near, returned, socialWrite, units, view, yocto } from "./lib.mjs";

const { positional, flags } = argv();
const [command, coin] = positional;
const who = flags.as;
if (!command || !coin || !who) {
  console.error("usage: node scripts/play.mjs <bake|feed|squawk|post|floor> <coin> --as <account> [--near N] [--post account/id] [--crackers N] [--text \"...\"]");
  process.exit(1);
}

const link = (outcome) => `${EXPLORER}/txns/${outcome.transaction.hash}`;
/** What the contract paid `account` for waking Polly, read from the last round's record. */
async function bounty(account) {
  const { records_len } = await view(coin, "status");
  if (!records_len) return 0n;
  const [record] = await view(coin, "records", { from: records_len - 1, limit: 1 });
  return record.squawked && record.woken_by === account ? BigInt(record.bounty) : 0n;
}
const squawked = (outcome) => logsOf(outcome).some((line) => line.includes('"event":"squawk"'));

if (command === "bake") {
  const outcome = await call(who, coin, "bake", {}, { deposit: yocto(flags.near ?? "0.5") });
  console.log(`Baked ${crackers(returned(outcome))} crackers for ${flags.near ?? "0.5"} NEAR.  ${link(outcome)}`);
  if (squawked(outcome)) console.log(`That call also woke Polly: she squawked, and paid ${near(await bounty(who))} NEAR for it.`);
} else if (command === "feed") {
  if (!flags.post || !flags.crackers) throw new Error("feed needs --post account/id and --crackers N");
  const outcome = await call(who, coin, "feed", { post: flags.post, amount: units(flags.crackers).toString() }, { tgas: 80n });
  const fed = returned(outcome);
  console.log(`Fed ${flags.crackers} crackers to ${fed.post}.  ${link(outcome)}`);
  console.log(`  ${near(fed.paid)} NEAR was sent to the writer at once, ${near(fed.cut)} NEAR is Polly's cut.`);
  console.log(`  The pile now weighs ${crackers(fed.pile_weight)}${fed.top ? " and leads the round." : "."}`);
  if (squawked(outcome)) console.log(`That call also woke Polly: she squawked, and paid ${near(await bounty(who))} NEAR for it.`);
} else if (command === "squawk") {
  const outcome = await call(who, coin, "squawk", {});
  if (squawked(outcome)) console.log(`Polly squawked. The contract paid ${near(await bounty(who))} NEAR for waking her.  ${link(outcome)}`);
  else console.log(`${returned(outcome) ? "A round was counted, without a squawk." : "Nothing to count: the round is still open."}  ${link(outcome)}`);
} else if (command === "post") {
  if (!flags.text) throw new Error('post needs --text "..."');
  const rules = await view(coin, "rules");
  const id = Date.now();
  await socialWrite(who, { [`post/${id}`]: { text: flags.text } }, { social: rules.social });
  const row = await kvWait(rules.social, who, `post/${id}`);
  console.log(row ? `Posted as ${who}/${id}` : `Sent as ${who}/${id}, but FastData has not indexed it yet.`);
} else if (command === "floor") {
  if (!flags.post) throw new Error("floor needs --post account/id");
  const floor = await view(coin, "feed_floor", { account_id: who, post: flags.post });
  console.log(`The smallest feed ${who} can make on ${flags.post} right now is ${crackers(floor)} crackers.`);
} else {
  throw new Error(`unknown command ${command}`);
}
