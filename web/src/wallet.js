import { NearConnector } from "@hot-labs/near-connect";
import { NETWORK, TGAS } from "./config.js";

const connector = new NearConnector({ network: NETWORK });
const listeners = new Set();
let signedIn = null;

function publish(accountId) {
  signedIn = accountId;
  for (const listener of listeners) listener(accountId);
}

connector.on("wallet:signIn", (event) => publish(event.accounts?.[0]?.accountId ?? null));
connector.on("wallet:signOut", () => publish(null));

export function onAccount(listener) {
  listeners.add(listener);
  listener(signedIn);
}

export const current = () => signedIn;

export async function restore() {
  try {
    const wallet = await connector.wallet();
    const accounts = await wallet.getAccounts();
    if (accounts.length) publish(accounts[0].accountId);
  } catch {
    // Nobody is signed in yet.
  }
}

export const connect = () => connector.connect();
export const disconnect = () => connector.disconnect();

/** Asks the wallet to sign one function call and send it. */
export async function send(contract, method, args, { tgas = 60, deposit = 0n, gas } = {}) {
  const wallet = await connector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: contract,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: method, args, gas: gas ?? (BigInt(tgas) * TGAS).toString(), deposit: deposit.toString() },
      },
    ],
  });
}

/**
 * Writes to near.social as the signed-in account. The call carries one unit of gas, because
 * nothing runs at the receiving account, and for the same reason it always ends in an error.
 * Only a refusal in the wallet counts as a failure here.
 */
export async function socialWrite(socialAccount, keys) {
  try {
    await send(socialAccount, "__fastdata_kv", keys, { gas: "1" });
  } catch (error) {
    if (/reject|cancel|denied|closed/i.test(String(error?.message ?? error))) throw error;
  }
}

/** The value a successful call returned, parsed from JSON. Undefined if there was none. */
export function returned(outcome) {
  const value = outcome?.status?.SuccessValue;
  if (value === undefined || value === "") return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

/** A wallet or contract error as one plain sentence. */
export function explain(error) {
  const text = String(error?.message ?? error ?? "");
  const rule = /SQUAWK\[[A-Z]+\] ([^"\\]+)/.exec(text);
  if (rule) return rule[1].trim();
  if (/reject|cancel|denied|closed/i.test(text)) return "You cancelled it in the wallet.";
  if (/enough balance|NotEnoughBalance|LackBalance/i.test(text)) return "Not enough balance for that.";
  if (/not registered/i.test(text)) return "Bake some crackers first.";
  return text.slice(0, 160) || "Something went wrong.";
}
