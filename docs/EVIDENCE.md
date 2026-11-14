# Evidence from testnet

Every rule in the README, run as real transactions on NEAR testnet by `scripts/prove.mjs` on 2026-11-11 12:06 UTC.
The speedrun coin is [`fast.squawk-hq.testnet`](https://testnet.nearblocks.io/address/fast.squawk-hq.testnet) and the daily coin is [`coin.squawk-hq.testnet`](https://testnet.nearblocks.io/address/coin.squawk-hq.testnet).
The accounts that bake and feed (ana.squawk-hq.testnet, sam.squawk-hq.testnet) and the writers (maya.squawk-hq.testnet, leo.squawk-hq.testnet, zoe.squawk-hq.testnet) are demo accounts made by `scripts/cast.mjs`.
A refused call is a transaction that failed on chain, and its link shows the contract's own reason.

| | Rule | What happened | Transaction |
|---|---|---|---|
| ✅ | Launch | fast.squawk-hq.testnet deployed and initialised in one transaction | [BimSqmrq...](https://testnet.nearblocks.io/txns/BimSqmrqm4UfJX9WiJJPYXXwvDi9AH3AeannLSkR5Mjv) |
| ✅ | No admin key | fast.squawk-hq.testnet deleted its only key, and has 0 access keys now | [2p1nc5cM...](https://testnet.nearblocks.io/txns/2p1nc5cMi8hoEMDCqRgh6HW4qDDySR9QZExJPvTXtAvz) |
| ✅ | Polly's voice | fast.squawk-hq.testnet wrote its own near.social profile ("Polly on fast-forward") at launch, with no key [FastData row](https://kv.test.fastnear.com/v0/latest/social/fast.squawk-hq.testnet/profile%2Fname) |  |
| ✅ | Launch | coin.squawk-hq.testnet deployed and initialised in one transaction | [6pQS8JFn...](https://testnet.nearblocks.io/txns/6pQS8JFnEVV2W5AEp6JNpj41MD2U5NqfiR3pdJYhtgWB) |
| ✅ | No admin key | coin.squawk-hq.testnet deleted its only key, and has 0 access keys now | [HLbzSKsT...](https://testnet.nearblocks.io/txns/HLbzSKsTL9VpjsJ4EsSMP8p4H86de334yTMAMR8Kxz7e) |
| ✅ | Polly's voice | coin.squawk-hq.testnet wrote its own near.social profile ("Polly, the parrot nobody owns") at launch, with no key [FastData row](https://kv.test.fastnear.com/v0/latest/social/coin.squawk-hq.testnet/profile%2Fname) |  |
| ✅ | Bake | ana.squawk-hq.testnet baked 597.39 crackers for 0.6 NEAR, at the fixed price | [2sqDo1d8...](https://testnet.nearblocks.io/txns/2sqDo1d8576hpdiKyyEkTkUYUEZx5EoBzdqM4WMi8QoG), 2.51 TGas |
| ✅ | Feed pays the writer at once | ana.squawk-hq.testnet fed 70 crackers to maya.squawk-hq.testnet/1794396794265. 0.0525 NEAR went to maya.squawk-hq.testnet in the same transaction (balance up 0.0525 NEAR), 0.0175 NEAR was Polly's cut | [Ei5X85oV...](https://testnet.nearblocks.io/txns/Ei5X85oV4ATFZQ76hrs2gBq1VmCDcBdQ2atQiUab2kfF), 3.86 TGas |
| ✅ | The cut | with a streak of 0, Polly kept 25% of the tip, as the rules say | [Ei5X85oV...](https://testnet.nearblocks.io/txns/Ei5X85oV4ATFZQ76hrs2gBq1VmCDcBdQ2atQiUab2kfF), 3.86 TGas |
| ✅ | Refused: a feed too small to pay for its storage | 22.07 crackers, refused: "SQUAWK[SMALL] this feed must be at least 22080000000000000000 base units to pay for its own storage" | [HBgKJSYh...](https://testnet.nearblocks.io/txns/HBgKJSYhmvPJ2uyidunW8B4Te9tRenpB19GXVGdE1MMP), 2.83 TGas |
| ✅ | Refused: a post reference that isn't one | "leo.squawk-hq.testnet/0123", refused: "SQUAWK[POST] the post id must be a whole number with no leading zero" | [7hMzn1ak...](https://testnet.nearblocks.io/txns/7hMzn1akoTGttkt8qjoNwissb3fVhHdeMjJS6b35wc2x), 1.87 TGas |
| ✅ | Bake | sam.squawk-hq.testnet baked 297.39 crackers | [Be2ZmoJR...](https://testnet.nearblocks.io/txns/Be2ZmoJRCZiEApJ9qa1mJMMCX62STwqoUtpQQ3Gfavz4), 2.52 TGas |
| ✅ | Early crackers weigh more | sam.squawk-hq.testnet fed 50 crackers past the middle of the round; they count 61.59% toward the squawk, 30.79 crackers' worth | [AW51BRyM...](https://testnet.nearblocks.io/txns/AW51BRyMfGHq61UCKCGyw5ifkprEQyEnXWC4ziB87RFx), 3.88 TGas |
| ✅ | Feed | ana.squawk-hq.testnet fed 35 crackers to zoe.squawk-hq.testnet/1794396813183 | [FqnCej1K...](https://testnet.nearblocks.io/txns/FqnCej1K2fYYin6wQaDsv3XB8zCzCib3MQiyfhYYNYEi), 3.92 TGas |
| ✅ | Target | the flock fed 155 of 150 crackers in round 2 |  |
| ✅ | Polly falls asleep | after the round, the contract reports a squawk waiting for round 2 |  |
| ✅ | Squawk | sam.squawk-hq.testnet woke Polly. She squawked round 2: maya.squawk-hq.testnet/1794396794265 won with 70 crackers, streak 1, and sam.squawk-hq.testnet was paid 0.002 NEAR | [GRQwJdqy...](https://testnet.nearblocks.io/txns/GRQwJdqyTvPwbKLUnCzdVtB8JagjkKAWm5wvgjR5iRjL), 4.42 TGas |
| ✅ | Written by the contract | FastData has a post by fast.squawk-hq.testnet that quotes maya.squawk-hq.testnet/1794396794265: "🦜 SQUAWK #1! The flock fed me 155 crackers this round. This post came out on top with 70 ..." [FastData row](https://kv.test.fastnear.com/v0/latest/social/fast.squawk-hq.testnet/post%2F1794398406319) | [GRQwJdqy...](https://testnet.nearblocks.io/txns/GRQwJdqyTvPwbKLUnCzdVtB8JagjkKAWm5wvgjR5iRjL), 4.42 TGas |
| ✅ | Like and follow | Polly liked the winning post and followed maya.squawk-hq.testnet [like](https://kv.test.fastnear.com/v0/latest/social/fast.squawk-hq.testnet/like%2Fmaya.squawk-hq.testnet%2F1794396794265), [follow](https://kv.test.fastnear.com/v0/latest/social/fast.squawk-hq.testnet/graph%2Ffollow%2Fmaya.squawk-hq.testnet) |  |
| ✅ | A streak lowers the cut | the streak is now 1, so Polly kept 24% of ana.squawk-hq.testnet's next tip, down from 25% | [HqFs6f3r...](https://testnet.nearblocks.io/txns/HqFs6f3rS6T2SUXGwLtjDPidQeeWHLkTW9yuCogQVJoc), 3.93 TGas |
| ✅ | A round that misses | round 3 ended with 40 of 150 crackers: no squawk, no bounty, and the streak went back to 0 | [6M9e5fYr...](https://testnet.nearblocks.io/txns/6M9e5fYr4bEEcEHFXfnybAMTYN27M6BnFWQSpFUK3aBc), 3.57 TGas |
| ✅ | Polly keeps her profile current | her near.social profile, rewritten by the contract, now says "Streak: 0 (best 1)." [FastData row](https://kv.test.fastnear.com/v0/latest/social/fast.squawk-hq.testnet/profile%2Fabout) |  |
| ✅ | Refused: setting the rules again | "The contract has already been initialized" | [E5GhCaMB...](https://testnet.nearblocks.io/txns/E5GhCaMB6zmhXyFgExVPDcUhiwNaA99FgUEB1h2EcQvS), 1.64 TGas |
| ✅ | Refused: calling the token's private callback | "Method ft_resolve_transfer is private" | [2bXMF6wB...](https://testnet.nearblocks.io/txns/2bXMF6wBg3aLdLdND2HN4Nr3GQ15N9XabvVXcCTrRXCu), 1.53 TGas |
| ✅ | Refused: leaving while holding crackers | "SQUAWK[CRUMBS] feed or send your crackers before leaving" | [GcnsSSQS...](https://testnet.nearblocks.io/txns/GcnsSSQSgqcRXByf1Rn4iFkixBtq6vKzcTFDit7y1S8x), 2.15 TGas |
| ✅ | Refused: registering Polly as a holder | "SQUAWK[SELF] Polly holds no crackers" | [J2Hk4aTT...](https://testnet.nearblocks.io/txns/J2Hk4aTTLQEYXEw3NypY8QSUrPUDGhMEphBvPMTqSb4N), 2.07 TGas |
| ✅ | Refused: sending crackers to Polly | "The account fast.squawk-hq.testnet is not registered" | [DsxmwbbF...](https://testnet.nearblocks.io/txns/DsxmwbbFcZzse1dSQgBfHFkVnDFM846euoT3Cm43Zp3k), 2.35 TGas |
| ✅ | Refused: baking with almost nothing | "SQUAWK[SMALL] attach more than 1360000000000000000999 yoctoNEAR to bake anything" | [88G4n2cw...](https://testnet.nearblocks.io/txns/88G4n2cwYxSNgzcW2XksG6yoNRf4PF7sTSryGEWWL1TQ), 2.26 TGas |
| ✅ | NEP-141 transfer | ana.squawk-hq.testnet sent 5 crackers to sam.squawk-hq.testnet | [BPqC97nh...](https://testnet.nearblocks.io/txns/BPqC97nhUiuR1J1WkGpQLVMhLRnnszWnMMvra3bEYZyu), 2.5 TGas |
| ✅ | NEP-145 registration | zoe.squawk-hq.testnet registered for 0.00125 NEAR; 0.00043 NEAR of it is held for the account, never spent | [56deDruW...](https://testnet.nearblocks.io/txns/56deDruWe4tpVrx8KhuJXiK19gunCPZtXa4Uzsn4Nh33), 2.26 TGas |
| ✅ | Leaving | zoe.squawk-hq.testnet left with no crackers and got the whole fee back | [GnbsDwcZ...](https://testnet.nearblocks.io/txns/GnbsDwcZCXtresWsi2HjaX9B4fL8YLe1Nm35vP6DQ3Fo), 2.73 TGas |
| ✅ | Daily coin: bake | ana.squawk-hq.testnet baked 247.39 crackers | [C5JaNkcd...](https://testnet.nearblocks.io/txns/C5JaNkcdRSYGb75PVDWzNtYqjbhjcQG3PyeHt5bfHE5j), 2.52 TGas |
| ✅ | Daily coin: feed | ana.squawk-hq.testnet fed 53.8 crackers to maya.squawk-hq.testnet/1794396794265 | [39o5bRH4...](https://testnet.nearblocks.io/txns/39o5bRH4djn88viGnhq8pbUFnzE9FHC1Fp9QiS98E7Cs), 3.9 TGas |
| ✅ | verify.mjs | fast.squawk-hq.testnet: 21 checks passed, everything matches |  |
| ✅ | verify.mjs | coin.squawk-hq.testnet: 21 checks passed, everything matches |  |

Run it again on any coin:

```
node scripts/prove.mjs fast.squawk-hq.testnet --daily coin.squawk-hq.testnet
```

## verify.mjs, at the end of the run

```
Checking fast.squawk-hq.testnet on testnet

PASS  NEP-148 metadata: Squawk Speedrun (SQUAWK5), 18 decimals
PASS  NEP-141 supply matches the status view: 699.78 crackers
PASS  No access keys on the coin: 0 key(s)
PASS  The code on chain is the code in this repository: DysCsEyJtrM8FhtZGKWAFHXRbM7wUdxojwDD9X4pFpvz
PASS  Every parameter is public: 10 parameters
PASS  The rules are inside the limits the contract promises: cut 25% falling to 10%, late weight 25%
PASS  Supply is what was baked less what was eaten: 894.78 baked, 195 eaten
PASS  The nest holds exactly supply x price: 0.6997 NEAR
PASS  Every eaten cracker's NEAR went to a writer or to the hoard: 0.1466 NEAR to writers, 0.0483 NEAR cut
PASS  The log holds every mint: 2 bakes
PASS  The log holds every burn: 4 feeds
PASS  The log's tips and cuts add up to the totals
PASS  Bake lines account for every yocto attached
PASS  Polly is solvent: her balance covers the nest, her storage and the deposits she holds for accounts: 3.5604 NEAR held, 3.465 NEAR owed
PASS  The hoard is exactly what is left over: 0.0854 NEAR
PASS  Every squawk has a record: 1 squawks in 2 fed rounds
PASS  Rounds only squawk when the flock reached the target
PASS  Bounties paid match the records: 0.002 NEAR
INFO  Streak: 0 now, 1 best
PASS  Polly has a near.social profile, written by the contract: Polly on fast-forward
PASS  Her profile says the account is automated
PASS  Every squawk is a post on near.social that quotes the winning post: 1 of 1 found in FastData (https://kv.test.fastnear.com)

Everything matches.
```

```
Checking coin.squawk-hq.testnet on testnet

PASS  NEP-148 metadata: Squawk (SQUAWK), 18 decimals
PASS  NEP-141 supply matches the status view: 193.59 crackers
PASS  No access keys on the coin: 0 key(s)
PASS  The code on chain is the code in this repository: DysCsEyJtrM8FhtZGKWAFHXRbM7wUdxojwDD9X4pFpvz
PASS  Every parameter is public: 10 parameters
PASS  The rules are inside the limits the contract promises: cut 25% falling to 10%, late weight 25%
PASS  Supply is what was baked less what was eaten: 247.39 baked, 53.8 eaten
PASS  The nest holds exactly supply x price: 0.1935 NEAR
PASS  Every eaten cracker's NEAR went to a writer or to the hoard: 0.0403 NEAR to writers, 0.0134 NEAR cut
PASS  The log holds every mint: 1 bakes
PASS  The log holds every burn: 1 feeds
PASS  The log's tips and cuts add up to the totals
PASS  Bake lines account for every yocto attached
PASS  Polly is solvent: her balance covers the nest, her storage and the deposits she holds for accounts: 3.0187 NEAR held, 2.9357 NEAR owed
PASS  The hoard is exactly what is left over: 0.073 NEAR
PASS  Every squawk has a record: 0 squawks in 0 fed rounds
PASS  Rounds only squawk when the flock reached the target
PASS  Bounties paid match the records: 0 NEAR
INFO  Streak: 0 now, 0 best
PASS  Polly has a near.social profile, written by the contract: Polly, the parrot nobody owns
PASS  Her profile says the account is automated
PASS  Every squawk is a post on near.social that quotes the winning post: 0 of 0 found in FastData (https://kv.test.fastnear.com)

Everything matches.
```
