// Shared helpers for the SQUAWK scripts. Reads use plain JSON-RPC, so `verify` and `status` need
// no key and no account. Scripts that sign read their key from the legacy NEAR CLI keychain
// (~/.near-credentials). A key is never printed and never leaves this machine.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, actions } from "near-api-js";

export const NETWORK = process.env.NEAR_NETWORK ?? "testnet";
// Public RPCs rate-limit, so every read and write falls back down this list.
const DEFAULT_RPCS =
  NETWORK === "mainnet"
    ? ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.drpc.org"]
    : ["https://near-testnet.drpc.org", "https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"];
export const RPCS = process.env.NEAR_RPC ? [process.env.NEAR_RPC, ...DEFAULT_RPCS] : DEFAULT_RPCS;
/** FastData KV: the raw store behind near.social. */
export const KV = NETWORK === "mainnet" ? "https://kv.main.fastnear.com" : "https://kv.test.fastnear.com";
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const TGAS = 1_000_000_000_000n;
export const NEAR = 10n ** 24n;
export const ONE = 10n ** 18n;

export function argv() {
  const positional = [];
  const flags = {};
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].startsWith("--")) {
      const key = raw[i].slice(2);
      const next = raw[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else flags[key] = raw[++i];
    } else positional.push(raw[i]);
  }
  return { positional, flags };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function rpc(method, params) {
  let lastError;
  for (const url of [...RPCS, RPCS[0]]) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "squawk", method, params }),
      });
      if (!response.ok) throw new Error(`RPC ${response.status} from ${url}`);
      const body = await response.json();
      // A real answer from the chain, such as an unknown account, is final. Only a transport
      // problem moves on to the next endpoint.
      if (body.error) {
        const error = new Error(body.error.data ?? body.error.message ?? JSON.stringify(body.error));
        error.final = body.error.name !== "REQUEST_VALIDATION_ERROR" && body.error.code !== -429;
        throw error;
      }
      if (body.result?.error) {
        const error = new Error(body.result.error);
        error.final = true;
        throw error;
      }
      return body.result;
    } catch (error) {
      lastError = error;
      if (error.final) throw error;
      await sleep(600);
    }
  }
  throw lastError;
}

export async function view(contract, method, args = {}) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString());
}

export const accountInfo = (id, finality = "final") => rpc("query", { request_type: "view_account", finality, account_id: id });

/** The chain's own clock: the timestamp of the latest block, in milliseconds. */
export async function chainTime() {
  const block = await rpc("block", { finality: "optimistic" });
  return Math.floor(Number(BigInt(block.header.timestamp) / 1_000_000n));
}

export async function accountExists(id) {
  try {
    await accountInfo(id);
    return true;
  } catch (error) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(error.message))) return false;
    throw error;
  }
}

export const accessKeys = async (id) =>
  (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: id })).keys;

export function keyFile(accountId) {
  return join(homedir(), ".near-credentials", NETWORK, `${accountId}.json`);
}

const secrets = new Map();

/**
 * The secret key in the keychain that matches one of the account's keys on chain. The NEAR CLI
 * keeps `<account>.json` plus one file per key in `<account>/`, and after a retried account
 * creation the main file can hold a key that never reached the chain. This looks at all of them,
 * as the CLI does, and only ever returns the key; nothing is printed.
 */
export async function secretKeyFor(accountId) {
  if (secrets.has(accountId)) return secrets.get(accountId);
  const dir = join(homedir(), ".near-credentials", NETWORK);
  const files = [join(dir, `${accountId}.json`)];
  const folder = join(dir, accountId);
  if (existsSync(folder)) files.push(...readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => join(folder, name)));
  const found = files
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")))
    .filter((key) => key.private_key && key.public_key);
  if (!found.length) throw new Error(`No key for ${accountId} in ${dir}. Create the account with the NEAR CLI first.`);
  let onChain = [];
  try {
    onChain = (await accessKeys(accountId)).map((key) => key.public_key);
  } catch {
    // An account created a moment ago may not be visible at final yet. Use the main file.
  }
  const match = found.find((key) => onChain.includes(key.public_key)) ?? found[0];
  secrets.set(accountId, match.private_key);
  return match.private_key;
}

/** An account that signs with `secret`, or with its key from the keychain. */
export async function signer(accountId, secret, rpcIndex = 0) {
  return new Account(accountId, new JsonRpcProvider({ url: RPCS[rpcIndex % RPCS.length] }), secret ?? (await secretKeyFor(accountId)));
}

/**
 * Signs and sends. A request an RPC turned away (rate-limited, or the connection never opened)
 * moves on to the next RPC. Anything else is thrown as it is, even a timeout: a transaction that
 * timed out may still land, and sending it again would bake or feed twice.
 */
export async function send(accountId, receiverId, actionList, { secret, throwOnFailure = true, waitUntil } = {}) {
  let lastError;
  for (let i = 0; i < RPCS.length + 1; i++) {
    try {
      return await (await signer(accountId, secret, i)).signAndSendTransaction({
        receiverId,
        actions: actionList,
        throwOnFailure,
        ...(waitUntil ? { waitUntil } : {}),
      });
    } catch (error) {
      lastError = error;
      if (!/rate limit|too many requests|-429|\b429\b|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(String(error.message ?? error))) throw error;
      await sleep(800);
    }
  }
  throw lastError;
}

/** Calls a method on a contract and returns the transaction outcome. */
export function call(accountId, contract, method, args = {}, { tgas = 60n, deposit = 0n, secret } = {}) {
  return send(accountId, contract, [actions.functionCall(method, args, BigInt(tgas) * TGAS, BigInt(deposit))], { secret });
}

/**
 * Calls a method and reports what happened instead of throwing, so a refused call still yields
 * its transaction hash and the contract's reason.
 */
export async function attempt(accountId, contract, method, args = {}, { tgas = 60n, deposit = 0n } = {}) {
  const outcome = await send(accountId, contract, [actions.functionCall(method, args, BigInt(tgas) * TGAS, BigInt(deposit))], {
    throwOnFailure: false,
  });
  const failure = outcome?.status?.Failure;
  const reason = failure ? JSON.stringify(failure) : null;
  return {
    hash: outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id,
    ok: !failure,
    value: failure ? undefined : returned(outcome),
    error: reason,
    /** The contract's own words when it refused: `SQUAWK[RULE] reason`, or the SDK's message. */
    said: reason ? (/Smart contract panicked: ([^"\\]+)/.exec(reason)?.[1] ?? reason).trim() : null,
    logs: logsOf(outcome),
    gas: gasOf(outcome),
  };
}

/** Gas burnt by a transaction and all its receipts, in TGas. */
export function gasOf(outcome) {
  const parts = [outcome?.transaction_outcome, ...(outcome?.receipts_outcome ?? [])];
  const total = parts.reduce((sum, part) => sum + BigInt(part?.outcome?.gas_burnt ?? 0), 0n);
  return Number(total / 10_000_000_000n) / 100;
}

/** The value a successful call returned, parsed from JSON. */
export function returned(outcome) {
  const value = outcome?.status?.SuccessValue;
  if (value === undefined || value === "") return undefined;
  return JSON.parse(Buffer.from(value, "base64").toString());
}

/** Every log line a transaction wrote, across all its receipts. */
export function logsOf(outcome) {
  return (outcome?.receipts_outcome ?? []).flatMap((r) => r.outcome.logs);
}

/**
 * Writes to near.social as `accountId`: one `__fastdata_kv` call. The receipt always fails,
 * because nothing runs at the receiving account. That is how near.social works.
 */
export async function socialWrite(accountId, kv, { social = "social", secret } = {}) {
  const outcome = await send(accountId, social, [actions.functionCall("__fastdata_kv", kv, 1n, 0n)], {
    secret,
    throwOnFailure: false,
    waitUntil: "INCLUDED_FINAL",
  });
  return outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id;
}

/** Latest FastData KV rows written to `current` by `predecessor`, following every page. */
export async function kvLatest(current, predecessor, body = {}, { pages = 50 } = {}) {
  const path = predecessor ? `${current}/${predecessor}` : current;
  const rows = [];
  let token;
  for (let page = 0; page < pages; page++) {
    const response = await fetch(`${KV}/v0/latest/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 200, ...body, ...(token ? { page_token: token } : {}) }),
    });
    if (!response.ok) throw new Error(`FastData KV ${response.status}`);
    const data = await response.json();
    rows.push(...(data.entries ?? []));
    token = data.page_token;
    if (!token || !(data.entries ?? []).length) break;
  }
  return rows;
}

/** Waits until FastData has indexed a key written by `predecessor`, then returns the row. */
export async function kvWait(current, predecessor, key, { tries = 30, since = 0 } = {}) {
  for (let i = 0; i < tries; i++) {
    const rows = await kvLatest(current, predecessor, { key }, { pages: 1 });
    const row = rows.find((r) => r.key === key && r.block_height >= since);
    if (row) return row;
    await sleep(1500);
  }
  return null;
}

/** yoctoNEAR as a plain decimal string with up to `digits` decimals. */
export function near(yocto, digits = 4) {
  const value = BigInt(yocto);
  const scale = 10n ** BigInt(24 - digits);
  const scaled = value / scale;
  const whole = scaled / 10n ** BigInt(digits);
  const fraction = (scaled % 10n ** BigInt(digits)).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** Base units as crackers, with up to two decimals. */
export function crackers(units) {
  const hundredths = (BigInt(units) * 100n) / ONE;
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** Whole crackers to base units. Accepts decimals such as "12.5". */
export function units(crackerCount) {
  const [whole, fraction = ""] = String(crackerCount).split(".");
  return BigInt(whole) * ONE + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}

/** NEAR to yocto. Accepts decimals such as "0.25". */
export function yocto(nearAmount) {
  const [whole, fraction = ""] = String(nearAmount).split(".");
  return BigInt(whole) * NEAR + BigInt((fraction + "0".repeat(24)).slice(0, 24));
}
