# SQUAWK

**A memecoin whose smart contract is a near.social account with no keys.** People burn the coin on
posts they like. The writer is paid in NEAR at once, and each round the contract itself quotes the
best-fed post on near.social.

NEAR HACKATHON entry, track `memecoins` (Memecoins With Mechanics).

**Demo video:** [media/squawk-demo.mp4](media/squawk-demo.mp4), 1 min 54 s. Every click in it is a
real transaction on the live testnet coin: bake, feed a post, the round reaching its target,
someone waking Polly, and her post on near.social written by the contract.

**Live page:** https://joymone6451s.github.io/squawk/ (NEAR testnet). It reads the chain directly,
with no backend.

## What it is

Polly is a parrot. Her account on near.social is this contract, and the account has no access
keys, so nobody can post as her: not the team, not a server, not a bot with a password. What she
says is decided by five rules in the contract.

1. **Bake.** Anyone sends NEAR and gets crackers (the token, `SQUAWK`, NEP-141) at a fixed price:
   0.001 NEAR each, for ever. The NEAR waits in the contract ("the nest"). The nest always holds
   exactly `supply x 0.001 NEAR`.
2. **Feed.** Anyone burns crackers on a near.social post, written `account/post_id`. The NEAR
   that was baked into those crackers leaves the nest in the same call: 75% to 90% goes to the
   post's writer by a plain transfer, and the rest is Polly's cut.
3. **Squawk.** A round lasts a day. If the flock fed at least 500 crackers in the round, the
   first call to the contract after the round ends makes it send a receipt to near.social's
   account `social` that quotes the best-fed post, likes it and follows its writer. Anyone can
   make that call, and the contract pays them a small bounty for it. "Best-fed" means the
   heaviest pile: a cracker fed at the start of a round counts in full, and one fed at the very
   end counts a quarter.
4. **Streak.** Each round that reaches the target makes the streak one longer and Polly's cut one
   point smaller (25% down to 10%). A round that misses resets both.
5. **Hoard.** Polly's cut stays in the contract. It pays for the contract's storage and a small
   bounty to whoever wakes Polly after a round. The bounty is paid out of what that round added
   to the hoard and can't be more. Nothing else can leave it.

There is no owner, no setter, no pause and no upgrade. Every parameter is written once at launch
and can be read with the `rules` view.

## The problem

- A memecoin's "community" lives on someone's social account. Whoever holds that password speaks
  for the coin, and can sell it, lose it or go quiet.
- Tipping a writer on a social network usually needs the writer to sign up for something first.
- near.social is new and small. Good posts are hard to find and nobody is paid for writing them.

SQUAWK's answer to all three is one mechanic. The coin's voice is a contract, so it can't be
taken over. Feeding a post pays its writer, who needs nothing but a NEAR account. And the flock's
daily pick is delivered inside near.social itself: follow Polly and the best-fed post of each day
shows up in your feed, written by a contract.

## How NEAR makes this possible

- **near.social writes are receipts.** near.social stores posts as `__fastdata_kv` function calls
  to the account `social`, and an indexer reads them off the chain. The author is the predecessor
  of the receipt. A receipt sent by a contract is indexed like one sent by a wallet, so a contract
  can be a near.social account. The receipt always fails, by design: with `CodeDoesNotExist` on
  mainnet, and with `AccountDoesNotExist` on testnet, where `social` doesn't exist. The indexer
  reads it either way, so the contract sends it detached and never waits on it.
- **An account can have no keys.** The launch script deploys the contract and then deletes the
  account's only key. `verify.mjs` checks the key list is empty.
- **Named accounts.** A post reference `maya.near/1759140000000` already names who to pay.
- **Storage staking.** State costs locked NEAR, so every action here pays for the bytes it adds.

`contract/src/social.rs` is the reusable part: 85 lines of code plus its tests, no state, no
callback, nothing specific to SQUAWK. Copy it into any NEAR contract to give that contract a voice on near.social.

## Live on testnet

| | Account | A round lasts | Target |
|---|---|---|---|
| The daily coin | [`coin.squawk-hq.testnet`](https://testnet.nearblocks.io/address/coin.squawk-hq.testnet) | a day, ending at midnight UTC | 500 crackers |
| The speedrun coin | [`fast.squawk-hq.testnet`](https://testnet.nearblocks.io/address/fast.squawk-hq.testnet) | five minutes | 150 crackers |

Both run the code in `contract/res/squawk.wasm`, both have no access keys, and their launch
transactions are recorded in `deployments/`. Every rule has been run on them as real
transactions: [docs/EVIDENCE.md](docs/EVIDENCE.md) lists what happened, with a link to each one.

near.social's own site and indexer follow mainnet only. On testnet the same writes land in
FastData KV (`https://kv.test.fastnear.com`), and the page and the scripts read them from there.
The writers and fans in the demo (`maya`, `leo`, `zoe`, `ana` and `sam`, all
`.squawk-hq.testnet`) are demo accounts made by `scripts/cast.mjs`.

## Try it

Everything below runs against the live testnet coins.

**0. Open the page.** Do: open https://joymone6451s.github.io/squawk/ and press `Speedrun` at the
top. See: Polly, the current round with its countdown, the crackers fed against the target, the
streak, this round's piles, what Polly said in past rounds, the books with their checks, and
every mint and burn. Connect a testnet wallet to bake and feed. Nothing to install.

Steps 1 to 8 need Node 20 or newer, and steps 5 and 6 also need Rust 1.95 with the
`wasm32-unknown-unknown` target and `cargo-near`. Steps 1 to 3 need no wallet and no key.

```
npm install
```

**1. Check a live coin against this README.** Do: `node scripts/verify.mjs coin.squawk-hq.testnet`.
See: a list of
`PASS` lines and `Everything matches.` The script reads the chain and near.social's data and
checks, among other things, that the account has no keys, that the deployed code hash equals
`contract/res/squawk.wasm`, that the nest holds exactly `supply x price`, that the log accounts
for every cracker minted and burned, and that each squawk on record is a near.social post written
by the contract and quoting the winning post.

**2. See where a coin stands.** Do: `node scripts/status.mjs fast.squawk-hq.testnet`. See: the
round, the time left, crackers fed against the target, the streak, and this round's piles.

**3. Read Polly's own posts.** Do:

```
curl -s -X POST https://kv.test.fastnear.com/v0/latest/social/fast.squawk-hq.testnet \
  -H 'content-type: application/json' -d '{"key_prefix":"post/"}'
```

See: rows whose `predecessor_id` is the contract. Each is a post the contract wrote, with a
`quote` of the post that won that round.

**4. Play a round.** You need a testnet account with a key in the NEAR CLI keychain
(`near account create-account sponsor-by-faucet-service you.testnet autogenerate-new-keypair
save-to-legacy-keychain network-config testnet create`). Use the speedrun coin,
`fast.squawk-hq.testnet`: its rounds last five minutes and its target is 150 crackers. In the
commands below, `<coin>` is that account.

| Do | See |
|---|---|
| `node scripts/play.mjs bake <coin> --as you.testnet --near 0.5` | `Baked 497.39 crackers for 0.5 NEAR.` The first bake also pays 0.00125 NEAR to register you, and every bake pays about 0.0014 NEAR for its line in the log. |
| `node scripts/play.mjs feed <coin> --as you.testnet --post <account/post_id> --crackers 160` | `0.12 NEAR was sent to the writer at once, 0.04 NEAR is Polly's cut.` (with no streak, the cut is 25%). The writer's balance on the explorer is up by 0.12 NEAR. |
| `node scripts/status.mjs <coin>` | `Fed this round 160 of 150 crackers (target reached)` |
| wait for the round to end, then `node scripts/play.mjs squawk <coin> --as you.testnet` | `Polly squawked. The contract paid 0.002 NEAR for waking her.` |
| step 3 again | a new post by the contract, quoting the post you fed |

Any post reference works. `node scripts/play.mjs post <coin> --as you.testnet --text "hello"`
writes one to near.social's testnet data and prints its reference.

The same round can be played on the page: connect a testnet wallet, bake, press Feed on a post,
and press Wake Polly when the round ends.

**5. Run the tests.** Do: `cargo test -p squawk`. See: `39 passed`. The tests carry the contract's
NEAR balance and storage from call to call and re-check the books after every call. Eight of
them are the attacks from the security review.

**6. Run the simulation.** Do: `cargo run -p squawk-sim --profile sim -- scenarios sim/out`, then
`node sim/charts.mjs`. See: the table in [docs/SIMULATION.md](docs/SIMULATION.md), reproduced
exactly, and the three charts in `docs/sim/`.

**7. Build the contract.** Do: `cd contract && cargo near build non-reproducible-wasm --no-abi`.
See: a wasm of about 270 kB. The build is not reproducible bit for bit across machines, so the
hash check in step 1 compares the chain with the wasm committed in `contract/res/`.

**8. Run every rule yourself.** Do: `node scripts/cast.mjs --parent you.testnet`, then
`node scripts/launch.mjs --parent you.testnet --name mycoin --preset speedrun`, then
`node scripts/prove.mjs mycoin.you.testnet`. See: a coin of your own with no keys, then two full
rounds played as real transactions, ending with `... passed. Wrote docs/EVIDENCE.md`. It takes
about fifteen minutes and about 6 test NEAR, most of it the contract's storage.

## What the track asks for, and where it is

| The track asks for | Where |
|---|---|
| An NEP-141 token with the mechanic in the contract, not in a backend | `contract/src/lib.rs`. There is no backend: the page reads the chain directly, and Polly's posts are receipts sent by the contract. |
| All parameters set at launch and readable by anyone, with no admin key | `Rules` in `contract/src/rules.rs`, the `rules` view, and step 1's key check. The contract has no method that writes a rule. |
| Sybil resistance good enough for a demo, with its limits written plainly | "Sybils and other limits" below. |
| A page with the current streak, today's progress and a log of every mint and burn | `web/`, live at https://joymone6451s.github.io/squawk/. The log is the contract's own `log` view, complete from the first bake. |
| Simulate 60 days of community behaviour first, show supply over time under a few scenarios, then pick the parameters | [docs/SIMULATION.md](docs/SIMULATION.md): eight scenarios run through the real contract code, a sweep of 216 rule sets, and the reasoning for each number. |

Track hints used: NEP-141, token mechanics, memecoins.

## Sybils and other limits

- **Nothing counts accounts.** The target counts crackers, piles count crackers, and every
  cracker costs the same NEAR. Splitting a feed across accounts buys nothing and costs a
  registration per account. The simulation replays a flock tip for tip with every tip split
  over ten accounts: one more squawk in 60 days by rounding, 647 more registrations paid.
- **The squawk can be bought.** This is the real limit. A writer who feeds their own post gets
  the writer's share straight back, so it costs them only Polly's cut. Against a simulated flock
  tipping 0.67 NEAR a day, a self-promoter took every squawk for about 0.12 NEAR a day. What they
  could not do is take a fan's tip, or anything from the nest or the hoard. The floor is the
  target: with nobody else feeding, a squawk costs Polly's cut of 500 crackers, 0.05 to
  0.125 NEAR.
- **Weight is money.** One account with many crackers outweighs many accounts with few. That is
  the price of not counting accounts.
- **The contract can't see near.social.** It can't check that a post exists or that it is any
  good. It pays whatever account the reference names. If that account doesn't exist, the
  protocol returns the transfer and it becomes part of the hoard, and the contract's totals
  still count that NEAR as sent.
- **A post can be edited after it wins.** near.social posts can be rewritten by their author, and
  Polly's quote then shows the new text. FastData keeps every version, so the original can
  always be read back, but nothing on chain can stop the edit.
- **Crackers are not redeemable.** They are bought to be fed. Their price can never rise above
  the baking price, because anyone can bake more at 0.001 NEAR.
- **The target is fixed.** If the flock is smaller than about ten tippers a day, Polly squawks
  less often than the simulation shows. Nothing else depends on that guess.
- **Polly needs a caller.** She squawks when someone next calls the contract after a round ends.
  The bounty pays for that call, but if nobody comes, the squawk is late.
- **The hoard only grows.** The part of Polly's cut that isn't spent on storage and bounties
  stays in the contract for good. That is what makes feeding your own post cost something.
- **Crumbs.** An account can't leave (and get its 0.00125 NEAR registration back) while it holds
  any crackers, and one base unit is too small to feed. It has to be sent to another holder
  first.
- **Gas.** On testnet a bake burnt 2.5 TGas, a feed about 3.9 and a squawk with its bounty 4.4
  ([docs/EVIDENCE.md](docs/EVIDENCE.md) has every figure). A call that also wakes Polly does more
  work than a plain one, so the page and the scripts attach 60 to 80 TGas.
- **Unaudited.** The contract was reviewed by a second AI agent told to break it (see
  [docs/REVIEW.md](docs/REVIEW.md)), not by a professional auditor. It is deployed with no keys,
  so a bug can't be patched.

## Repository

```
contract/        the NEP-141 contract (Rust, near-sdk 5.30.1)
  src/lib.rs     bake, feed, squawk, the views and the token standard
  src/rules.rs   the launch parameters and their checks
  src/social.rs  the near.social writer: reusable by any contract
  src/tests.rs   39 unit tests
  res/           the built wasm that is deployed
sim/             the 60-day simulator (runs the real contract natively) and its charts
scripts/         launch, verify, status, play, cast and prove: plain Node, no backend
deployments/     the launch transactions of the live coins (public facts, no keys)
web/             the token page (static, Vite)
tools/video/     how the demo video was recorded
media/           the demo video
docs/            SIMULATION.md, REVIEW.md, EVIDENCE.md
```

## Built with

- Contract: Rust, `near-sdk` 5.30.1, `near-contract-standards` 5.30.1 (the NEP-141, NEP-145 and
  NEP-148 implementations), built with `cargo-near` 0.23.0.
- Scripts: `near-api-js` 7.4.0.
- Page: Vite 7.3.0 and `@hot-labs/near-connect` 0.12.0. No framework. Fonts from Google Fonts.
- Data: FastNear's FastData KV API and near.social's `social-kv/1` standard.
- No template or boilerplate was used. Everything in this repository was written during the
  hackathon window. There is no earlier version of this project on NEAR or any other chain.
- **AI use:** the code, tests, simulation, page and documents were written with Claude Code
  (Anthropic) working with the author. The contract was also reviewed by a separate AI agent
  ([docs/REVIEW.md](docs/REVIEW.md)).
- **The demo video** was filmed by `tools/video/film.mjs`: `playwright-core` 1.65.0 drives
  Microsoft Edge through the real page, against the live speedrun coin. Its clicks are signed by
  `tools/video/wallet-server.mjs`, a local stand-in for a wallet that signs as a demo account, so
  every transaction in the video is real but no wallet app appears in it. The narration is a
  synthetic voice (the Kokoro v1.0 model through `kokoro-onnx` 0.6.1), checked word by word by
  transcription (`faster-whisper` 1.2.1). `tools/video/edit.py` cuts it together with ffmpeg and
  Pillow.

## License

MIT. See [LICENSE](LICENSE).
