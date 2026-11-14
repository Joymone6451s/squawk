#!/usr/bin/env node
// Prints where a SQUAWK coin stands. Read-only: no key, no account.
//
//   node scripts/status.mjs <coin>
import { EXPLORER, argv, crackers, near, view } from "./lib.mjs";

const coin = argv().positional[0];
if (!coin) {
  console.error("usage: node scripts/status.mjs <coin>");
  process.exit(1);
}

const [status, rules] = await Promise.all([view(coin, "status"), view(coin, "rules")]);
const left = Math.max(0, Number(status.round_ends_ms) - Number(status.now_ms));
const clock = `${Math.floor(left / 3_600_000)}h ${Math.floor((left % 3_600_000) / 60_000)}m ${Math.floor((left % 60_000) / 1000)}s`;
const pots = await view(coin, "posts", { round: status.round });

console.log(`${coin}  ${EXPLORER}/address/${coin}`);
console.log(`Round ${Number(status.round) + 1}, ends in ${clock}`);
console.log(`Fed this round   ${crackers(status.fed)} of ${crackers(status.target)} crackers${BigInt(status.fed) >= BigInt(status.target) ? "  (target reached)" : ""}`);
console.log(`Streak           ${status.streak}  (best ${status.best_streak}), ${status.squawks} squawks so far`);
console.log(`Polly's cut      ${status.cut_bps / 100}% of a tip right now`);
console.log(`A cracker now    counts ${status.weight_bps / 100}% toward the squawk`);
if (status.asleep) {
  console.log(
    status.waiting_squawk
      ? `ASLEEP           round ${Number(status.waiting_round) + 1} reached its target. Wake Polly (node scripts/play.mjs squawk) to earn up to ${near(rules.wake_bounty)} NEAR.`
      : `ASLEEP           round ${Number(status.waiting_round) + 1} is over without a squawk. The next bake or feed starts the new round.`,
  );
}
console.log("");
console.log(`In circulation   ${crackers(status.supply)} crackers  (baked ${crackers(status.baked)}, eaten ${crackers(status.eaten)})`);
console.log(`The nest         ${near(status.nest)} NEAR  (exactly ${near(BigInt(rules.yocto_per_unit) * 10n ** 18n)} NEAR for each cracker)`);
console.log(`Sent to writers  ${near(status.tipped)} NEAR`);
console.log(`Polly's hoard    ${near(status.hoard)} NEAR  (cut taken so far ${near(status.cut)}, bounties paid ${near(status.bounties)})`);
console.log("");
if (pots.length) {
  console.log("This round's piles, heaviest first:");
  for (const pot of [...pots].sort((a, b) => (BigInt(b.weight) > BigInt(a.weight) ? 1 : -1))) {
    console.log(`  ${pot.post === status.top ? ">" : " "} ${crackers(pot.fed).padStart(8)} crackers  ${near(pot.tipped).padStart(8)} NEAR to the writer  ${pot.post}`);
  }
} else {
  console.log("Nobody has fed Polly this round.");
}
