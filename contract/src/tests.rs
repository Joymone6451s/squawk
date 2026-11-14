//! Unit tests. They drive the contract the way the chain would: a call at a given time, from a
//! given caller, with a given deposit. The `World` below carries Polly's NEAR balance and storage
//! from one call to the next, and re-checks her books after every single call. A call the contract
//! refuses is rolled back, as it would be on chain.

use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::Gas;
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const POLLY: &str = "polly.testnet";
const DAY: u64 = 86_400_000;
const T0: u64 = 1_800_000_000_000;
const ALICE_POST: &str = "alice.testnet/1800000000001";
const BOB_POST: &str = "bob.testnet/1800000000002";

fn acct(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn launch_rules() -> Rules {
    Rules {
        round_ms: U64(DAY),
        yocto_per_unit: U128(1_000),
        target: U128(500 * ONE),
        min_feed: U128(ONE),
        cut_max_bps: 2_500,
        cut_min_bps: 1_000,
        cut_step_bps: 100,
        late_weight_bps: 2_500,
        wake_bounty: U128(NEAR / 100),
        social: acct("social"),
    }
}

fn context(now: u64, balance: u128, storage: u64, who: &str, deposit: u128, view: bool) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(acct(POLLY))
        .predecessor_account_id(acct(who))
        .signer_account_id(acct(who))
        .block_timestamp(now * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .storage_usage(storage)
        .account_balance(NearToken::from_yoctonear(balance))
        .is_view(view)
        .build()
}

fn wipe_storage() {
    near_sdk::mock::with_mocked_blockchain(|chain| drop(chain.take_storage()));
}

/// Builds a value once and hands out copies. near-sdk's `testing_env!` rebuilds the whole
/// protocol configuration on every call, which is far too slow for a test that makes thousands.
fn cached<T: Clone + Send + Sync + 'static>(make: fn() -> T) -> T {
    static CELL: std::sync::OnceLock<Box<dyn std::any::Any + Send + Sync>> = std::sync::OnceLock::new();
    CELL.get_or_init(|| Box::new(make())).downcast_ref::<T>().unwrap().clone()
}

/// Starts a call: the same thing `testing_env!` does, keeping the storage written so far.
fn set_env(ctx: near_sdk::VMContext, storage: Option<HashMap<Vec<u8>, Vec<u8>>>, results: Vec<near_sdk::PromiseResult>) {
    let storage = storage.unwrap_or_else(|| near_sdk::mock::with_mocked_blockchain(|chain| chain.take_storage()));
    near_sdk::env::set_blockchain_interface(near_sdk::MockedBlockchain::new(
        ctx,
        cached(near_sdk::test_vm_config),
        near_sdk::RuntimeFeesConfig::test(),
        results,
        storage,
        Default::default(),
        None,
    ));
}

fn panic_text(err: Box<dyn std::any::Any + Send>) -> String {
    err.downcast_ref::<String>().cloned().or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

/// Runs something the contract must refuse and checks the reason it gives.
fn fails(f: impl FnOnce(), needle: &str) {
    let text = panic_text(catch_unwind(AssertUnwindSafe(f)).expect_err("this should have been refused"));
    assert!(text.contains(needle), "refused with {text:?}, expected it to mention {needle:?}");
}

/// What a call sent out: transfers, near.social writes, every function call, and logs.
#[derive(Default, Debug, Clone)]
struct Sent {
    transfers: Vec<(AccountId, u128)>,
    social: Vec<serde_json::Value>,
    /// Every function call the contract made, as (receiver, method).
    calls: Vec<(String, String)>,
    logs: Vec<String>,
}

impl Sent {
    fn to(&self, who: &str) -> u128 {
        self.transfers.iter().filter(|(a, _)| a.as_str() == who).map(|(_, n)| n).sum()
    }
}

struct World {
    c: Squawk,
    now: u64,
    balance: u128,
    /// Bytes of state, counted the way the chain counts them, root record included.
    storage: u64,
    /// Bytes of the contract's root `STATE` record that are included in `storage`.
    root: u64,
    last: Sent,
}

impl Drop for World {
    /// The contract's collections write what they still hold when they are dropped, and a view
    /// call may not write. So the last thing a test does is step out of any view.
    fn drop(&mut self) {
        self.enter("nobody.testnet", 0);
    }
}

impl World {
    fn new(rules: Rules) -> Self {
        Self::with_balance(rules, 3 * NEAR)
    }

    fn with_balance(rules: Rules, balance: u128) -> Self {
        // Each coin starts on empty storage, even when one test launches two.
        wipe_storage();
        // A real deploy stores the wasm first. 200 kB stands in for it.
        let (now, storage) = (T0, 200_000);
        set_env(context(now, balance, storage, "deployer.testnet", 0, false), None, vec![]);
        let c = Squawk::new(
            "Squawk".into(),
            "SQUAWK".into(),
            None,
            rules,
            "Polly".into(),
            "https://example.com/squawk".into(),
            None,
            None,
        );
        let mut w = World { c, now, balance, storage, root: 0, last: Sent::default() };
        w.leave();
        w
    }

    /// The size of the root `STATE` record as the chain stores it: a 5-byte key, 40 bytes of
    /// overhead for the record, and the borsh of the contract struct. A unit test never writes
    /// it, so `leave` adds it by hand. (This way of counting came out of the independent review.)
    fn root_bytes(&self) -> u64 {
        45 + near_sdk::borsh::to_vec(&self.c).unwrap().len() as u64
    }

    fn enter(&self, who: &str, deposit: u128) {
        set_env(context(self.now, self.balance, self.storage, who, deposit, false), None, vec![]);
    }

    fn view(&self) {
        set_env(context(self.now, self.balance, self.storage, "viewer.testnet", 0, true), None, vec![]);
    }

    /// Records what the call did to Polly's balance and storage and what it sent, then checks
    /// the books.
    fn leave(&mut self) {
        self.c.flush();
        self.balance = env::account_balance().as_yoctonear();
        // The call started with the old root record counted, and on chain ends by rewriting it.
        let root = self.root_bytes();
        self.storage = env::storage_usage() - self.root + root;
        self.root = root;
        let mut sent = Sent { logs: get_logs(), ..Default::default() };
        for receipt in get_created_receipts() {
            for action in receipt.actions {
                match action {
                    near_sdk::mock::MockAction::Transfer { deposit, .. } => {
                        sent.transfers.push((receipt.receiver_id.clone(), deposit.as_yoctonear()));
                    }
                    near_sdk::mock::MockAction::FunctionCallWeight {
                        method_name, args, attached_deposit, prepaid_gas, ..
                    } => {
                        let method = String::from_utf8(method_name).unwrap();
                        if method == "__fastdata_kv" {
                            // A near.social write: always to `social`, with no deposit and one unit of gas.
                            assert_eq!(receipt.receiver_id.as_str(), "social");
                            assert_eq!(attached_deposit.as_yoctonear(), 0);
                            assert_eq!(prepaid_gas.as_gas(), 1);
                            sent.social.push(serde_json::from_slice(&args).expect("near.social args are JSON"));
                        }
                        sent.calls.push((receipt.receiver_id.to_string(), method));
                    }
                    _ => {}
                }
            }
        }
        self.last = sent;
        self.check();
    }

    /// The promises the README makes, checked after every call.
    fn check(&self) {
        let s = self.status();
        let price = self.c.rules().yocto_per_unit.0;
        assert_eq!(s.supply.0, s.baked.0 - s.eaten.0, "supply is what was baked less what was eaten");
        assert_eq!(s.nest.0, s.supply.0 * price, "the nest holds supply x price");
        assert_eq!(s.tipped.0 + s.cut.0, s.eaten.0 * price, "an eaten cracker's NEAR went to a writer or the hoard");
        let slack = SLACK_BYTES as u128 * env::storage_byte_cost().as_yoctonear();
        let owed = s.nest.0 + s.storage.0 + s.deposits.0 + slack;
        assert!(
            self.balance >= owed,
            "Polly is solvent: balance {} < nest {} + storage {} + deposits {} + slack",
            self.balance,
            s.nest.0,
            s.storage.0,
            s.deposits.0
        );
        assert_eq!(s.hoard.0, self.balance - owed, "the hoard is exactly what is left over");
    }

    /// A call the contract must refuse. Everything is put back afterwards, because on chain a
    /// failed call changes nothing.
    fn refused(&mut self, who: &str, deposit: u128, call: impl FnOnce(&mut Squawk), needle: &str) {
        self.c.flush();
        let saved_state = near_sdk::borsh::to_vec(&self.c).unwrap();
        let saved_storage: HashMap<Vec<u8>, Vec<u8>> = near_sdk::mock::with_mocked_blockchain(|chain| chain.take_storage());
        let restore = |storage: HashMap<Vec<u8>, Vec<u8>>, ctx: near_sdk::VMContext| set_env(ctx, Some(storage), vec![]);
        restore(saved_storage.clone(), context(self.now, self.balance, self.storage, who, deposit, false));
        let c = &mut self.c;
        let text = panic_text(catch_unwind(AssertUnwindSafe(|| call(c))).expect_err("this call should have been refused"));
        assert!(text.contains(needle), "refused with {text:?}, expected it to mention {needle:?}");

        restore(saved_storage, context(self.now, self.balance, self.storage, "viewer.testnet", 0, true));
        let fresh: Squawk = near_sdk::borsh::from_slice(&saved_state).unwrap();
        // The half-changed contract must not be dropped: dropping would write its caches.
        std::mem::forget(std::mem::replace(&mut self.c, fresh));
        self.check();
    }

    fn at(&mut self, ms: u64) -> &mut Self {
        assert!(ms >= self.now, "time only moves forward");
        self.now = ms;
        self
    }

    fn wait(&mut self, ms: u64) -> &mut Self {
        self.now += ms;
        self
    }

    /// Jumps to `offset` ms into round `round`.
    fn round(&mut self, round: u64, offset: u64) -> &mut Self {
        let round_ms = self.c.rules().round_ms.0;
        self.at(T0 + round * round_ms + offset)
    }

    fn bake(&mut self, who: &str, near: u128) -> u128 {
        self.enter(who, near);
        let units = self.c.bake().0;
        self.leave();
        units
    }

    fn feed(&mut self, who: &str, post: &str, units: u128) -> Fed {
        self.enter(who, 0);
        let fed = self.c.feed(post.to_string(), U128(units));
        self.leave();
        fed
    }

    fn squawk(&mut self, who: &str) -> bool {
        self.enter(who, 0);
        let counted = self.c.squawk();
        self.leave();
        counted
    }

    fn status(&self) -> Status {
        self.view();
        self.c.status()
    }

    fn balance_of(&self, who: &str) -> u128 {
        self.view();
        self.c.ft_balance_of(acct(who)).0
    }

    fn hoard(&self) -> u128 {
        self.status().hoard.0
    }

    fn storage_fee(&self) -> u128 {
        self.view();
        self.c.storage_balance_bounds().min.as_yoctonear()
    }

    /// `payer` registers `who` as a holder, paying the storage fee.
    fn register(&mut self, payer: &str, who: &str) {
        let fee = self.storage_fee();
        self.enter(payer, fee);
        self.c.storage_deposit(Some(acct(who)), None);
        self.leave();
    }

    fn unregister(&mut self, who: &str) -> bool {
        self.enter(who, 1);
        let gone = self.c.storage_unregister(None);
        self.leave();
        gone
    }

    fn transfer(&mut self, from: &str, to: &str, units: u128) {
        self.enter(from, 1);
        self.c.ft_transfer(acct(to), U128(units), None);
        self.leave();
    }

    fn floor(&self, who: &str, post: &str) -> u128 {
        self.view();
        self.c.feed_floor(acct(who), post.to_string()).0
    }

    /// Feeds `who`'s crackers on fresh posts by `writer`, every feed exactly at its floor, until
    /// the round's target is met. Returns the number of feeds.
    fn floor_feed_to_target(&mut self, who: &str, writer: &str, next_id: &mut u64) -> u32 {
        let target = self.c.rules().target.0;
        let mut feeds = 0;
        while self.status().fed.0 < target {
            let post = format!("{writer}/{next_id}");
            *next_id += 1;
            let floor = self.floor(who, &post);
            self.feed(who, &post, floor);
            feeds += 1;
        }
        feeds
    }
}

// ----- launch ----------------------------------------------------------------------------------

#[test]
fn launch_stores_the_rules_and_introduces_polly() {
    let w = World::new(launch_rules());
    w.view();
    assert_eq!(w.c.rules(), launch_rules());
    let meta = w.c.ft_metadata();
    assert_eq!((meta.symbol.as_str(), meta.decimals, meta.spec.as_str()), ("SQUAWK", 18, "ft-1.0.0"));
    assert_eq!(w.c.ft_total_supply().0, 0);

    // Polly's first words: her profile, written by the contract itself.
    assert_eq!(w.last.social.len(), 1);
    let hello = &w.last.social[0];
    assert_eq!(hello["profile/name"], "Polly");
    assert_eq!(hello["profile/links/website"], "https://example.com/squawk");
    let about = hello["profile/about"].as_str().unwrap();
    assert!(about.contains("no keys") && about.contains("automated"), "the profile says the account is automated");
    assert!(about.contains("Streak: 0 (best 0)"));
    assert_eq!(hello.as_object().unwrap().len(), 3);

    let s = w.status();
    assert_eq!((s.round.0, s.streak, s.squawks.0, s.cut_bps, s.weight_bps), (0, 0, 0, 2_500, 10_000));
    assert!(!s.asleep);
}

#[test]
fn launch_refuses_rules_that_could_jam_or_cheat() {
    let bad: Vec<(&str, Box<dyn Fn(&mut Rules)>)> = vec![
        ("round_ms", Box::new(|r| r.round_ms = U64(299_999))),
        ("round_ms", Box::new(|r| r.round_ms = U64(32 * DAY))),
        ("yocto_per_unit", Box::new(|r| r.yocto_per_unit = U128(0))),
        ("min_feed", Box::new(|r| r.min_feed = U128(0))),
        ("target", Box::new(|r| r.target = U128(ONE - 1))),
        ("target", Box::new(|r| r.target = U128(u128::MAX / 1_000))),
        ("cut_min_bps", Box::new(|r| r.cut_min_bps = 99)),
        ("cut_max_bps", Box::new(|r| r.cut_max_bps = 5_001)),
        ("cut_min_bps", Box::new(|r| r.cut_min_bps = 2_501)),
        ("late_weight_bps", Box::new(|r| r.late_weight_bps = 999)),
        ("late_weight_bps", Box::new(|r| r.late_weight_bps = 10_001)),
        // 500 crackers x 0.001 NEAR x 10% is 0.05 NEAR. The bounty can't be more.
        ("wake_bounty", Box::new(|r| r.wake_bounty = U128(NEAR / 20 + 1))),
    ];
    for (rule, spoil) in bad {
        let mut rules = launch_rules();
        spoil(&mut rules);
        fails(move || drop(World::new(rules)), &format!("SQUAWK[RULES] {rule}"));
    }
    // The largest bounty the launch rules allow is accepted.
    let mut rules = launch_rules();
    rules.wake_bounty = U128(NEAR / 20);
    World::new(rules);
}

fn launch_with(name: &str, website: &str, avatar: Option<&str>, genesis: Option<u64>) {
    wipe_storage();
    set_env(context(T0, 3 * NEAR, 200_000, "deployer.testnet", 0, false), None, vec![]);
    std::mem::forget(Squawk::new(
        "Squawk".into(),
        "SQUAWK".into(),
        None,
        launch_rules(),
        name.into(),
        website.into(),
        avatar.map(str::to_string),
        genesis.map(U64),
    ));
}

#[test]
fn launch_refuses_text_that_could_smuggle_something_into_the_profile() {
    fails(|| launch_with("Polly\u{1F99C}", "https://example.com", None, None), "profile_name");
    fails(|| launch_with("", "https://example.com", None, None), "profile_name");
    fails(|| launch_with("Polly", "http://example.com", None, None), "https://");
    fails(|| launch_with("Polly", "https://exa\nmple.com", None, None), "website");
    fails(|| launch_with("Polly", "https://example.com", Some("https://evil.example/pixel.png"), None), "fastfs://");
    launch_with("Polly", "https://example.com", Some("fastfs://polly.near/social/media/abc.webp"), None);
}

#[test]
fn genesis_can_line_rounds_up_with_the_clock_but_not_with_the_future() {
    launch_with("Polly", "https://example.com", None, Some(T0));
    launch_with("Polly", "https://example.com", None, Some(T0 - DAY + 1));
    fails(|| launch_with("Polly", "https://example.com", None, Some(T0 + 1)), "genesis_ms");
    fails(|| launch_with("Polly", "https://example.com", None, Some(T0 - DAY)), "genesis_ms");
}

// ----- bake ------------------------------------------------------------------------------------

#[test]
fn baking_mints_at_the_fixed_price_and_fills_the_nest() {
    let mut w = World::new(launch_rules());
    let hoard_before = w.hoard();
    let units = w.bake("alice.testnet", NEAR);
    // 1 NEAR at 0.001 NEAR a cracker is 1,000 crackers, less the one-off registration and the log line.
    assert!(units < 1_000 * ONE && units > 995 * ONE, "got {units}");
    assert_eq!(w.balance_of("alice.testnet"), units);
    let s = w.status();
    assert_eq!(s.supply.0, units);
    assert_eq!(s.nest.0, units * 1_000);
    assert_eq!(s.baked.0, units);

    // The log has the mint, and the two parts of the deposit add up to all of it.
    w.view();
    let log = w.c.log(None, None);
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].kind, Kind::Bake);
    assert_eq!(log[0].account.as_str(), "alice.testnet");
    assert_eq!(log[0].units.0, units);
    assert_eq!(log[0].near.0 + log[0].cut.0, NEAR);
    assert_eq!(log[0].near.0, s.nest.0);
    assert!(w.last.logs.iter().any(|l| l.contains("\"event\":\"ft_mint\"")));
    assert!(w.last.logs.iter().any(|l| l.contains("\"standard\":\"squawk\"") && l.contains("\"event\":\"bake\"")));

    // The fee covered the state the bake added, so the hoard did not shrink.
    assert!(w.hoard() >= hoard_before);

    // A second bake pays for its log line only, so it mints a little more.
    let again = w.bake("alice.testnet", NEAR);
    assert!(again > units && again < 1_000 * ONE);
    assert_eq!(w.balance_of("alice.testnet"), units + again);
}

#[test]
fn baking_too_little_is_refused() {
    let mut w = World::new(launch_rules());
    w.refused("alice.testnet", 1_000_000, |c| { c.bake(); }, "SQUAWK[SMALL]");
    w.refused("alice.testnet", 0, |c| { c.bake(); }, "SQUAWK[SMALL]");
    assert_eq!(w.status().supply.0, 0);
    assert_eq!(w.balance_of("alice.testnet"), 0);
}

// ----- feed ------------------------------------------------------------------------------------

#[test]
fn feeding_burns_crackers_and_pays_the_writer_at_once() {
    let mut w = World::new(launch_rules());
    let units = w.bake("fan.testnet", NEAR);
    let fed = w.feed("fan.testnet", ALICE_POST, 100 * ONE);

    // 100 crackers hold 0.1 NEAR. With no streak Polly keeps 25%.
    assert_eq!(fed.paid.0, NEAR * 75 / 1_000);
    assert_eq!(fed.cut.0, NEAR * 25 / 1_000);
    assert_eq!(w.last.to("alice.testnet"), NEAR * 75 / 1_000);
    assert_eq!(w.last.transfers.len(), 1);
    assert!(fed.top);
    assert_eq!(fed.post, ALICE_POST);

    assert_eq!(w.balance_of("fan.testnet"), units - 100 * ONE);
    let s = w.status();
    assert_eq!(s.supply.0, units - 100 * ONE);
    assert_eq!(s.eaten.0, 100 * ONE);
    assert_eq!(s.fed.0, 100 * ONE);
    assert_eq!(s.top.as_deref(), Some(ALICE_POST));
    assert_eq!(s.posts, 1);
    assert!(w.last.logs.iter().any(|l| l.contains("\"event\":\"ft_burn\"")));

    w.view();
    assert_eq!(w.c.writer(acct("alice.testnet")).tipped.0, NEAR * 75 / 1_000);
    let patron = w.c.patron(acct("fan.testnet"));
    assert_eq!(
        (patron.fed.0, patron.given.0, patron.sunk.0, patron.feeds),
        (100 * ONE, NEAR * 75 / 1_000, NEAR * 25 / 1_000, 1)
    );
    let log = w.c.log(Some(1), None);
    assert_eq!(log[0].kind, Kind::Feed);
    assert_eq!(log[0].post.as_deref(), Some(ALICE_POST));
    assert_eq!((log[0].units.0, log[0].near.0, log[0].cut.0), (100 * ONE, NEAR * 75 / 1_000, NEAR * 25 / 1_000));
    let pots = w.c.posts(U64(0), None, None);
    assert_eq!(pots.len(), 1);
    assert_eq!((pots[0].fed.0, pots[0].feeds, pots[0].tipped.0), (100 * ONE, 1, NEAR * 75 / 1_000));
}

#[test]
fn feeding_is_refused_for_bad_posts_small_amounts_and_empty_pockets() {
    let mut w = World::new(launch_rules());
    let units = w.bake("fan.testnet", NEAR);
    let feed = |post: &'static str, units: u128| move |c: &mut Squawk| { c.feed(post.to_string(), U128(units)); };

    w.refused("fan.testnet", 0, feed(ALICE_POST, ONE - 1), "SQUAWK[SMALL]");
    for bad in ["alice.testnet", "alice.testnet/0", "alice.testnet/01", "Alice.testnet/5", "alice.testnet/5/6", "/5"] {
        w.refused("fan.testnet", 0, feed(bad, 10 * ONE), "SQUAWK[POST]");
    }
    w.refused("fan.testnet", 0, feed(ALICE_POST, 5_000 * ONE), "enough balance");
    w.refused("stranger.testnet", 0, feed(ALICE_POST, 10 * ONE), "not registered");
    // A feed too small to pay for the state it adds is refused, and told how much is enough.
    w.refused("fan.testnet", 0, feed(ALICE_POST, ONE), "to pay for its own storage");

    // Nothing above changed anything.
    assert_eq!(w.balance_of("fan.testnet"), units);
    assert_eq!(w.status().eaten.0, 0);
}

/// `feed_floor` is worked out from byte counts. `feed` measures real storage. They must agree
/// exactly: the floor is accepted and one unit less is refused, whatever rows the feed adds.
#[test]
fn the_floor_the_contract_quotes_is_exactly_the_floor_it_enforces() {
    const LONG_FAN: &str = "a-much-longer-account-name-for-the-second-fan.testnet";
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", 5 * NEAR);
    w.bake(LONG_FAN, 5 * NEAR);
    let long_post = format!("{}/9007199254740991", "w".repeat(64));

    let probe = |w: &mut World, who: &str, post: &str, label: &str| -> u128 {
        w.view();
        let floor = w.c.feed_floor(acct(who), post.to_string()).0;
        assert!(floor > ONE, "{label}: storage sets the floor, not min_feed ({floor})");
        let p = post.to_string();
        w.refused(who, 0, move |c| { c.feed(p, U128(floor - 1)); }, "to pay for its own storage");
        w.feed(who, post, floor);
        floor
    };

    // Round 0, no streak, cut 25%.
    let first = probe(&mut w, "fan.testnet", ALICE_POST, "first feed of the round");
    let again = probe(&mut w, "fan.testnet", ALICE_POST, "same feeder, same post");
    let other = probe(&mut w, "fan.testnet", BOB_POST, "same feeder, new post");
    let newbie = probe(&mut w, LONG_FAN, ALICE_POST, "new feeder, known post");
    let long = probe(&mut w, "fan.testnet", &long_post, "longest possible post");
    assert!(first > other && other > again && newbie > again && long > other, "{first} {other} {again} {newbie} {long}");

    // A streak makes the cut smaller, so the same rows need a bigger feed.
    w.feed("fan.testnet", ALICE_POST, 600 * ONE);
    w.round(1, 0);
    let first_next = probe(&mut w, "fan.testnet", ALICE_POST, "first feed of the next round, streak 1");
    let again_next = probe(&mut w, "fan.testnet", ALICE_POST, "second feed, streak 1");
    assert!(first_next > again_next && again_next > again);

    // Round 1 falls short. The feed that wakes Polly in round 2 must not be charged for the
    // record round 1 leaves behind: that record was paid for by round 1's own first feed.
    w.round(2, 0);
    assert!(!w.status().waiting_squawk);
    let after_miss = probe(&mut w, LONG_FAN, BOB_POST, "first feed after a missed round");
    w.view();
    assert_eq!(w.c.records(None, None).len(), 2);
    // A log line, a new pile and its index row, and the reserve for this round's own record:
    // 197 + 159 + 82 + 420 bytes, at 0.00001 NEAR a byte and a 25% cut.
    assert_eq!(after_miss, 858 * 10u128.pow(19) * 4 / 1_000);

    // A bake that wakes Polly after a miss is charged for its own log line and nothing else. The
    // record of round 2 takes its bytes out of the hoard, where round 2's first feed had put them.
    w.round(4, 0);
    let before = w.hoard();
    w.bake("late-baker.testnet", NEAR / 10);
    w.view();
    assert_eq!(w.c.records(None, None).len(), 3);
    assert!(before - w.hoard().min(before) <= RECORD_BYTES as u128 * 10u128.pow(19), "a record costs the hoard no more than was set aside");
}

#[test]
fn a_tip_to_an_account_that_does_not_exist_ends_up_in_the_hoard() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", NEAR);
    let hoard = w.hoard();
    let fed = w.feed("fan.testnet", "nobody-home.testnet/77", 100 * ONE);
    // The protocol bounces a transfer to a missing account. The test plays the bounce.
    w.balance += fed.paid.0;
    w.check();
    assert!(w.hoard() >= hoard + fed.paid.0);
}

#[test]
fn early_crackers_weigh_more_than_late_ones() {
    let mut w = World::new(launch_rules());
    w.bake("early.testnet", NEAR);
    w.bake("late.testnet", NEAR);

    // 100 crackers at the very start weigh 100. 150 crackers halfway through the round weigh
    // 150 x 62.5% = 93.75, so the early pile still leads.
    let early = w.round(0, 0).feed("early.testnet", ALICE_POST, 100 * ONE);
    assert_eq!(early.weight.0, 100 * ONE);
    let late = w.round(0, DAY / 2).feed("late.testnet", BOB_POST, 150 * ONE);
    assert_eq!(late.weight.0, 150 * ONE * 6_250 / 10_000);
    assert!(!late.top);
    assert_eq!(w.status().top.as_deref(), Some(ALICE_POST));
    assert_eq!(w.status().weight_bps, 6_250);

    // Ten more crackers only draw level, and a tie keeps the first. Ten after that take the lead.
    let level = w.feed("late.testnet", BOB_POST, 10 * ONE);
    assert_eq!(level.pile_weight.0, 100 * ONE);
    assert!(!level.top);
    let more = w.feed("late.testnet", BOB_POST, 10 * ONE);
    assert!(more.top);
    assert_eq!(more.pile_weight.0, 170 * ONE * 6_250 / 10_000);
    assert_eq!(w.status().top.as_deref(), Some(BOB_POST));
    // The last millisecond of a round weighs just over a quarter.
    assert_eq!(w.round(0, DAY - 1).status().weight_bps, 2_501);
}

#[test]
fn a_tie_keeps_the_post_that_got_there_first() {
    let mut w = World::new(launch_rules());
    w.bake("a.testnet", NEAR);
    w.bake("b.testnet", NEAR);
    w.feed("a.testnet", ALICE_POST, 50 * ONE);
    let tie = w.feed("b.testnet", BOB_POST, 50 * ONE);
    assert!(!tie.top);
    assert_eq!(w.status().top.as_deref(), Some(ALICE_POST));
}

/// With an expensive enough cracker, a feed of one base unit pays for its storage and still
/// weighs nothing at the end of a round. The round must have a best-fed post all the same, or
/// waking Polly afterwards would have nothing to count.
#[test]
fn a_feed_too_light_to_weigh_anything_still_leads_its_round() {
    let mut rules = launch_rules();
    rules.yocto_per_unit = U128(NEAR / 10);
    rules.min_feed = U128(1);
    rules.target = U128(2);
    rules.wake_bounty = U128(NEAR / 100);
    let mut w = World::new(rules);
    assert_eq!(w.bake("fan.testnet", NEAR), 9);

    let light = w.round(0, DAY - 1).feed("fan.testnet", ALICE_POST, 1);
    assert_eq!((light.weight.0, light.pile_weight.0), (0, 0));
    assert!(light.top);
    assert_eq!(w.status().top.as_deref(), Some(ALICE_POST));
    // A second weightless pile doesn't take the lead: a tie keeps the first.
    let other = w.feed("fan.testnet", BOB_POST, 1);
    assert!(!other.top);

    w.round(1, 0);
    assert!(w.status().waiting_squawk);
    assert!(w.squawk("waker.testnet"));
    assert_eq!(w.last.social[0][format!("post/{}", w.now)]["quote"], ALICE_POST);
    assert_eq!(w.status().streak, 1);
}

// ----- squawk ----------------------------------------------------------------------------------

#[test]
fn a_round_that_hits_the_target_makes_polly_squawk() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", NEAR);
    w.bake("pal.testnet", NEAR);
    w.feed("fan.testnet", ALICE_POST, 300 * ONE);
    w.feed("pal.testnet", BOB_POST, 250 * ONE);
    assert!(!w.squawk("anyone.testnet"), "nothing to count while the round is open");

    w.round(1, 5);
    let s = w.status();
    assert!(s.asleep && s.waiting_squawk);
    assert_eq!((s.waiting_round.unwrap().0, s.streak, s.fed.0), (0, 1, 0));

    let hoard = w.hoard();
    assert!(w.squawk("waker.testnet"));

    // Polly spoke, by herself: one receipt to `social`, holding the quote, the like, the follow
    // and her updated profile.
    assert_eq!(w.last.social.len(), 1);
    let said = &w.last.social[0];
    let post = &said[format!("post/{}", w.now)];
    assert_eq!(post["quote"], ALICE_POST);
    let text = post["text"].as_str().unwrap();
    assert!(text.contains("SQUAWK #1"), "{text}");
    assert!(text.contains("fed me 550 crackers"), "{text}");
    assert!(text.contains("came out on top with 300 crackers"), "{text}");
    assert!(text.contains("0.225 NEAR was sent to its writer"), "{text}");
    assert!(text.contains("Streak: 1"), "{text}");
    assert_eq!(said[format!("like/{ALICE_POST}")], json!({}));
    assert_eq!(said["graph/follow/alice.testnet"], json!({}));
    assert!(said["profile/about"].as_str().unwrap().contains("Streak: 1 (best 1). Squawks: 1."));
    assert_eq!(said.as_object().unwrap().len(), 4);
    assert!(w.last.logs.iter().any(|l| l.contains("\"event\":\"squawk\"")));

    // The waker got the bounty, out of the hoard.
    assert_eq!(w.last.to("waker.testnet"), NEAR / 100);
    assert!(w.hoard() <= hoard - NEAR / 100);

    let s = w.status();
    assert_eq!((s.round.0, s.streak, s.best_streak, s.squawks.0, s.cut_bps), (1, 1, 1, 1, 2_400));
    assert!(!s.asleep);
    assert_eq!(s.bounties.0, NEAR / 100);

    w.view();
    let records = w.c.records(None, None);
    assert_eq!(records.len(), 1);
    let r = &records[0];
    assert_eq!((r.round.0, r.fed.0, r.posts, r.squawked, r.top.as_str()), (0, 550 * ONE, 2, true, ALICE_POST));
    assert_eq!((r.pile.0, r.streak, r.woken_by.as_str(), r.bounty.0), (300 * ONE, 1, "waker.testnet", NEAR / 100));
    assert_eq!(r.polly_post.unwrap().0, w.now);
    assert_eq!(w.c.writer(acct("alice.testnet")).squawks, 1);
    assert_eq!(w.c.writer(acct("bob.testnet")).squawks, 0);

    // A second call in the same round counts nothing and pays nothing.
    assert!(!w.squawk("waker.testnet"));
    assert!(w.last.transfers.is_empty() && w.last.social.is_empty());
}

#[test]
fn a_round_that_misses_the_target_stays_quiet_and_resets_the_streak() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", 3 * NEAR);
    w.feed("fan.testnet", ALICE_POST, 600 * ONE);
    w.round(1, 0).feed("fan.testnet", ALICE_POST, 600 * ONE);
    assert_eq!(w.status().streak, 1);

    // Round 1 hits, round 2 falls short by one cracker.
    w.round(2, 0).feed("fan.testnet", ALICE_POST, 499 * ONE);
    assert_eq!(w.status().streak, 2);
    assert_eq!(w.status().cut_bps, 2_300);

    w.round(3, 0);
    assert!(!w.status().waiting_squawk);
    assert_eq!(w.status().streak, 0);
    assert!(w.squawk("waker.testnet"));
    // No quote and no bounty. Polly only corrects the streak on her profile.
    assert_eq!(w.last.social.len(), 1);
    assert_eq!(w.last.social[0].as_object().unwrap().len(), 1);
    assert!(w.last.social[0]["profile/about"].as_str().unwrap().contains("Streak: 0 (best 2)"));
    assert!(w.last.transfers.is_empty());
    assert!(w.last.logs.iter().any(|l| l.contains("\"event\":\"miss\"")));

    let s = w.status();
    assert_eq!((s.streak, s.best_streak, s.squawks.0, s.cut_bps), (0, 2, 2, 2_500));
    w.view();
    let records = w.c.records(None, None);
    assert_eq!(records.len(), 3);
    assert_eq!((records[2].squawked, records[2].streak, records[2].bounty.0), (false, 0, 0));
    assert!(records[2].polly_post.is_none());
}

#[test]
fn an_empty_round_breaks_the_streak_even_if_nobody_is_there_to_see_it() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", 3 * NEAR);
    w.feed("fan.testnet", ALICE_POST, 600 * ONE);
    w.round(1, 0).feed("fan.testnet", ALICE_POST, 600 * ONE);

    // Nobody calls during rounds 2 and 3. In round 4 the squawk for round 1 is still delivered,
    // late, and the streak it reached is on record, but the streak now stands at zero.
    w.round(4, 0);
    assert_eq!(w.status().streak, 0);
    assert!(w.status().waiting_squawk);
    assert_eq!(w.status().best_streak, 2);
    assert!(w.squawk("waker.testnet"));
    assert!(w.last.social[0][format!("post/{}", w.now)]["text"].as_str().unwrap().contains("Streak: 2"));
    assert!(w.last.social[0]["profile/about"].as_str().unwrap().contains("Streak: 0 (best 2)"));
    assert_eq!(w.last.to("waker.testnet"), NEAR / 100);

    let s = w.status();
    assert_eq!((s.round.0, s.streak, s.best_streak, s.squawks.0), (4, 0, 2, 2));
    w.view();
    assert_eq!(w.c.records(None, None)[1].streak, 2);
}

#[test]
fn a_quiet_coin_writes_nothing_when_woken() {
    let mut w = World::new(launch_rules());
    w.round(9, 0);
    assert!(w.squawk("waker.testnet"));
    assert!(w.last.social.is_empty() && w.last.transfers.is_empty());
    w.view();
    assert!(w.c.records(None, None).is_empty());
    assert_eq!(w.status().round.0, 9);
}

#[test]
fn feeding_or_baking_wakes_polly_and_earns_the_bounty() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", 3 * NEAR);
    w.feed("fan.testnet", ALICE_POST, 600 * ONE);

    // The first feed of the next round counts the last one.
    w.round(1, 0).feed("fan.testnet", BOB_POST, 600 * ONE);
    assert_eq!(w.last.to("fan.testnet"), NEAR / 100);
    assert_eq!(w.last.social.len(), 1);
    assert_eq!(w.status().streak, 1);
    // That feed already paid the smaller cut: 24% instead of 25%.
    assert_eq!(w.last.to("bob.testnet"), 600 * NEAR / 1_000 * 7_600 / 10_000);

    // So does a bake. The bounty is not taken out of the baker's own deposit.
    w.round(2, 0);
    let hoard = w.hoard();
    let units = w.bake("newcomer.testnet", NEAR);
    assert_eq!(w.last.to("newcomer.testnet"), NEAR / 100);
    assert!(units > 995 * ONE);
    assert!(w.hoard() < hoard, "the bounty came out of the hoard");
    assert_eq!(w.status().streak, 2);
}

#[test]
fn the_cut_falls_with_the_streak_and_stops_at_the_floor() {
    let mut rules = launch_rules();
    rules.cut_step_bps = 400;
    let mut w = World::new(rules);
    w.bake("fan.testnet", 10 * NEAR);
    let mut seen = vec![];
    for round in 0..7 {
        w.round(round, 0);
        let fed = w.feed("fan.testnet", ALICE_POST, 600 * ONE);
        seen.push(fed.cut.0 * 10_000 / (600 * ONE * 1_000));
    }
    assert_eq!(seen, vec![2_500, 2_100, 1_700, 1_300, 1_000, 1_000, 1_000]);
}

#[test]
fn an_empty_hoard_pays_what_it_can_and_never_touches_the_nest() {
    // Launch with just what the storage and the slack cost, so the hoard starts at nothing.
    let mut rules = launch_rules();
    rules.wake_bounty = U128(NEAR / 20);
    let probe = World::new(rules.clone());
    let bare = probe.status().storage.0 + SLACK_BYTES as u128 * 10u128.pow(19);
    let mut w = World::with_balance(rules, bare + NEAR / 1_000);

    w.bake("fan.testnet", NEAR);
    w.feed("fan.testnet", ALICE_POST, 500 * ONE);
    let spare_before = w.hoard();
    w.round(1, 0);
    assert!(w.squawk("waker.testnet"));
    let paid = w.last.to("waker.testnet");
    assert!(paid > 0 && paid <= NEAR / 20 && paid <= spare_before, "paid {paid} of a hoard of {spare_before}");
    assert_eq!(w.status().nest.0, w.status().supply.0 * 1_000);
}

// ----- the token standard ----------------------------------------------------------------------

#[test]
fn crackers_transfer_like_any_nep141_token() {
    let mut w = World::new(launch_rules());
    let units = w.bake("alice.testnet", NEAR);
    let fee = w.storage_fee();

    w.enter("bob.testnet", fee);
    w.c.storage_deposit(None, None);
    w.leave();
    w.enter("alice.testnet", 1);
    w.c.ft_transfer(acct("bob.testnet"), U128(60 * ONE), None);
    w.leave();
    assert_eq!(w.balance_of("bob.testnet"), 60 * ONE);
    assert_eq!(w.balance_of("alice.testnet"), units - 60 * ONE);
    assert_eq!(w.status().supply.0, units);

    // Bob can feed crackers he was given.
    w.feed("bob.testnet", ALICE_POST, 60 * ONE);
    assert_eq!(w.balance_of("bob.testnet"), 0);

    // With an empty balance he can leave and get his storage deposit back.
    w.enter("bob.testnet", 1);
    assert!(w.c.storage_unregister(None));
    w.leave();
    assert_eq!(w.last.to("bob.testnet"), fee + 1);
    w.view();
    assert!(w.c.storage_balance_of(acct("bob.testnet")).is_none());
}

#[test]
fn nobody_can_burn_crackers_except_by_feeding_polly() {
    let mut w = World::new(launch_rules());
    let units = w.bake("alice.testnet", NEAR);
    let fee = w.storage_fee();

    // Leaving with crackers would burn them, so it is refused, with or without force.
    w.refused("alice.testnet", 1, |c| { c.storage_unregister(Some(true)); }, "SQUAWK[CRUMBS]");
    w.refused("alice.testnet", 1, |c| { c.storage_unregister(None); }, "SQUAWK[CRUMBS]");

    // Polly can't be registered as a holder, so crackers can't be parked on her either.
    w.refused("alice.testnet", fee, |c| { c.storage_deposit(Some(acct(POLLY)), None); }, "SQUAWK[SELF]");
    w.refused("alice.testnet", 1, |c| c.ft_transfer(acct(POLLY), U128(ONE), None), "not registered");
    w.refused("alice.testnet", 1, |c| { let _ = c.ft_transfer_call(acct(POLLY), U128(ONE), None, String::new()); }, "not registered");

    assert_eq!(w.status().supply.0, units);
    assert_eq!(w.status().eaten.0, 0);
}

#[test]
fn a_refund_to_a_sender_who_left_goes_to_the_receiver_not_to_a_burn() {
    let mut w = World::new(launch_rules());
    let units = w.bake("alice.testnet", NEAR);
    let fee = w.storage_fee();
    w.enter("vault.testnet", fee);
    w.c.storage_deposit(None, None);
    w.leave();

    // Alice sends everything with ft_transfer_call, then unregisters while the call is in flight.
    w.enter("alice.testnet", 1);
    let _ = w.c.ft_transfer_call(acct("vault.testnet"), U128(units), None, String::new());
    w.leave();
    w.enter("alice.testnet", 1);
    assert!(w.c.storage_unregister(None));
    w.leave();

    // The receiver's call fails. The standard would now burn the refund.
    set_env(context(w.now, w.balance, w.storage, POLLY, 0, false), None, vec![near_sdk::PromiseResult::Failed]);
    let used = w.c.ft_resolve_transfer(acct("alice.testnet"), acct("vault.testnet"), U128(units));
    w.leave();
    assert_eq!(used.0, units);
    assert_eq!(w.balance_of("vault.testnet"), units);
    assert_eq!(w.status().supply.0, units);
}

#[test]
fn a_refused_transfer_call_gives_the_crackers_back() {
    let mut w = World::new(launch_rules());
    let units = w.bake("alice.testnet", NEAR);
    let fee = w.storage_fee();
    w.enter("vault.testnet", fee);
    w.c.storage_deposit(None, None);
    w.leave();
    w.enter("alice.testnet", 1);
    let _ = w.c.ft_transfer_call(acct("vault.testnet"), U128(100 * ONE), None, String::new());
    w.leave();
    set_env(context(w.now, w.balance, w.storage, POLLY, 0, false), None, vec![near_sdk::PromiseResult::Failed]);
    let used = w.c.ft_resolve_transfer(acct("alice.testnet"), acct("vault.testnet"), U128(100 * ONE));
    w.leave();
    assert_eq!(used.0, 0);
    assert_eq!(w.balance_of("alice.testnet"), units);
    assert_eq!(w.balance_of("vault.testnet"), 0);
}

// ----- what the independent review found ---------------------------------------------------------
//
// A second agent was asked to break the contract before launch. These tests are its attacks,
// kept as regression tests. The first two were real findings and are fixed. The rest held.

/// A coin launched with exactly its storage and slack, so the hoard starts at nothing.
fn bare_world(rules: Rules) -> World {
    let probe = World::new(rules.clone());
    let bare = probe.status().storage.0 + SLACK_BYTES as u128 * 10u128.pow(19);
    drop(probe);
    let w = World::with_balance(rules, bare);
    assert_eq!(w.hoard(), 0, "the hoard starts empty");
    w
}

/// Finding 1. A registration pays for the longest possible account name. A short name leaves
/// part of the fee unused, and that part used to count as hoard. A bounty could spend it, and
/// when the account left and took its whole fee back, the contract ended up short. Now the
/// unused part is held for the account and is never the hoard's.
#[test]
fn deposits_held_for_accounts_are_never_spent() {
    const SOCKS: usize = 60;
    let mut w = bare_world(launch_rules());
    let fee = w.storage_fee();

    // Sixty short-named accounts register. Each row takes 72 of the 125 bytes paid for.
    let socks: Vec<String> = (0..SOCKS).map(|n| format!("m{n:02}.testnet")).collect();
    for sock in &socks {
        w.register("mallory.testnet", sock);
    }
    assert_eq!(w.status().deposits.0, SOCKS as u128 * 53 * 10u128.pow(19));
    assert_eq!(w.hoard(), 0, "none of it is Polly's to spend");

    // Three rounds reach the target, and Mallory wakes Polly each time.
    w.bake("fan.testnet", 3 * NEAR);
    let mut id = 1_800_000_000_001u64;
    for round in 0..3 {
        w.round(round, 1_000);
        w.floor_feed_to_target("fan.testnet", "alice.testnet", &mut id);
        w.round(round + 1, 0);
        assert!(w.squawk("mallory.testnet"));
    }

    // Everyone leaves and gets the whole fee back. `leave` re-checks the books after each one.
    for sock in &socks {
        assert!(w.unregister(sock));
        assert_eq!(w.last.to(sock), fee + 1);
    }
    // What is still held is for the one account that remains: "fan.testnet", 11 letters.
    assert_eq!(w.status().deposits.0, 53 * 10u128.pow(19));

    // Nothing is stuck. A feed at exactly its floor, a bake and a wake all still go through.
    let post = format!("alice.testnet/{id}");
    let floor = w.floor("fan.testnet", &post);
    w.feed("fan.testnet", &post, floor);
    w.bake("newcomer.testnet", NEAR);
    assert!(!w.squawk("anyone.testnet"));
}

/// Finding 2. When every feed of a round sits exactly at its floor, all of Polly's cut is
/// locked as storage and the round adds nothing to the hoard. The bounty used to be paid in full
/// anyway, so a patient attacker could walk the hoard down to zero. Now the bounty comes out of
/// what the round added, and no more.
#[test]
fn the_bounty_is_never_more_than_the_round_added_to_the_hoard() {
    let mut w = World::new(launch_rules());
    let me = "f".repeat(64);
    w.bake(&me, 25 * NEAR);
    let mut id = 9_007_199_254_000_000u64;
    let mut hoard = w.hoard();
    for round in 0..20 {
        w.round(round, 1);
        w.floor_feed_to_target(&me, &me, &mut id);
        w.round(round + 1, 0);
        assert!(w.squawk(&me));
        // Rounding leaves a few hundred yocto of surplus on each floor-sized feed, and that is
        // all the bounty there is.
        assert!(w.last.to(&me) < 1_000_000, "paid {} yocto", w.last.to(&me));
        assert!(w.hoard() >= hoard, "round {round} left the hoard smaller: {} < {hoard}", w.hoard());
        hoard = w.hoard();
    }
    assert_eq!(w.status().streak, 20);

    // An ordinary round still pays the whole bounty: one feed of 600 crackers adds far more.
    w.feed(&me, ALICE_POST, 600 * ONE);
    w.round(21, 0);
    assert!(w.squawk("waker.testnet"));
    assert_eq!(w.last.to("waker.testnet"), NEAR / 100);
    assert!(w.hoard() >= hoard);
}

/// A tip to an account that doesn't exist comes back into the hoard. The contract can't see
/// that, so everything it says counts the NEAR as sent, never as received.
#[test]
fn a_tip_that_bounces_is_reported_as_sent() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", NEAR);
    let fed = w.feed("fan.testnet", "ghost.testnet/5", 600 * ONE);
    w.balance += fed.paid.0; // the protocol bounces the transfer
    w.round(1, 0);
    assert!(w.squawk("waker.testnet"));
    let said = w.last.social[0].clone();
    let text = said[format!("post/{}", w.now)]["text"].as_str().unwrap().to_string();
    assert!(text.contains("0.450 NEAR was sent to its writer"), "{text}");
    assert!(said["profile/about"].as_str().unwrap().contains("Sent to writers: 0.450 NEAR"));
    assert_eq!(w.status().tipped.0, fed.paid.0);
}

/// One base unit of crackers is too small to feed and stops its holder from leaving until it is
/// sent on. This is a known nuisance, not a loss: the holder's deposit stays theirs.
#[test]
fn a_crumb_blocks_leaving_until_it_is_sent_on() {
    let mut w = World::new(launch_rules());
    w.bake("mallory.testnet", NEAR);
    w.register("victim.testnet", "victim.testnet");
    w.transfer("mallory.testnet", "victim.testnet", 1);
    w.refused("victim.testnet", 1, |c| { c.storage_unregister(Some(true)); }, "SQUAWK[CRUMBS]");
    w.refused("victim.testnet", 0, |c| { c.feed(ALICE_POST.to_string(), U128(1)); }, "SQUAWK[SMALL]");
    w.transfer("victim.testnet", "mallory.testnet", 1);
    assert!(w.unregister("victim.testnet"));
}

/// The longest gap the clock allows is counted in one call, with no loop over the rounds.
#[test]
fn a_very_long_idle_gap_is_counted_in_one_call() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", NEAR);
    w.feed("fan.testnet", ALICE_POST, 600 * ONE);
    w.round(190_000, 77);
    let s = w.status();
    assert!(s.asleep && s.waiting_squawk);
    assert_eq!(s.streak, 0);
    assert!(w.squawk("waker.testnet"));
    assert_eq!(w.last.to("waker.testnet"), NEAR / 100);
    let s = w.status();
    assert_eq!((s.round.0, s.streak, s.best_streak, s.squawks.0), (190_000, 0, 1, 1));
    // And the coin carries on.
    w.feed("fan.testnet", BOB_POST, 100 * ONE);
    w.bake("fan.testnet", NEAR);
}

/// A feed in the last millisecond of a round counts for that round, and one a millisecond later
/// counts for the next, at full weight. The winner is the heaviest pile, not the largest, and
/// Polly's words don't claim otherwise.
#[test]
fn the_round_boundary_is_sharp() {
    let mut w = World::new(launch_rules());
    w.bake("a.testnet", 3 * NEAR);
    w.bake("b.testnet", 3 * NEAR);
    w.round(0, 0).feed("a.testnet", ALICE_POST, 300 * ONE);
    let late = w.round(0, DAY - 1).feed("b.testnet", BOB_POST, 1_100 * ONE);
    assert_eq!(late.weight.0, 1_100 * ONE * 2_501 / 10_000);
    assert!(!late.top, "1,100 crackers in the last millisecond weigh 275.1, less than 300 at the start");
    let next = w.round(1, 0).feed("b.testnet", BOB_POST, 200 * ONE);
    assert_eq!(next.weight.0, 200 * ONE);
    let text = w.last.social[0][format!("post/{}", w.now)]["text"].as_str().unwrap().to_string();
    assert!(text.contains("This post came out on top with 300 crackers"), "{text}");
    assert!(!text.contains("biggest"), "{text}");
    w.view();
    let records = w.c.records(None, None);
    assert_eq!((records[0].top.as_str(), records[0].fed.0, records[0].pile.0), (ALICE_POST, 1_400 * ONE, 300 * ONE));
    assert_eq!(w.c.pot(U64(0), BOB_POST.into()).unwrap().fed.0, 1_100 * ONE);
    assert_eq!(w.c.pot(U64(1), BOB_POST.into()).unwrap().fed.0, 200 * ONE);
}

/// `ft_transfer_call` makes the contract call an account of the caller's choosing with a
/// message of the caller's choosing. Aimed at `social`, it still can't write to near.social:
/// the method is `ft_on_transfer`, and only `__fastdata_kv` is ever read as a post.
#[test]
fn a_transfer_call_to_social_is_not_a_near_social_write() {
    let mut w = World::new(launch_rules());
    w.bake("mallory.testnet", NEAR);
    w.register("mallory.testnet", "social");
    w.enter("mallory.testnet", 1);
    let _ = w.c.ft_transfer_call(acct("social"), U128(ONE), None, r#"{"post/1":{"text":"pwned"}}"#.to_string());
    w.leave();
    assert_eq!(
        w.last.calls,
        vec![("social".to_string(), "ft_on_transfer".to_string()), (POLLY.to_string(), "ft_resolve_transfer".to_string())]
    );
    assert!(w.last.social.is_empty());
}

// ----- the books -------------------------------------------------------------------------------

#[test]
fn views_page_through_the_log_and_the_rounds() {
    let mut w = World::new(launch_rules());
    w.bake("fan.testnet", 5 * NEAR);
    for round in 0..5u64 {
        w.round(round, 0);
        for n in 0..3u64 {
            w.feed("fan.testnet", &format!("writer{n}.testnet/{}", 100 + n), 200 * ONE);
        }
    }
    w.round(5, 0).squawk("waker.testnet");
    w.view();
    assert_eq!(w.c.status().log_len, 16);
    assert_eq!(w.c.log(None, Some(4)).len(), 4);
    assert_eq!(w.c.log(Some(14), None).len(), 2);
    assert_eq!(w.c.log(Some(16), None).len(), 0);
    assert_eq!(w.c.log(None, Some(1_000)).len(), 16);
    assert_eq!(w.c.records(None, None).len(), 5);
    assert_eq!(w.c.records(Some(3), Some(10)).len(), 2);
    let posts = w.c.posts(U64(2), None, None);
    assert_eq!(
        posts.iter().map(|p| p.post.as_str()).collect::<Vec<_>>(),
        ["writer0.testnet/100", "writer1.testnet/101", "writer2.testnet/102"]
    );
    assert_eq!(w.c.posts(U64(2), Some(1), Some(1)).len(), 1);
    assert_eq!(w.c.posts(U64(77), None, None).len(), 0);
    assert_eq!(w.c.pot(U64(2), "writer1.testnet/101".into()).unwrap().fed.0, 200 * ONE);
    assert!(w.c.pot(U64(2), "nobody.testnet/1".into()).is_none());
}

#[test]
fn the_longest_possible_record_fits_the_bytes_set_aside_for_it() {
    let mut w = World::new(launch_rules());
    let long = "a".repeat(64);
    let post = format!("{long}/9007199254740991");
    w.bake("fan.testnet", NEAR);
    w.feed("fan.testnet", &post, 600 * ONE);
    w.round(1, 0);
    let before = w.storage;
    assert!(w.squawk(&long));
    let grown = w.storage - before;
    // The record itself is 296 bytes at most. The root record shrinks by 85 as the round's best
    // post is cleared, having grown by as much when it was set, so the reserve must cover both.
    assert!(grown > 150 && grown + 85 <= RECORD_BYTES, "a record took {grown} bytes, but {RECORD_BYTES} were set aside");
}

/// A long random run. `World::leave` re-checks every promise after every call.
#[test]
fn the_books_balance_through_a_long_random_run() {
    let mut w = World::new(launch_rules());
    let mut seed = 0x5eed_u64;
    let mut next = move |n: u64| {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) % n
    };
    let people: Vec<String> = (0..12).map(|n| format!("p{n}.testnet")).collect();
    for who in &people {
        w.bake(who, NEAR);
    }
    let mut woken = 0;
    for _ in 0..4_000 {
        w.wait(next(DAY / 6));
        let who = &people[next(12) as usize];
        match next(10) {
            0 => {
                w.bake(who, NEAR / 20 + next(20) as u128 * NEAR / 10);
            }
            1 => {
                woken += w.squawk(who) as u32;
            }
            _ => {
                let post = format!("p{}.testnet/{}", next(12), 1 + next(4));
                w.view();
                let floor = w.c.feed_floor(acct(who), post.clone()).0;
                let amount = floor + next(300) as u128 * ONE;
                if w.balance_of(who) >= amount {
                    w.feed(who, &post, amount);
                }
            }
        }
    }
    let s = w.status();
    assert!(s.squawks.0 > 20 && s.best_streak > 1 && woken > 0, "the run exercised squawks: {s:?}");
    assert!(s.eaten.0 > 0 && s.bounties.0 > 0);
}

#[test]
fn numbers_are_written_the_way_people_read_them() {
    assert_eq!(crackers(0), "0");
    assert_eq!(crackers(999 * ONE + ONE - 1), "999");
    assert_eq!(crackers(1_000 * ONE), "1,000");
    assert_eq!(crackers(1_234_567 * ONE), "1,234,567");
    assert_eq!(near3(0), "0.000");
    assert_eq!(near3(NEAR / 1_000), "0.001");
    assert_eq!(near3(NEAR * 12 + NEAR / 2), "12.500");
    assert_eq!(near3(NEAR - 1), "0.999");
}
