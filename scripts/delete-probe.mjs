#!/usr/bin/env node
// Deletes a throwaway test coin launched with `--keep-key`, sending everything it holds back to
// `--to`. Testnet only. A locked coin has no key and can never be deleted.
//
//   node scripts/delete-probe.mjs probe.squawk-hq.testnet --to squawk-hq.testnet
import { rmSync } from "node:fs";
import { actions } from "near-api-js";
import { EXPLORER, NETWORK, accountExists, argv, keyFile, send } from "./lib.mjs";

const { positional, flags } = argv();
const [probe] = positional;
if (!probe || !flags.to || NETWORK !== "testnet") {
  console.error("usage: node scripts/delete-probe.mjs <probe account> --to <beneficiary>   (testnet only)");
  process.exit(1);
}
if (!(await accountExists(probe))) {
  console.log(`${probe} does not exist. Nothing to do.`);
  process.exit(0);
}
try {
  const outcome = await send(probe, probe, [actions.deleteAccount(flags.to)]);
  console.log(`Deleted ${probe}; its balance went to ${flags.to}.  ${EXPLORER}/txns/${outcome.transaction.hash}`);
} catch (error) {
  // The deletion may have landed even though the reply didn't. The chain says which.
  if (await accountExists(probe)) throw error;
  console.log(`Deleted ${probe}; its balance went to ${flags.to}.`);
}
rmSync(keyFile(probe), { force: true });
