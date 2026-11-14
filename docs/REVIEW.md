# The security review

SQUAWK is deployed with no access keys, so a bug can't be patched after launch. Before launch the
contract was given to a second AI agent with one instruction: break it. The reviewer was not told
what the author believed to be safe. It worked on its own copy of the code and wrote its attacks
as tests.

This was an adversarial review by an AI agent. **It is not a professional audit.**

## What the reviewer tried to do

1. Take NEAR out that it didn't put in, or leave the contract holding less than it owes.
2. Mint crackers without paying, burn someone else's, or break `supply = baked - eaten`.
3. Reach a state in which `bake`, `feed` or `squawk` fails for everyone and no key can fix it.
4. Drain the hoard cheaply.
5. Win the squawk or the bounty unfairly, or make the views disagree with what `feed` enforces.
6. Get arbitrary text or extra keys into what the contract posts on near.social.
7. Find NEP-141 or NEP-145 behaviour that would surprise a wallet or an integrator.
8. Find launch parameters that pass the contract's own checks but produce a broken coin.

## What it found, and what was done

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Leaving could push the contract below what it owes | Low to medium | **Fixed** |
| 2 | The hoard could be made to pay bounties its rounds never earned | Low, griefing | **Fixed** |
| 3 | A feed too light to weigh anything could jam the coin, under unusual launch rules | High under those rules, unreachable under the launch rules | **Fixed** |
| 4 | After a round that missed, the next feed was charged for that round's record | Low | **Fixed** |
| 5 | Two things Polly said could be untrue | Low | **Fixed** (reworded) |
| 6 | The shortest allowed round broke near.social's limit of 300 posts a day | Low, not the launch rules | **Fixed** |
| 7 | A post can be edited after Polly quotes it | Low, by design | Not fixable on chain. Documented. |
| 8 | One base unit of crackers stops its holder from leaving | Low | Accepted. Documented. |

**1. Leaving could push the contract below what it owes.** A registration pays for the longest
possible account name (125 bytes). A short name uses fewer, and the unused part of the fee was
being counted as hoard. A bounty could spend it, and when the account left it was refunded the
whole fee. With an empty hoard and 60 short-named accounts the reviewer drove the balance
0.0127 NEAR below `nest + storage`, after which `squawk`, `bake` and small feeds failed until
someone sent NEAR. *Fix:* the unused part of every registration is now tracked as held for the
account (`deposits`) and is never part of the hoard. `storage_deposit` and `storage_unregister`
both end with the solvency check. Test: `deposits_held_for_accounts_are_never_spent`.

**2. The hoard could be made to pay bounties its rounds never earned.** A feed at exactly its
floor uses all of Polly's cut for its own storage. A round made only of such feeds added nothing
to the hoard, yet the waker was paid the full bounty. An attacker feeding their own posts could
walk the hoard to zero, losing at least 4.7 NEAR for every NEAR drained on the daily rules. *Fix:* the
contract now tracks what each round's feeds add to the hoard after their storage, and the bounty
is paid out of that amount and can't exceed it. Waking Polly can no longer make the hoard
smaller. Test: `the_bounty_is_never_more_than_the_round_added_to_the_hoard`.

**3. A feed too light to weigh anything could jam the coin.** With a very expensive cracker
(0.1 NEAR per base unit) and a minimum feed of one base unit, a feed in the last moments of a
round paid for its storage but weighed zero. The round was then "fed" with no best-fed post, and
every later call that woke Polly failed, for ever. These rules passed the contract's launch
checks. The launch rules were never affected (their smallest feed weighs 0.25 crackers at
least). The author found this while the review was running, and the reviewer reproduced it
independently against the older code. *Fix:* the first post fed in a round always leads, whatever
it weighs, and `wake` no longer contains anything that can stop the call. Test:
`a_feed_too_light_to_weigh_anything_still_leads_its_round`.

**4. The next feed was charged for a missed round's record.** Found by the 60-day simulation, not
by the review: see [SIMULATION.md](SIMULATION.md). The reviewer confirmed the fix with 357 random
probes: the floor the contract quotes was always accepted, and one unit less was always refused.

**5. Two things Polly said could be untrue.** Her squawk said the winner "got the biggest pile",
but the winner is the heaviest pile, and early crackers weigh more: in the reviewer's test the
winner had 300 crackers against a loser's 1,100. It also said the writer "was tipped", but a
transfer to an account that doesn't exist comes back. *Fix:* she now says the post "came out on
top" and that NEAR "was sent to its writer". The page and the README use the same words.

**6. The shortest round.** The contract allowed one-minute rounds, which is up to 1,440 squawks a
day against near.social's limit of 300 posts a day per account. *Fix:* the shortest round is now
five minutes (288 a day). The speedrun coin uses exactly that.

**7. A post can be edited after Polly quotes it.** near.social posts are last-write-wins, and the
contract can't see near.social at all. A writer can win a squawk and then change the post, and
Polly's quote will show the new text. Nothing on chain can prevent this. FastData keeps every
version of every post, so the original can always be read back.

**8. One base unit of crackers stops its holder from leaving.** Leaving is refused while an
account holds any crackers, because leaving with a balance would burn it outside `feed`. One base
unit is too small to feed, so the holder has to send it on first. Someone can send it again. The
holder's deposit stays theirs throughout.

## What held

The reviewer could not, under the launch rules or any it tried:

- take NEAR it had not put in, mint without paying, or burn another account's crackers;
- break `supply = baked - eaten`, or `nest = supply x price`;
- make the hoard go below zero with 6,000 random steps of floor-sized feeds, the longest names
  and 99 squawks, starting from an empty hoard;
- make the views disagree with `feed`;
- get text or keys of its choosing into Polly's posts. `ft_transfer_call` can make the contract
  call `social`, but only with the method `ft_on_transfer`, which near.social ignores;
- stall the contract with a long idle gap: 190,000 rounds are counted in one call;
- overflow anything. Amounts are bounded by the supply of NEAR, and the counters would need about
  4.29 billion calls.

The heaviest call it measured (waking Polly, a squawk, a bounty and the first feed of a round)
used 7 TGas of host calls with named accounts and 23 TGas with 64-character accounts, before the
cost of the wasm itself. The page and the scripts attach 60 to 80 TGas.

## What was not covered

- **Nothing ran on a real runtime during the review.** near-sandbox doesn't run on the machine
  used, so the review executed the contract with near-sdk's mocked host. Total gas, the
  bounced-transfer path, the one-gas receipt to `social` and the indexer's behaviour were
  reasoned about, not executed. The live testnet deployment is the check on those: see the
  evidence in the README.
- The reviewer did not review the page, the simulator or the scripts.
- The review was of the source. `scripts/verify.mjs` checks that the deployed code hash equals
  the wasm in `contract/res/`.

## Reproducing it

Every attack is a test in `contract/src/tests.rs`, under "what the independent review found".
The test harness counts storage the way the chain does, including the contract's root record, and
after every single call it asserts that the balance covers the nest, the storage and the deposits
held, and that the hoard is exactly what is left.

```
cargo test -p squawk
```
