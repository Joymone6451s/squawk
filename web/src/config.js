// Addresses of the live deployment. Change them here after a new launch.
export const NETWORK = "testnet";

/** The coins this page knows. `?coin=<account>` points it at any other SQUAWK contract. */
export const COINS = [
  { id: "coin.squawk-hq.testnet", label: "Daily", note: "one round a day" },
  { id: "fast.squawk-hq.testnet", label: "Speedrun", note: "a round every five minutes" },
];

const MAINNET = NETWORK === "mainnet";
// Public RPCs rate-limit, so reads fall back down this list.
export const RPC_URLS = MAINNET
  ? ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.drpc.org"]
  : ["https://near-testnet.drpc.org", "https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"];
export const EXPLORER = MAINNET ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
/** FastData KV, the raw store behind near.social. It exists for both networks. */
export const KV_URL = MAINNET ? "https://kv.main.fastnear.com" : "https://kv.test.fastnear.com";
/** near.social's own indexer and site follow mainnet only. On testnet the page reads FastData. */
export const SOCIAL_API = MAINNET ? "https://api2.near.social" : null;
export const SOCIAL_SITE = MAINNET ? "https://near.social" : null;
export const FASTFS = "https://main.fastfs.io";
export const REPO_URL = "https://github.com/Joymone6451s/squawk";

export const TGAS = 1_000_000_000_000n;
export const NEAR = 10n ** 24n;
export const ONE = 10n ** 18n;
export const STORAGE_PRICE_PER_BYTE = 10n ** 19n;
