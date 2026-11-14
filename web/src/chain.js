import { RPC_URLS } from "./config.js";

/** Reads go straight to a public RPC. The page has no backend. */
async function rpc(method, params) {
  let lastError;
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "squawk", method, params }),
      });
      if (!response.ok) throw new Error(`RPC ${response.status}`);
      const body = await response.json();
      // `data` says what went wrong, such as an unknown account. `message` is only "Server error".
      if (body.error) {
        const error = new Error(body.error.data ?? body.error.message ?? JSON.stringify(body.error));
        // An answer from the chain is final. Only a busy or broken endpoint moves on to the next.
        error.final = body.error.code !== -429 && !/rate|limit|timeout/i.test(error.message);
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
    }
  }
  throw lastError;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function view(contract, method, args = {}) {
  const result = await rpc("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: toBase64(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
}

export async function accessKeys(account) {
  const result = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: account });
  return result.keys;
}

export function account(accountId) {
  return rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
}

/** Reads a whole paged view, `page` rows at a time, starting at row `from`. */
export async function viewAll(contract, method, total, from = 0, page = 100) {
  const rows = [];
  for (let at = from; at < total; at += page) {
    rows.push(...(await view(contract, method, { from: at, limit: page })));
  }
  return rows;
}
