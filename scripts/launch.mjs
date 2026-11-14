#!/usr/bin/env node
// Launches SQUAWK on a new sub-account of `--parent`, then removes that sub-account's only key,
// so nobody can change the coin afterwards. All key handling happens here and nothing is printed.
//
//   node scripts/launch.mjs --parent squawk-hq.testnet --name coin --preset daily
//   node scripts/launch.mjs --parent squawk-hq.testnet --name fast --preset speedrun
//
// Options:
//   --website <https url>   what Polly's profile links to (default: the contract's explorer page)
//   --avatar <fastfs url>   Polly's profile picture, already uploaded to FastFS
//   --hoard <NEAR>          NEAR to start the hoard with, on top of storage (default 0.05)
//   --keep-key              skip the lock. For a throwaway test only: the account can be deleted.
//
// Each launch is recorded in deployments/<account>.json: public facts only, no keys.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KeyPair, actions } from "near-api-js";
import { EXPLORER, NEAR, NETWORK, TGAS, accessKeys, accountExists, argv, chainTime, keyFile, near, send, sleep, view, yocto } from "./lib.mjs";
import { ICON, PRESETS } from "./presets.mjs";

const { flags } = argv();
const parentId = flags.parent;
const label = flags.name;
const preset = PRESETS[flags.preset ?? "daily"];
if (!parentId || !label || !preset) {
  console.error("usage: node scripts/launch.mjs --parent <account> --name <label> [--preset daily|speedrun] [--website <url>] [--avatar <fastfs url>] [--hoard <NEAR>] [--keep-key]");
  process.exit(1);
}

const wasmFile = flags.wasm ?? fileURLToPath(new URL("../contract/res/squawk.wasm", import.meta.url));
const wasm = readFileSync(wasmFile);
const id = `${label}.${parentId}`;
if (await accountExists(id)) {
  console.error(`${id} already exists. Pick another --name.`);
  process.exit(1);
}

// What the account must hold: the wasm, a little room for its first state, and the starting hoard.
// The bounty is paid out of what each round earns, so the hoard needs no cushion of its own.
const hoard = yocto(flags.hoard ?? "0.05");
const reserve = BigInt(wasm.length + 4_000) * 10n ** 19n + hoard;

// Rounds line up with the clock: a daily coin's rounds end at midnight UTC. The contract accepts a
// start that is no later than the block it runs in and less than one round before it, so this
// reads the chain's own clock and keeps away from both ends of a round.
const roundMs = Number(preset.rules.round_ms);
let now = await chainTime();
if (now % roundMs > roundMs - 60_000) {
  const wait = roundMs - (now % roundMs) + 5_000;
  console.log(`A round boundary is close. Waiting ${Math.ceil(wait / 1000)} s so the launch lands well inside a round.`);
  await sleep(wait);
  now = await chainTime();
}
const genesis = now - (now % roundMs);

const args = {
  name: preset.name,
  symbol: preset.symbol,
  icon: ICON,
  rules: preset.rules,
  profile_name: preset.profile_name,
  website: flags.website ?? `${EXPLORER}/address/${id}`,
  avatar: flags.avatar ?? null,
  genesis_ms: String(genesis),
};

const keyPair = KeyPair.fromRandom("ed25519");
const publicKey = keyPair.getPublicKey();
const sha256 = createHash("sha256").update(wasm).digest("hex");
const record = {
  account: id,
  network: NETWORK,
  preset: flags.preset ?? "daily",
  code_sha256: sha256,
  code_bytes: wasm.length,
  genesis_ms: genesis,
  rules: preset.rules,
  launched_tx: null,
  locked_tx: null,
};
const recordFile = fileURLToPath(new URL(`../deployments/${id}.json`, import.meta.url));
mkdirSync(fileURLToPath(new URL("../deployments/", import.meta.url)), { recursive: true });
const saveRecord = () => writeFileSync(recordFile, JSON.stringify(record, null, 2) + "\n");

console.log(`Launching ${id} on ${NETWORK}`);
console.log(`  code      ${wasm.length} bytes, sha256 ${sha256}`);
console.log(`  funding   ${near(reserve)} NEAR from ${parentId} (${near(hoard)} of it starts the hoard)`);
console.log(`  rules     ${JSON.stringify(preset.rules)}`);
const launched = await send(parentId, id, [
  actions.createAccount(),
  actions.transfer(reserve),
  actions.addFullAccessKey(publicKey),
  actions.deployContract(wasm),
  actions.functionCall("new", args, 100n * TGAS, 0n),
]);
console.log(`Launched: ${EXPLORER}/txns/${launched.transaction.hash}`);
record.launched_tx = launched.transaction.hash;
saveRecord();

if (flags["keep-key"]) {
  // A throwaway test. The key goes in the keychain so the account can be deleted and refunded.
  writeFileSync(keyFile(id), JSON.stringify({ account_id: id, public_key: publicKey.toString(), private_key: keyPair.toString() }), { mode: 0o600 });
  console.log("Key kept. This account is NOT locked.");
} else {
  const locked = await send(id, id, [actions.deleteKey(publicKey)], { secret: keyPair.toString() });
  // The key list is read at final, which trails the latest block by a few seconds.
  let left = await accessKeys(id);
  for (let i = 0; i < 15 && left.length !== 0; i++) {
    await sleep(1000);
    left = await accessKeys(id);
  }
  if (left.length !== 0) {
    console.error(`Lock failed: ${left.length} key(s) remain on ${id}.`);
    process.exit(1);
  }
  console.log(`Locked:   ${EXPLORER}/txns/${locked.transaction.hash}`);
  console.log(`${id} has no access keys. Nobody can change it now.`);
  record.locked_tx = locked.transaction.hash;
  saveRecord();
}

const status = await view(id, "status");
console.log(`Round ${status.round} ends ${new Date(Number(status.round_ends_ms)).toISOString()}. Hoard ${near(status.hoard)} NEAR.`);
console.log(`Check it any time, with no key:  node scripts/verify.mjs ${id}`);
void NEAR;
