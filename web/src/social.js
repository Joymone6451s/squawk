// Reading near.social. On mainnet the page asks near.social's own indexer. On testnet there is no
// such indexer, so it reads the same data one level down, from FastData KV, and applies the
// social-kv/1 rules itself. Both paths return posts and profiles in one shape.
import { FASTFS, KV_URL, SOCIAL_API, SOCIAL_SITE } from "./config.js";

const POST_ID = /^[1-9][0-9]{0,15}$/;
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Splits "alice.near/1759140000000". Returns null unless it is a valid post reference. */
export function parseRef(text) {
  const clean = String(text ?? "").trim();
  // A near.social link works too: https://near.social/alice.near/post/1759140000000
  const link = clean.match(/near\.social\/([^/\s]+)\/post\/(\d+)/);
  const [account, id] = link ? [link[1], link[2]] : clean.split("/");
  if (!account || !id || clean.split("/").length > (link ? 99 : 2)) return null;
  if (account.length < 2 || account.length > 64 || !ACCOUNT_ID.test(account)) return null;
  if (!POST_ID.test(id) || BigInt(id) > 9007199254740991n) return null;
  return { account, id, key: `${account}/${id}` };
}

export const isAccountId = (text) => text.length >= 2 && text.length <= 64 && ACCOUNT_ID.test(text);

/** Where a post lives on near.social itself, when there is such a place. */
export function postUrl(key) {
  const ref = parseRef(key);
  return SOCIAL_SITE && ref ? `${SOCIAL_SITE}/${ref.account}/post/${ref.id}` : null;
}

export const profileUrl = (accountId) => (SOCIAL_SITE ? `${SOCIAL_SITE}/${accountId}` : null);

function mediaUrl(uri) {
  const match = /^fastfs:\/\/(.+)$/.exec(uri ?? "");
  return match ? `${FASTFS}/${match[1]}` : null;
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

// ----- FastData KV (testnet, and the fallback everywhere) -------------------------------------

const kvPost = (path, body) =>
  getJson(`${KV_URL}/v0/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A stored value is a post if it is an object with text, media or a quote. */
function validPost(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.text !== undefined && typeof value.text !== "string") return false;
  const hasText = typeof value.text === "string" && value.text.trim() !== "";
  const hasMedia = Array.isArray(value.media) && value.media.length > 0;
  const hasQuote = typeof value.quote === "string" && parseRef(value.quote);
  return hasText || hasMedia || Boolean(hasQuote);
}

function fromRow(row, names) {
  const id = row.key.slice("post/".length);
  const profile = names.get(row.predecessor_id) ?? {};
  return {
    key: `${row.predecessor_id}/${id}`,
    id,
    author: { account_id: row.predecessor_id, name: profile.name ?? null, avatar_url: profile.avatar_url ?? null },
    text: typeof row.value.text === "string" ? row.value.text : "",
    created_at: Math.floor(Number(row.block_timestamp) / 1e6),
    reply_to: typeof row.value.reply_to === "string" ? row.value.reply_to : null,
    quote: typeof row.value.quote === "string" && parseRef(row.value.quote) ? { key: row.value.quote } : null,
  };
}

const profiles = new Map();
async function kvProfile(social, accountId) {
  if (profiles.has(accountId)) return profiles.get(accountId);
  const loading = (async () => {
    const data = await kvPost(`latest/${social}/${accountId}`, { key_prefix: "profile/", limit: 50 });
    const field = (name) => {
      const value = data?.entries?.find((e) => e.key === `profile/${name}`)?.value;
      return typeof value === "string" && value !== "" ? value : null;
    };
    return { account_id: accountId, name: field("name"), about: field("about"), avatar_url: mediaUrl(field("avatar")) };
  })().catch(() => ({ account_id: accountId, name: null, about: null, avatar_url: null }));
  profiles.set(accountId, loading);
  return loading;
}

async function kvNames(social, accountIds) {
  const names = new Map();
  await Promise.all([...new Set(accountIds)].map(async (id) => names.set(id, await kvProfile(social, id))));
  return names;
}

async function kvRowsToPosts(social, rows) {
  // The same key can appear more than once in history. The first row seen is the newest.
  const seen = new Set();
  const kept = [];
  for (const row of rows) {
    const id = row.key.slice("post/".length);
    const slot = `${row.predecessor_id}/${id}`;
    if (!row.key.startsWith("post/") || !POST_ID.test(id) || seen.has(slot)) continue;
    seen.add(slot);
    if (validPost(row.value)) kept.push(row);
  }
  const names = await kvNames(social, kept.map((row) => row.predecessor_id));
  return kept.map((row) => fromRow(row, names));
}

// ----- one interface for both networks --------------------------------------------------------

/** The newest top-level posts by anyone. */
export async function latestPosts(social, limit = 24) {
  if (SOCIAL_API) {
    const data = await getJson(`${SOCIAL_API}/v1/feed/global?limit=${limit}`);
    return (data?.items ?? []).map((item) => item.post);
  }
  const data = await kvPost(`history/${social}`, { key_prefix: "post/", limit: Math.min(200, limit * 4) });
  const posts = await kvRowsToPosts(social, data?.entries ?? []);
  return posts.filter((post) => !post.reply_to).slice(0, limit);
}

/** The newest posts by one account. */
export async function postsBy(social, accountId, limit = 24) {
  if (SOCIAL_API) {
    const data = await getJson(`${SOCIAL_API}/v1/accounts/${accountId}/posts?limit=${limit}`);
    return (data?.items ?? []).filter((item) => item.type === "post").map((item) => item.post);
  }
  const data = await kvPost(`latest/${social}/${accountId}`, { key_prefix: "post/", limit: 200 });
  const rows = (data?.entries ?? []).sort((a, b) => Number(b.block_timestamp) - Number(a.block_timestamp));
  return (await kvRowsToPosts(social, rows)).slice(0, limit);
}

const posts = new Map();
/** One post by reference, or null if there is no such post. Answers are remembered. */
export function getPost(social, key) {
  if (posts.has(key)) return posts.get(key);
  const loading = (async () => {
    const ref = parseRef(key);
    if (!ref) return null;
    if (SOCIAL_API) {
      const data = await getJson(`${SOCIAL_API}/v1/posts/${ref.account}/${ref.id}`);
      return data?.post ?? null;
    }
    const data = await getJson(`${KV_URL}/v0/latest/${social}/${ref.account}/${encodeURIComponent(`post/${ref.id}`)}`);
    const row = data?.entries?.[0];
    if (!row || !validPost(row.value)) return null;
    return fromRow(row, await kvNames(social, [row.predecessor_id]));
  })().catch(() => {
    posts.delete(key);
    return null;
  });
  posts.set(key, loading);
  return loading;
}

/** Forgets a remembered post, so a post that was missing a moment ago is looked up again. */
export const forgetPost = (key) => posts.delete(key);

/** Name and picture for an account. Never fails: an unknown account is just its id. */
export async function getProfile(social, accountId) {
  if (SOCIAL_API) {
    if (profiles.has(accountId)) return profiles.get(accountId);
    const loading = getJson(`${SOCIAL_API}/v1/accounts/${accountId}`)
      .then((data) => ({ account_id: accountId, name: data?.name ?? null, about: data?.about ?? null, avatar_url: data?.avatar_url ?? null }))
      .catch(() => ({ account_id: accountId, name: null, about: null, avatar_url: null }));
    profiles.set(accountId, loading);
    return loading;
  }
  return kvProfile(social, accountId);
}
