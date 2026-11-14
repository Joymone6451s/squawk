//! A stand-in for the chain. It runs the real contract code, natively, with near-sdk's mocked
//! host: the same `bake`, `feed` and `squawk` that are compiled to wasm. Polly's NEAR balance and
//! storage are carried from call to call, so her solvency is real, not modelled.

use std::collections::BTreeMap;

use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{AccountId, Gas, NearToken, env};
use squawk::{Fed, Rules, Squawk, Status};

pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
pub const POLLY: &str = "polly.near";
pub const T0: u64 = 1_800_000_000_000;

pub struct World {
    pub c: Squawk,
    pub now: u64,
    pub balance: u128,
    pub storage: u64,
    /// NEAR each account has received from Polly: tips and bounties.
    pub received: BTreeMap<String, u128>,
    /// NEAR each account has sent to Polly.
    pub spent: BTreeMap<String, u128>,
    /// Receipts Polly sent to near.social that carried a post.
    pub posts: u32,
    pub calls: u64,
}

fn acct(name: &str) -> AccountId {
    name.parse().unwrap()
}

impl World {
    pub fn new(rules: Rules) -> Self {
        near_sdk::mock::with_mocked_blockchain(|chain| drop(chain.take_storage()));
        let now = T0;
        // The wasm and a launch reserve, as scripts/launch.mjs funds them.
        let storage = 230_000;
        let balance = 3 * NEAR;
        enter(now, balance, storage, "deployer.near", 0, false);
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
        let mut w = World { c, now, balance, storage, received: BTreeMap::new(), spent: BTreeMap::new(), posts: 0, calls: 0 };
        w.leave();
        w
    }

    fn leave(&mut self) {
        self.balance = env::account_balance().as_yoctonear();
        self.storage = env::storage_usage();
        self.calls += 1;
        for receipt in get_created_receipts() {
            for action in receipt.actions {
                match action {
                    MockAction::Transfer { deposit, .. } => {
                        *self.received.entry(receipt.receiver_id.to_string()).or_default() += deposit.as_yoctonear();
                    }
                    MockAction::FunctionCallWeight { args, .. } => {
                        if std::str::from_utf8(&args).is_ok_and(|a| a.contains("\"post/")) {
                            self.posts += 1;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    pub fn bake(&mut self, who: &str, near: u128) -> u128 {
        enter(self.now, self.balance, self.storage, who, near, false);
        let units = self.c.bake().0;
        *self.spent.entry(who.to_string()).or_default() += near;
        self.leave();
        units
    }

    pub fn feed(&mut self, who: &str, post: &str, units: u128) -> Fed {
        enter(self.now, self.balance, self.storage, who, 0, false);
        let fed = self.c.feed(post.to_string(), U128(units));
        self.leave();
        fed
    }

    pub fn squawk(&mut self, who: &str) -> bool {
        enter(self.now, self.balance, self.storage, who, 0, false);
        let counted = self.c.squawk();
        self.leave();
        counted
    }

    pub fn status(&self) -> Status {
        enter(self.now, self.balance, self.storage, "viewer.near", 0, true);
        self.c.status()
    }

    pub fn balance_of(&self, who: &str) -> u128 {
        use near_contract_standards::fungible_token::core::FungibleTokenCore;
        enter(self.now, self.balance, self.storage, "viewer.near", 0, true);
        self.c.ft_balance_of(acct(who)).0
    }

    /// The smallest feed the contract will accept from `who` on `post` right now.
    pub fn c_feed_floor(&self, who: &str, post: &str) -> u128 {
        enter(self.now, self.balance, self.storage, "viewer.near", 0, true);
        self.c.feed_floor(acct(who), post.to_string()).0
    }

    pub fn received(&self, who: &str) -> u128 {
        self.received.get(who).copied().unwrap_or(0)
    }

    pub fn spent(&self, who: &str) -> u128 {
        self.spent.get(who).copied().unwrap_or(0)
    }
}

/// Builds a value once and hands out copies. near-sdk's `testing_env!` rebuilds the whole
/// protocol configuration on every call, which is far too slow for millions of calls.
fn cached<T: Clone + Send + Sync + 'static>(make: fn() -> T) -> T {
    static CELL: std::sync::OnceLock<Box<dyn std::any::Any + Send + Sync>> = std::sync::OnceLock::new();
    CELL.get_or_init(|| Box::new(make())).downcast_ref::<T>().unwrap().clone()
}

/// Starts a call: what `testing_env!` does, keeping the storage written so far.
fn enter(now: u64, balance: u128, storage: u64, who: &str, deposit: u128, view: bool) {
    let context = VMContextBuilder::new()
        .current_account_id(acct(POLLY))
        .predecessor_account_id(acct(who))
        .signer_account_id(acct(who))
        .block_timestamp(now * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .storage_usage(storage)
        .account_balance(NearToken::from_yoctonear(balance))
        .is_view(view)
        .build();
    near_sdk::env::set_blockchain_interface(near_sdk::MockedBlockchain::new(
        context,
        cached(near_sdk::test_vm_config),
        near_sdk::RuntimeFeesConfig::test(),
        vec![],
        near_sdk::mock::with_mocked_blockchain(|chain| chain.take_storage()),
        Default::default(),
        None,
    ));
}

/// A small deterministic random number generator, so every run prints the same numbers.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Uniform in [0, 1).
    pub fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn below(&mut self, n: u64) -> u64 {
        (self.unit() * n as f64) as u64
    }

    /// A draw from a normal distribution (Box-Muller).
    pub fn normal(&mut self) -> f64 {
        let (a, b) = (self.unit().max(1e-12), self.unit());
        (-2.0 * a.ln()).sqrt() * (2.0 * std::f64::consts::PI * b).cos()
    }

    /// How many independent events with the given mean happen (Poisson, by Knuth's method).
    pub fn poisson(&mut self, mean: f64) -> u32 {
        if mean <= 0.0 {
            return 0;
        }
        let limit = (-mean).exp();
        let (mut k, mut p) = (0u32, 1.0);
        loop {
            p *= self.unit();
            if p <= limit {
                return k;
            }
            k += 1;
        }
    }

    /// Picks an index with the given weights.
    pub fn pick(&mut self, weights: &[f64]) -> usize {
        let total: f64 = weights.iter().sum();
        let mut at = self.unit() * total;
        for (i, w) in weights.iter().enumerate() {
            if at < *w {
                return i;
            }
            at -= w;
        }
        weights.len() - 1
    }
}
