#!/usr/bin/env node
// Says which of an account's keys the scripts will sign with, and whether that key is on the
// account. Prints public keys only.
//
//   node scripts/whoami.mjs you.testnet
import { KeyPair } from "near-api-js";
import { accessKeys, accountInfo, argv, near, secretKeyFor } from "./lib.mjs";

const id = argv().positional[0];
if (!id) {
  console.error("usage: node scripts/whoami.mjs <account>");
  process.exit(1);
}
const key = KeyPair.fromString(await secretKeyFor(id)).getPublicKey().toString();
const onChain = (await accessKeys(id)).map((k) => k.public_key);
const { amount } = await accountInfo(id);
console.log(`${id} holds ${near(amount)} NEAR. The scripts sign with ${key}, which is ${onChain.includes(key) ? "" : "NOT "}one of its keys on chain.`);
process.exit(onChain.includes(key) ? 0 : 1);
