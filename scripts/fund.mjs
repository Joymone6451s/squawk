#!/usr/bin/env node
// Sends test NEAR from one of your accounts to another, for example to top up a demo fan.
// Testnet only.
//
//   node scripts/fund.mjs ana.squawk-hq.testnet 0.4 --from squawk-hq.testnet
import { actions } from "near-api-js";
import { EXPLORER, NETWORK, argv, send, yocto } from "./lib.mjs";

const { positional, flags } = argv();
const [to, amount] = positional;
if (!to || !amount || !flags.from || NETWORK !== "testnet") {
  console.error("usage: node scripts/fund.mjs <to> <NEAR> --from <account>   (testnet only)");
  process.exit(1);
}
const outcome = await send(flags.from, to, [actions.transfer(yocto(amount))]);
console.log(`Sent ${amount} NEAR from ${flags.from} to ${to}.  ${EXPLORER}/txns/${outcome.transaction.hash}`);
