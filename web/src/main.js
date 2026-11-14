import "./style.css";
import { accessKeys, view, viewAll } from "./chain.js";
import { COINS, EXPLORER, NEAR, NETWORK, ONE, REPO_URL, SOCIAL_SITE } from "./config.js";
import { ago, countdown, crackers, esc, near, parseCrackers, parseNear, percent, short, span } from "./format.js";
import { draw, setMood } from "./polly.js";
import * as social from "./social.js";
import * as wallet from "./wallet.js";

const $ = (id) => document.getElementById(id);
const BPS = 10_000n;
const LOG_PAGE = 10;
const REFRESH_MS = 5_000;

// ----- which coin -----------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const coin = params.get("coin") ?? COINS[0].id;

const state = {
  rules: null,
  status: null,
  /** Local clock minus chain clock, so the countdown follows block time. */
  skew: 0,
  account: null,
  balance: 0n,
  registered: false,
  pots: [],
  records: [],
  log: [],
  logPage: 0,
  tab: "latest",
  feed: [],
  keys: null,
  dialog: null,
  busy: false,
};

// ----- small pieces ---------------------------------------------------------------------------

let toastTimer;
function toast(message, kind = "ok", ms = 7000) {
  const box = $("toast");
  box.textContent = message;
  box.dataset.kind = kind;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), ms);
}

function notice(message) {
  $("notice").textContent = message ?? "";
  $("notice").hidden = !message;
}

const HUES = [152, 16, 212, 44, 286, 340, 190, 96];
function avatar(author) {
  if (author.avatar_url) return `<img class="avatar" src="${esc(author.avatar_url)}" alt="" loading="lazy" />`;
  let sum = 0;
  for (const ch of author.account_id) sum = (sum * 31 + ch.charCodeAt(0)) % 9973;
  const letter = (author.name ?? author.account_id)[0]?.toUpperCase() ?? "?";
  return `<span class="avatar" style="--hue:${HUES[sum % HUES.length]}" aria-hidden="true">${esc(letter)}</span>`;
}

function who(author) {
  const name = author.name ? `<strong>${esc(author.name)}</strong>` : `<strong>${esc(short(author.account_id, 24))}</strong>`;
  const handle = author.name ? `<span class="handle">${esc(short(author.account_id, 30))}</span>` : "";
  return `${name}${handle}`;
}

/** One near.social post as a card. `extra` goes in the footer, next to the Feed button. */
function postCard(post, { extra = "", compact = false, feedable = true } = {}) {
  const url = social.postUrl(post.key);
  const quote = post.quote?.text
    ? `<blockquote class="quote"><span>${esc(post.quote.author?.name ?? post.quote.author?.account_id ?? "")}</span> ${esc(post.quote.text)}</blockquote>`
    : "";
  return `
    <article class="post${compact ? " compact" : ""}" data-key="${esc(post.key)}">
      <header>${avatar(post.author)}<div class="by">${who(post.author)}</div>
        <time>${post.created_at ? esc(ago(post.created_at)) : ""}</time></header>
      <p class="text">${esc(post.text)}</p>${quote}
      ${compact ? "" : `<footer>${extra}<span class="grow"></span>
        ${url ? `<a class="quiet" href="${esc(url)}" target="_blank" rel="noopener">Open on near.social</a>` : ""}
        ${feedable ? `<button class="btn feed" type="button" data-feed="${esc(post.key)}">Feed</button>` : ""}</footer>`}
    </article>`;
}

const painted = new WeakMap();
/** Sets an element's HTML only when it changed, so nothing flickers between polls. */
function paint(element, html) {
  if (painted.get(element) === html) return;
  painted.set(element, html);
  element.innerHTML = html;
}

/** A post the contract knows by reference but near.social has no text for. */
function ghostPost(key) {
  const [account, id] = key.split("/");
  return { key, id, author: { account_id: account, name: null, avatar_url: null }, text: `Post ${id}. Its text isn't on near.social right now.`, created_at: null, quote: null };
}

// ----- the stage: Polly and the round ---------------------------------------------------------

function chainNow() {
  return Date.now() - state.skew;
}

function renderStage() {
  const s = state.status;
  const r = state.rules;
  if (!s || !r) return;
  const fed = BigInt(s.fed);
  const target = BigInt(s.target);
  const full = fed >= target;

  $("round-title").textContent = `Round ${Number(s.round) + 1}`;
  $("fed").textContent = crackers(fed);
  $("target").textContent = crackers(target);
  $("bar").style.width = `${Math.min(100, Number((fed * 1000n) / target) / 10)}%`;
  $("bar").dataset.full = String(full);
  $("streak").textContent = s.streak;
  $("best").textContent = s.best_streak;
  $("cut").textContent = `${percent(s.cut_bps)} of each tip`;
  $("weight").textContent = `${percent(s.weight_bps)}`;
  $("squawk-count").textContent = s.squawks;

  let mood = "hungry";
  let label = "Hungry";
  let speech;
  if (s.asleep && s.waiting_squawk) {
    [mood, label] = ["asleep", "Asleep"];
    speech = `Zzz... Round ${Number(s.waiting_round) + 1} is over and I have a post to squawk. Somebody wake me!`;
  } else if (fed === 0n) {
    speech = s.asleep ? "A new round. Nobody has fed me yet. Feed any post and I'm awake!" : "I'm hungry! Nobody has fed me this round.";
  } else if (!full) {
    speech = `${crackers(target - fed)} more crackers and I squawk this round.`;
  } else {
    [mood, label] = ["fed", "Full"];
    speech = "I'm full! When this round ends I squawk the heaviest pile.";
  }
  if (state.squawking) [mood, label, speech] = ["squawk", "Squawking", "SQUAWK! I just posted the winner on near.social, all by myself."];
  setMood($("polly"), mood);
  $("mood").textContent = label;
  $("mood").dataset.mood = mood;
  $("speech").textContent = speech;

  $("meter-note").textContent = full
    ? "Target reached. Polly squawks the heaviest pile when the round ends."
    : fed === 0n
      ? `The flock needs to feed ${crackers(target)} crackers this round for a squawk.`
      : `Polly squawks only if the flock reaches the target before the round ends.`;

  const wake = $("wake");
  wake.hidden = !(s.asleep && s.waiting_squawk);
  if (!wake.hidden) {
    $("wake-text").textContent = `Round ${Number(s.waiting_round) + 1} reached its target. Wake Polly and the contract pays you up to ${near(r.wake_bounty)} NEAR.`;
  }
  tick();
}

function tick() {
  const s = state.status;
  if (!s) return;
  const left = Number(s.round_ends_ms) - chainNow();
  $("clock").textContent = countdown(left);
  // The moment a round ends, ask the chain what happened instead of waiting for the next poll.
  if (left <= 0 && !state.rolling) {
    state.rolling = true;
    setTimeout(() => refresh().finally(() => (state.rolling = false)), 1500);
  }
}

// ----- this round's piles ---------------------------------------------------------------------

async function renderPiles() {
  const list = $("pile-list");
  const pots = [...state.pots].sort((a, b) => (BigInt(b.weight) > BigInt(a.weight) ? 1 : BigInt(b.weight) < BigInt(a.weight) ? -1 : 0));
  $("pile-empty").hidden = pots.length > 0;
  const top = state.status?.top;
  const cards = await Promise.all(
    pots.map(async (pot) => {
      const post = (await social.getPost(state.rules.social, pot.post)) ?? ghostPost(pot.post);
      const lead = pot.post === top ? `<span class="lead">In the lead</span>` : "";
      const rally = state.account
        ? `<button class="btn small ghost" type="button" data-rally="${esc(pot.post)}" title="Post about it on near.social">Rally the flock</button>`
        : "";
      const extra = `<span class="pile"><strong>${crackers(pot.fed)}</strong> crackers</span>
        <span class="pile-sub">weighs ${crackers(pot.weight)}, ${near(pot.tipped)} NEAR sent to the writer, ${pot.feeds} feed${pot.feeds === 1 ? "" : "s"}</span>${rally}`;
      return `<li class="${pot.post === top ? "leading" : ""}">${lead}${postCard(post, { extra })}</li>`;
    }),
  );
  paint(list, cards.join(""));
}

// ----- your crackers --------------------------------------------------------------------------

function renderPurse() {
  const signedIn = Boolean(state.account);
  $("wallet").textContent = signedIn ? short(state.account, 22) : "Connect wallet";
  $("wallet").title = signedIn ? "Click to disconnect" : "";
  $("purse-sub").textContent = signedIn ? `Signed in as ${short(state.account, 34)}` : "Connect a wallet to bake and feed.";
  $("balance").textContent = crackers(state.balance);
  $("my-stats").hidden = !signedIn;
  bakeHint();
}

function bakeHint() {
  if (!state.rules) return;
  const yocto = parseNear($("bake-near").value);
  const price = BigInt(state.rules.yocto_per_unit);
  const perNear = NEAR / price / ONE;
  if (yocto === null || yocto === 0n) {
    $("bake-hint").textContent = `1 NEAR always bakes ${perNear.toLocaleString("en-US")} crackers. The price never changes.`;
    return;
  }
  // A first bake also pays the one-off 0.00125 NEAR to register, and every bake pays for its log line.
  const fee = (state.registered ? 0n : NEAR / 800n) + NEAR / 600n;
  const units = yocto > fee ? (yocto - fee) / price : 0n;
  $("bake-hint").textContent = `About ${crackers(units)} crackers. 1 NEAR always bakes ${perNear.toLocaleString("en-US")}. All of it waits in the nest until you feed.`;
}

async function loadAccount() {
  if (!state.account) {
    [state.balance, state.registered] = [0n, false];
    renderPurse();
    return;
  }
  try {
    const [balance, storage, patron, writer] = await Promise.all([
      view(coin, "ft_balance_of", { account_id: state.account }),
      view(coin, "storage_balance_of", { account_id: state.account }),
      view(coin, "patron", { account_id: state.account }),
      view(coin, "writer", { account_id: state.account }),
    ]);
    state.balance = BigInt(balance);
    state.registered = storage !== null;
    $("my-given").textContent = `${near(patron.given)} NEAR`;
    $("my-earned").textContent = `${near(writer.tipped)} NEAR`;
  } catch {
    // The next poll tries again.
  }
  renderPurse();
}

// ----- find a post to feed --------------------------------------------------------------------

async function loadFeed() {
  const list = $("feed-list");
  const empty = $("feed-empty");
  const socialId = state.rules.social;
  const query = $("find-input").value.trim();
  $("find-form").hidden = state.tab === "latest";
  const example = NETWORK === "mainnet" ? "alice.near" : "alice.testnet";
  $("find-input").placeholder = state.tab === "account" ? example : `${example}/1759140000000${SOCIAL_SITE ? " or a near.social link" : ""}`;
  empty.hidden = true;
  list.setAttribute("aria-busy", "true");
  try {
    let posts = [];
    if (state.tab === "latest") posts = await social.latestPosts(socialId, 12);
    else if (state.tab === "account") {
      if (!query) posts = [];
      else if (!social.isAccountId(query)) throw new Error("That is not a NEAR account name.");
      else posts = await social.postsBy(socialId, query, 12);
    } else if (query) {
      const ref = social.parseRef(query);
      if (!ref) throw new Error("A post looks like alice.near/1759140000000.");
      social.forgetPost(ref.key);
      posts = [(await social.getPost(socialId, ref.key)) ?? ghostPost(ref.key)];
    }
    state.feed = posts;
    list.innerHTML = posts.map((post) => postCard(post)).join("");
    if (!posts.length) {
      empty.textContent = state.tab === "latest" ? "No posts yet." : query ? "Nothing found." : state.tab === "account" ? "Type an account to see its posts." : "Paste a post to feed it.";
      empty.hidden = false;
    }
  } catch (error) {
    list.innerHTML = "";
    empty.textContent = String(error.message ?? error);
    empty.hidden = false;
  }
  list.removeAttribute("aria-busy");
}

// ----- what Polly said ------------------------------------------------------------------------

async function renderSaid() {
  const records = [...state.records].reverse().slice(0, 12);
  $("said-empty").hidden = records.length > 0;
  const socialId = state.rules.social;
  let waiting = false;
  const rows = await Promise.all(
    records.map(async (record) => {
      const winner = (await social.getPost(socialId, record.top)) ?? ghostPost(record.top);
      const round = Number(record.round) + 1;
      if (!record.squawked) {
        return `<li><p class="said-head"><span class="badge no">Quiet</span> Round ${round}: ${crackers(record.fed)} crackers, short of the target</p>
          ${postCard(winner, { feedable: false, extra: `<span class="pile-sub">The best-fed post, with ${crackers(record.pile)} crackers</span>` })}
          <p class="said-tail">No squawk, and the streak went back to 0.</p></li>`;
      }
      // Polly's own post, read back from near.social's data. The contract wrote it.
      const key = `${coin}/${record.polly_post}`;
      const hers = await social.getPost(socialId, key);
      if (!hers) {
        waiting = true;
        social.forgetPost(key);
      }
      const url = social.postUrl(key);
      const quoted = `<blockquote class="quote"><span>${esc(winner.author.name ?? short(winner.author.account_id, 26))}</span> ${esc(winner.text)}</blockquote>`;
      const said = hers
        ? `<article class="post polly-post"><header><span class="avatar polly-face" aria-hidden="true"></span><div class="by">${who(hers.author)}</div><time>${esc(ago(hers.created_at))}</time></header>
            <p class="text">${esc(hers.text)}</p>${quoted}
            ${url ? `<footer><span class="grow"></span><a class="quiet" href="${esc(url)}" target="_blank" rel="noopener">Open on near.social</a></footer>` : ""}</article>`
        : `<article class="post polly-post"><p class="text">Polly's post is on its way to near.social...</p>${quoted}</article>`;
      const bounty = BigInt(record.bounty) > 0n ? ` and earned ${near(record.bounty)} NEAR` : "";
      return `<li><p class="said-head"><span class="badge yes">Squawked</span> Round ${round}: the flock fed ${crackers(record.fed)} crackers</p>
        ${said}
        <p class="said-tail">The contract posted this itself. The winning pile was ${crackers(record.pile)} crackers, and ${near(record.tipped)} NEAR was sent to its writer. ${esc(short(record.woken_by, 26))} woke Polly${bounty}. Streak ${record.streak}.</p></li>`;
    }),
  );
  paint($("squawk-list"), rows.join(""));
  // near.social's data trails the chain by a few seconds, so look again for a post still missing.
  if (waiting) setTimeout(renderSaid, 4000);
}

// ----- the books, the log and the boards ------------------------------------------------------

function renderBooks() {
  const s = state.status;
  const r = state.rules;
  if (!s || !r) return;
  const price = BigInt(r.yocto_per_unit);
  const tiles = [
    ["Crackers in circulation", crackers(s.supply), "baked and not yet fed"],
    ["The nest", `${near(s.nest)} NEAR`, "held for those crackers"],
    ["Sent to writers", `${near(s.tipped)} NEAR`, "paid out the moment a post was fed"],
    ["Polly's hoard", `${near(s.hoard)} NEAR`, "her cut: pays her storage and wake-ups"],
    ["Baked so far", crackers(s.baked), "every cracker ever minted"],
    ["Eaten so far", crackers(s.eaten), "every cracker ever burned"],
  ];
  $("books").innerHTML = tiles.map(([k, v, note]) => `<div><dt>${k}</dt><dd>${v}</dd><p>${note}</p></div>`).join("");

  const ok = (pass, text) => `<li data-ok="${pass}">${text}</li>`;
  const balance = BigInt(s.balance);
  const checks = [
    ok(BigInt(s.supply) === BigInt(s.baked) - BigInt(s.eaten), "Crackers in circulation = baked minus eaten"),
    ok(BigInt(s.nest) === BigInt(s.supply) * price, `The nest holds exactly ${near(price * ONE)} NEAR for every cracker`),
    ok(BigInt(s.tipped) + BigInt(s.cut) === BigInt(s.eaten) * price, "The NEAR in every eaten cracker went to a writer or to the hoard"),
    ok(balance >= BigInt(s.nest) + BigInt(s.storage) + BigInt(s.deposits), "The contract holds enough NEAR for the nest, its own storage and the deposits it keeps for holders"),
  ];
  if (state.keys !== null) checks.push(ok(state.keys === 0, state.keys === 0 ? "The contract has no access keys, so nobody can change it" : `The contract still has ${state.keys} access key(s)`));
  $("checks").innerHTML = checks.join("");
}

function renderLog() {
  const total = state.log.length;
  const pages = Math.max(1, Math.ceil(total / LOG_PAGE));
  state.logPage = Math.min(state.logPage, pages - 1);
  const end = total - state.logPage * LOG_PAGE;
  const rows = state.log.slice(Math.max(0, end - LOG_PAGE), end).reverse();
  $("log-rows").innerHTML = rows.length
    ? rows
        .map((e) => {
          const bake = e.kind === "Bake";
          const post = e.post ? `<span title="${esc(e.post)}">${esc(short(e.post.split("/")[0], 20))}</span>` : "";
          return `<tr>
            <td>${esc(ago(e.ms, chainNow()))}</td>
            <td><span class="badge ${bake ? "mint" : "burn"}">${bake ? "Baked" : "Fed"}</span></td>
            <td>${esc(short(e.account, 24))}</td>
            <td>${post}</td>
            <td class="num">${bake ? "+" : "-"}${crackers(e.units)}</td>
            <td class="num" title="${bake ? "into the nest" : `to the writer, and ${near(e.cut)} NEAR to Polly`}">${near(e.near)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" class="empty">Nothing has been baked yet.</td></tr>`;
  $("log-page").textContent = total ? `${Math.max(1, end - LOG_PAGE + 1)} to ${end} of ${total}` : "";
  $("log-newer").disabled = state.logPage === 0;
  $("log-older").disabled = state.logPage >= pages - 1;
}

async function renderBoards() {
  const writers = new Map();
  const patrons = new Map();
  for (const e of state.log) {
    if (e.kind !== "Feed") continue;
    const writer = e.post.split("/")[0];
    const w = writers.get(writer) ?? { near: 0n, units: 0n };
    w.near += BigInt(e.near);
    w.units += BigInt(e.units);
    writers.set(writer, w);
    const p = patrons.get(e.account) ?? { near: 0n, units: 0n };
    p.near += BigInt(e.near);
    p.units += BigInt(e.units);
    patrons.set(e.account, p);
  }
  const top = (map) => [...map.entries()].sort((a, b) => (b[1].near > a[1].near ? 1 : b[1].near < a[1].near ? -1 : 0)).slice(0, 8);
  const board = async (entries, line) => {
    if (!entries.length) return `<li class="empty">Nobody yet.</li>`;
    const rows = await Promise.all(
      entries.map(async ([accountId, totals], i) => {
        const profile = await social.getProfile(state.rules.social, accountId);
        const url = social.profileUrl(accountId);
        const name = url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${who(profile)}</a>` : who(profile);
        const follow = state.account && state.account !== accountId ? `<button class="btn small ghost" type="button" data-follow="${esc(accountId)}">Follow</button>` : "";
        return `<li><span class="rank">${i + 1}</span>${avatar(profile)}<div class="by">${name}</div><span class="grow"></span><span class="score">${line(totals)}</span>${follow}</li>`;
      }),
    );
    return rows.join("");
  };
  const [w, p] = await Promise.all([
    board(top(writers), (t) => `<strong>${near(t.near)}</strong> NEAR`),
    board(top(patrons), (t) => `<strong>${near(t.near)}</strong> NEAR given`),
  ]);
  $("writers").innerHTML = w;
  $("patrons").innerHTML = p;
}

function renderRules() {
  const r = state.rules;
  const price = BigInt(r.yocto_per_unit);
  const roundMs = Number(r.round_ms);
  const rows = [
    ["A round lasts", span(roundMs) + (roundMs === 86_400_000 ? ", ending at midnight UTC" : "")],
    ["Baking price", `${near(price * ONE)} NEAR a cracker, for ever`],
    ["Target", `${crackers(r.target)} crackers fed in a round for Polly to squawk`],
    ["Polly's cut", `${percent(r.cut_max_bps)} of a tip, ${percent(r.cut_step_bps)} less for each round of streak, never under ${percent(r.cut_min_bps)}`],
    ["Late crackers", `A cracker fed at the very end of a round counts ${percent(r.late_weight_bps)} of one fed at the start`],
    ["Wake-up bounty", `Up to ${near(r.wake_bounty)} NEAR from the hoard to whoever wakes Polly for a squawk`],
    ["Smallest feed", `${crackers(r.min_feed)} cracker, and enough for Polly's cut to pay for the feed's own storage`],
    ["Where Polly posts", `the near.social account "${esc(r.social)}"`],
  ];
  $("rules").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
  $("find-sub").textContent = SOCIAL_SITE
    ? "Any post on near.social can be fed. The writer is paid the moment you feed."
    : "Posts written to near.social's testnet data. The writer is paid the moment you feed.";
}

function renderKeys() {
  if (state.keys === null) return;
  $("keys").innerHTML =
    state.keys === 0
      ? `<strong>No keys.</strong> The account <a href="${EXPLORER}/address/${esc(coin)}" target="_blank" rel="noopener">${esc(coin)}</a> has no access keys. It can only do what its code says.`
      : `<strong>Not locked.</strong> ${esc(coin)} still has ${state.keys} access key(s).`;
}

// ----- reading the chain ----------------------------------------------------------------------

async function refresh() {
  let status;
  try {
    status = await view(coin, "status");
  } catch (error) {
    notice(`Could not read ${coin}: ${String(error.message ?? error).slice(0, 140)}`);
    return;
  }
  notice(null);
  const before = state.status;
  state.status = status;
  state.skew = Date.now() - Number(status.now_ms);
  renderStage();
  renderBooks();

  const jobs = [];
  if (!before || before.round !== status.round || before.fed !== status.fed || before.posts !== status.posts || before.top !== status.top) {
    jobs.push(
      view(coin, "posts", { round: status.round }).then((pots) => {
        state.pots = pots;
        return renderPiles();
      }),
    );
  }
  if (state.records.length < status.records_len) {
    jobs.push(
      viewAll(coin, "records", status.records_len, state.records.length).then((rows) => {
        state.records.push(...rows);
        return renderSaid();
      }),
    );
  }
  if (state.log.length < status.log_len) {
    jobs.push(
      viewAll(coin, "log", status.log_len, state.log.length).then((rows) => {
        state.log.push(...rows);
        renderLog();
        return renderBoards();
      }),
    );
  }
  if (state.account && (!before || before.log_len !== status.log_len)) jobs.push(loadAccount());
  await Promise.allSettled(jobs);
}

// ----- acting ---------------------------------------------------------------------------------

async function act(button, label, run) {
  if (state.busy) return;
  state.busy = true;
  const idle = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await run();
  } catch (error) {
    toast(wallet.explain(error), "bad");
  } finally {
    state.busy = false;
    button.disabled = false;
    button.textContent = idle;
    await refresh();
    await loadAccount();
  }
}

async function needWallet() {
  if (state.account) return true;
  await wallet.connect();
  return false;
}

async function bake(event) {
  event.preventDefault();
  if (!(await needWallet())) return;
  const yocto = parseNear($("bake-near").value);
  if (yocto === null || yocto === 0n) return toast("Type how much NEAR to bake with.", "bad");
  await act($("bake"), "Baking...", async () => {
    const outcome = await wallet.send(coin, "bake", {}, { tgas: 60, deposit: yocto });
    const units = wallet.returned(outcome);
    toast(units ? `Baked ${crackers(units)} crackers. Now feed a post!` : "Baked. Now feed a post!");
  });
}

async function wake() {
  if (!(await needWallet())) return;
  const squawks = Number(state.status.squawks);
  await act($("wake-btn"), "Waking Polly...", async () => {
    await wallet.send(coin, "squawk", {}, { tgas: 60 });
    await refresh();
    // The contract's own record says who woke Polly and what it paid them.
    const record = state.records.at(-1);
    const earned = record?.squawked && record.woken_by === state.account ? BigInt(record.bounty) : 0n;
    if (Number(state.status.squawks) > squawks) {
      state.squawking = true;
      renderStage();
      setTimeout(() => {
        state.squawking = false;
        renderStage();
      }, 9000);
      toast(earned > 0n ? `Polly squawked! The contract paid you ${near(earned)} NEAR for waking her.` : "Polly squawked!");
    } else toast("Polly is awake.");
  });
}

// The feed dialog.

async function openFeed(key) {
  if (!(await needWallet())) return;
  const post = state.feed.find((p) => p.key === key) ?? (await social.getPost(state.rules.social, key)) ?? ghostPost(key);
  state.dialog = { post, floor: BigInt(state.rules.min_feed) };
  $("feed-post").innerHTML = postCard(post, { compact: true });
  $("feed-error").hidden = true;
  const quick = [10, 25, 50, 100, 250];
  $("feed-chips").innerHTML = quick.map((n) => `<button class="chip" type="button" data-amount="${n}">${n}</button>`).join("");
  $("feed-dialog").showModal();
  feedMath();
  try {
    const floor = BigInt(await view(coin, "feed_floor", { account_id: state.account, post: key }));
    if (state.dialog?.post.key !== key) return;
    state.dialog.floor = floor;
    // Start at a round number that the contract will accept.
    const current = parseCrackers($("feed-amount").value) ?? 0n;
    if (current < floor) $("feed-amount").value = String(Math.ceil(Number(floor) / 1e18 / 5) * 5);
    feedMath();
  } catch {
    // Without a floor the contract itself still refuses a feed that is too small.
  }
}

function feedMath() {
  const d = state.dialog;
  const s = state.status;
  if (!d || !s) return;
  const units = parseCrackers($("feed-amount").value);
  const error = $("feed-error");
  const go = $("feed-go");
  const lines = [];
  let problem = null;
  if (units === null || units === 0n) problem = "Type how many crackers to feed.";
  else {
    const value = units * BigInt(state.rules.yocto_per_unit);
    const cut = (value * BigInt(s.cut_bps)) / BPS;
    const weight = (units * BigInt(s.weight_bps)) / BPS;
    const writer = d.post.author.name ?? short(d.post.author.account_id, 26);
    lines.push(`<li><strong>${near(value - cut)} NEAR</strong> is sent to ${esc(writer)} right away</li>`);
    lines.push(`<li><strong>${near(cut)} NEAR</strong> is Polly's cut (${percent(s.cut_bps)})</li>`);
    lines.push(`<li>Adds <strong>${crackers(weight)}</strong> to this post's pile${Number(s.weight_bps) < 10_000 ? ` (crackers fed now count ${percent(s.weight_bps)})` : ""}</li>`);
    if (units < d.floor) problem = `The smallest feed for this post right now is ${crackers(d.floor)} crackers.`;
    else if (units > state.balance) problem = `You have ${crackers(state.balance)} crackers. Bake more first.`;
  }
  $("feed-math").innerHTML = lines.join("");
  error.textContent = problem ?? "";
  error.hidden = !problem;
  go.disabled = Boolean(problem);
}

async function feed(event) {
  event.preventDefault();
  const d = state.dialog;
  const units = parseCrackers($("feed-amount").value);
  if (!d || units === null) return;
  await act($("feed-go"), "Feeding...", async () => {
    const outcome = await wallet.send(coin, "feed", { post: d.post.key, amount: units.toString() }, { tgas: 80 });
    const fed = wallet.returned(outcome);
    const writer = d.post.author.name ?? short(d.post.author.account_id, 26);
    $("feed-dialog").close();
    toast(fed ? `Fed! ${near(fed.paid)} NEAR was just sent to ${writer}.${fed.top ? " This post is now in the lead." : ""}` : "Fed!");
  });
}

/** Posts on near.social, as the user, quoting a post and asking the flock to feed it. */
async function rally(key, button) {
  if (!(await needWallet())) return;
  button.disabled = true;
  try {
    const text = "I fed Polly for this post. Help it win the next squawk! #squawk";
    await wallet.socialWrite(state.rules.social, { [`post/${Date.now()}`]: { text, quote: key } });
    button.textContent = "Posted";
    toast("Posted on near.social, from your account.");
  } catch (error) {
    button.disabled = false;
    toast(wallet.explain(error), "bad");
  }
}

/** Follows an account on near.social: a write to the `social` account, signed by the user. */
async function follow(accountId, button) {
  if (!(await needWallet())) return;
  button.disabled = true;
  try {
    await wallet.socialWrite(state.rules.social, { [`graph/follow/${accountId}`]: {} });
    button.textContent = "Following";
    toast(`You now follow ${short(accountId, 26)} on near.social.`);
  } catch (error) {
    button.disabled = false;
    toast(wallet.explain(error), "bad");
  }
}

// ----- start ----------------------------------------------------------------------------------

function wire() {
  draw($("polly"));
  $("net").textContent = NETWORK;
  $("coin-id").innerHTML = `<a href="${EXPLORER}/address/${esc(coin)}" target="_blank" rel="noopener">${esc(coin)}</a>`;
  $("coin-switch").innerHTML = COINS.map(
    (c) => `<a class="switch-item" href="?coin=${encodeURIComponent(c.id)}" aria-current="${c.id === coin}" title="${esc(c.note)}">${esc(c.label)}</a>`,
  ).join("");
  $("links").innerHTML = [
    `<a href="${EXPLORER}/address/${esc(coin)}" target="_blank" rel="noopener">Contract on the explorer</a>`,
    REPO_URL ? `<a href="${esc(REPO_URL)}" target="_blank" rel="noopener">Source code</a>` : "",
    `<a href="./skill.md" target="_blank" rel="noopener">Guide for AI agents</a>`,
  ]
    .filter(Boolean)
    .join(" · ");

  $("wallet").addEventListener("click", () => (state.account ? wallet.disconnect() : wallet.connect()));
  $("bake-form").addEventListener("submit", bake);
  $("bake-near").addEventListener("input", bakeHint);
  $("wake-btn").addEventListener("click", wake);
  $("feed-form").addEventListener("submit", feed);
  $("feed-amount").addEventListener("input", feedMath);
  $("feed-cancel").addEventListener("click", () => $("feed-dialog").close());
  $("feed-dialog").addEventListener("close", () => (state.dialog = null));
  $("feed-chips").addEventListener("click", (event) => {
    const amount = event.target.closest("[data-amount]")?.dataset.amount;
    if (!amount) return;
    $("feed-amount").value = amount;
    feedMath();
  });
  $("find-form").addEventListener("submit", (event) => {
    event.preventDefault();
    loadFeed();
  });
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      for (const other of document.querySelectorAll(".tab")) other.setAttribute("aria-selected", String(other === tab));
      $("find-input").value = "";
      loadFeed();
    });
  }
  document.addEventListener("click", (event) => {
    const feedKey = event.target.closest("[data-feed]")?.dataset.feed;
    if (feedKey) return void openFeed(feedKey);
    const followButton = event.target.closest("[data-follow]");
    if (followButton) return void follow(followButton.dataset.follow, followButton);
    const rallyButton = event.target.closest("[data-rally]");
    if (rallyButton) return void rally(rallyButton.dataset.rally, rallyButton);
  });
  $("log-newer").addEventListener("click", () => {
    state.logPage = Math.max(0, state.logPage - 1);
    renderLog();
  });
  $("log-older").addEventListener("click", () => {
    state.logPage += 1;
    renderLog();
  });

  wallet.onAccount((accountId) => {
    state.account = accountId;
    renderPurse();
    if (state.rules) renderPiles();
    loadAccount().then(() => state.rules && renderBoards());
  });
}

async function start() {
  wire();
  try {
    state.rules = await view(coin, "rules");
  } catch (error) {
    notice(`${coin} is not a SQUAWK coin this page can read: ${String(error.message ?? error).slice(0, 140)}`);
    return;
  }
  renderRules();
  renderPurse();
  renderLog();
  renderBoards();
  await refresh();
  loadFeed();
  accessKeys(coin)
    .then((keys) => {
      state.keys = keys.length;
      renderKeys();
      renderBooks();
    })
    .catch(() => {});
  wallet.restore();
  setInterval(refresh, REFRESH_MS);
  setInterval(tick, 1000);
}

start();
