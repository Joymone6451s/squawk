#!/usr/bin/env node
// Sets up a small cast for demos on testnet: three writers with a near.social profile and a
// post each, and two fans with some test NEAR. They are sub-accounts of `--parent`, and their
// keys go in the NEAR CLI keychain so the other scripts can sign for them. Testnet only.
//
//   node scripts/cast.mjs --parent squawk-hq.testnet
//
// Running it again skips accounts that exist and posts that were already made.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KeyPair, actions } from "near-api-js";
import { NETWORK, accountExists, argv, keyFile, kvLatest, kvWait, near, send, socialWrite, yocto } from "./lib.mjs";

const { flags } = argv();
const parent = flags.parent;
if (!parent || NETWORK !== "testnet") {
  console.error("usage: node scripts/cast.mjs --parent <testnet account>   (testnet only)");
  process.exit(1);
}
const social = flags.social ?? "social";

const WRITERS = [
  {
    id: "maya",
    name: "Maya",
    about: "Learning Rust in public. Demo account for SQUAWK on testnet.",
    post: "I spent the whole weekend learning Rust, and tonight my first NEAR contract finally compiled. I may have cried a little. #near #buildinpublic",
  },
  {
    id: "leo",
    name: "Leo",
    about: "Explains crypto to his mum. Demo account for SQUAWK on testnet.",
    post: "Small thing I love about NEAR: my account is just my name. My mum can read it. #near",
  },
  {
    id: "zoe",
    name: "Zoe",
    about: "Draws birds. Demo account for SQUAWK on testnet.",
    post: "Drew a parrot today. She only repeats the nice things people say. #art",
  },
];
const FANS = [
  { id: "ana", name: "Ana", about: "Feeds parrots. Demo account for SQUAWK on testnet.", fund: flags.ana ?? "1.8" },
  { id: "sam", name: "Sam", about: "Tips writers. Demo account for SQUAWK on testnet.", fund: flags.sam ?? "0.8" },
];

async function ensure(id, fund) {
  const account = `${id}.${parent}`;
  if (await accountExists(account)) {
    if (!existsSync(keyFile(account))) throw new Error(`${account} exists but its key is not in the keychain`);
    return account;
  }
  const pair = KeyPair.fromRandom("ed25519");
  writeFileSync(keyFile(account), JSON.stringify({ account_id: account, public_key: pair.getPublicKey().toString(), private_key: pair.toString() }), { mode: 0o600 });
  await send(parent, account, [actions.createAccount(), actions.transfer(yocto(fund)), actions.addFullAccessKey(pair.getPublicKey())]);
  console.log(`created ${account} with ${fund} NEAR`);
  return account;
}

const cast = { parent, social, writers: [], fans: [] };
for (const writer of WRITERS) {
  const account = await ensure(writer.id, flags.writer ?? "0.1");
  const rows = await kvLatest(social, account, {});
  const keys = {};
  if (!rows.some((row) => row.key === "profile/name")) {
    keys["profile/name"] = writer.name;
    keys["profile/about"] = writer.about;
  }
  let post = rows.find((row) => row.key.startsWith("post/") && row.value?.text === writer.post)?.key.slice(5);
  if (!post) {
    post = String(Date.now());
    keys[`post/${post}`] = { text: writer.post };
  }
  if (Object.keys(keys).length) {
    await socialWrite(account, keys, { social });
    const landed = await kvWait(social, account, `post/${post}`);
    console.log(`${account} ${landed ? "posted" : "sent a post that FastData has not indexed yet"}: ${account}/${post}`);
  }
  cast.writers.push({ account, name: writer.name, post: `${account}/${post}` });
}
for (const fan of FANS) {
  const account = await ensure(fan.id, fan.fund);
  const rows = await kvLatest(social, account, { key: "profile/name" });
  if (!rows.length) await socialWrite(account, { "profile/name": fan.name, "profile/about": fan.about }, { social });
  cast.fans.push({ account, name: fan.name });
}

const out = fileURLToPath(new URL("../private/cast.json", import.meta.url));
mkdirSync(fileURLToPath(new URL("../private/", import.meta.url)), { recursive: true });
writeFileSync(out, JSON.stringify(cast, null, 2));
console.log(`\nThe cast is ready. Posts to feed:`);
for (const writer of cast.writers) console.log(`  ${writer.post}`);
console.log(`Fans: ${cast.fans.map((fan) => fan.account).join(", ")}`);
void readFileSync;
void near;
