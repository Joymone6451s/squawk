// A stand-in for a wallet's signing step, used to press the page's real buttons while filming.
// It is not part of the product and the page never loads it. Testnet only, loopback only, one
// signer, and it signs nothing but function calls to the receivers named on the command line.
// The key stays in this process: the browser only ever sees transaction results.
//
//   node tools/video/wallet-server.mjs <signer> <receiver> [<receiver> ...]
import http from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, JsonRpcProvider, actions } from "near-api-js";

const [signer, ...receivers] = process.argv.slice(2);
if (!signer || !receivers.length) {
  console.error("usage: node wallet-server.mjs <signer> <receiver> [<receiver> ...]");
  process.exit(1);
}
const PAGE = process.env.PAGE_ORIGIN ?? "http://localhost:8766";
const PORT = Number(process.env.WALLET_PORT ?? 38767);
const secret = JSON.parse(readFileSync(join(homedir(), ".near-credentials", "testnet", `${signer}.json`), "utf8")).private_key;
const account = new Account(signer, new JsonRpcProvider({ url: process.env.WALLET_RPC ?? "https://near-testnet.drpc.org" }), secret);

// The reverse of what a wallet does with the connector's action format.
function toNearAction(action) {
  if (action.type !== "FunctionCall") throw new Error(`the stand-in wallet refuses ${action.type}`);
  const p = action.params;
  return actions.functionCall(p.methodName, p.args, BigInt(p.gas), BigInt(p.deposit));
}

const describe = (action) => `${action.params.methodName}(${JSON.stringify(action.params.args).slice(0, 120)}) gas=${action.params.gas} deposit=${action.params.deposit}`;

http
  .createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", PAGE);
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("content-type", "application/json");
    try {
      const body = JSON.parse(raw);
      if (body.network && body.network !== "testnet") throw new Error(`refused network ${body.network}`);
      if (body.signerId && body.signerId !== signer) throw new Error(`refused signer ${body.signerId}`);
      if (!receivers.includes(body.receiverId)) throw new Error(`refused receiver ${body.receiverId}`);
      console.log(`SIGN ${body.receiverId}: ${body.actions.map(describe).join(", ")}`);
      // A near.social write always ends in a failed receipt, because nothing runs at `social`.
      const social = body.actions.every((a) => a.params?.methodName?.startsWith("__fastdata_"));
      const outcome = await account.signAndSendTransaction({
        receiverId: body.receiverId,
        actions: body.actions.map(toNearAction),
        throwOnFailure: !social,
      });
      console.log(`  ok ${outcome.transaction?.hash}`);
      res.end(JSON.stringify(outcome));
    } catch (error) {
      console.log(`  refused or failed: ${String(error.message ?? error).slice(0, 300)}`);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error.message ?? error) }));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`stand-in wallet for ${signer} listening on 127.0.0.1:${PORT}`));
