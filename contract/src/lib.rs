//! SQUAWK: the parrot nobody owns.
//!
//! SQUAWK is a NEP-141 coin whose contract is also a near.social account. The account has no
//! keys. What it posts is decided by the rules below and by nothing else.
//!
//! * **Bake.** Anyone sends NEAR and gets crackers (SQUAWK) at a fixed price. The NEAR waits in
//!   the nest, and the nest always holds exactly `supply x price`.
//! * **Feed.** Anyone burns crackers on a near.social post. The NEAR baked into those crackers
//!   leaves the nest at once: most of it goes to the post's writer, and the rest is Polly's cut,
//!   which stays in her hoard.
//! * **Squawk.** When a round ends and the flock fed at least the target, Polly quotes the
//!   best-fed post on near.social, likes it and follows its writer. She does it herself, with a
//!   receipt sent by this contract. Crackers fed early in a round weigh more than late ones.
//! * **Streak.** Every round that hits the target makes the streak one longer and Polly's cut
//!   smaller. A round that misses resets both.
//! * **Hoard.** Polly's cut pays for her storage and for the bounty that goes to whoever wakes
//!   her. Nothing else can leave it.
//!
//! There is no owner, no setter and no pause. Every parameter is fixed in [`Squawk::new`] and
//! readable through [`Squawk::rules`]. Panics name the rule that stopped the call, as
//! `SQUAWK[RULE] reason`.

mod rules;
pub mod social;
#[cfg(test)]
mod tests;

pub use rules::Rules;
use rules::check_plain;
use social::{Batch, PostRef};

use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{Lazy, LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near, require,
};

pub const DECIMALS: u8 = 18;
/// One whole cracker, in base units.
pub const ONE: u128 = 1_000_000_000_000_000_000;
pub const BPS: u128 = 10_000;
/// Bytes set aside, out of the first feed of a round, for the record written when the round ends.
pub const RECORD_BYTES: u64 = 420;
/// Bytes of NEAR the hoard never spends, so the account always covers its own state.
pub const SLACK_BYTES: u64 = 1_000;
/// The most rows one view call returns.
pub const MAX_PAGE: u32 = 100;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Accounts,
    Meta,
    Pots,
    Index,
    Records,
    Log,
    Writers,
    Patrons,
}

/// One post's pile of crackers in one round.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pot {
    pub post: String,
    /// Crackers burned on this post this round.
    pub fed: U128,
    /// What they weigh toward the squawk. Early crackers weigh more.
    pub weight: U128,
    /// NEAR, in yocto, sent to the writer from these crackers.
    pub tipped: U128,
    pub feeds: u32,
}

/// A finished round in which anything was fed.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub round: U64,
    /// Crackers the flock fed in the round.
    pub fed: U128,
    pub posts: u32,
    /// Whether the flock reached the target, so that Polly squawked.
    pub squawked: bool,
    /// The best-fed post.
    pub top: String,
    pub pile: U128,
    pub tipped: U128,
    /// The streak once this round was counted.
    pub streak: u32,
    pub woken_ms: U64,
    pub woken_by: AccountId,
    /// NEAR, in yocto, paid to the account that woke Polly.
    pub bounty: U128,
    /// The id of Polly's own near.social post, when she squawked.
    pub polly_post: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    /// Crackers minted for NEAR.
    Bake,
    /// Crackers burned on a post.
    Feed,
}

/// One line of the log. Every mint is a `Bake` and every burn is a `Feed`; there are no others.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub kind: Kind,
    pub round: U64,
    pub ms: U64,
    pub account: AccountId,
    /// The post that was fed. Empty for a bake.
    pub post: Option<String>,
    /// Crackers minted or burned, in base units.
    pub units: U128,
    /// Bake: NEAR that went into the nest. Feed: NEAR paid to the writer.
    pub near: U128,
    /// Bake: NEAR kept for the account's registration and this log line. Feed: Polly's cut.
    pub cut: U128,
}

/// What an account has earned as a writer.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Writer {
    /// NEAR, in yocto, sent to this account for its posts.
    pub tipped: U128,
    /// Crackers burned on its posts.
    pub fed: U128,
    pub feeds: u32,
    /// Times Polly squawked one of its posts.
    pub squawks: u32,
}

/// What an account has given. `sunk` is the part that went to the hoard and can come back to
/// nobody, so it is a number no amount of self-tipping can fake.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Patron {
    /// Crackers this account has fed.
    pub fed: U128,
    /// NEAR, in yocto, it has sent to writers.
    pub given: U128,
    /// NEAR, in yocto, it has left in Polly's hoard.
    pub sunk: U128,
    pub feeds: u32,
}

/// What one feed did.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Fed {
    pub post: String,
    /// NEAR, in yocto, sent to the writer.
    pub paid: U128,
    /// Polly's cut, in yocto.
    pub cut: U128,
    /// Weight this feed added to the post's pile.
    pub weight: U128,
    /// The pile's weight after this feed.
    pub pile_weight: U128,
    /// Whether the post is now the best-fed of the round.
    pub top: bool,
}

/// Everything the token page shows at a glance.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Status {
    pub now_ms: U64,
    pub genesis_ms: U64,
    /// The round the clock says it is.
    pub round: U64,
    pub round_ends_ms: U64,
    /// Crackers fed so far in this round.
    pub fed: U128,
    pub target: U128,
    pub posts: u32,
    /// The best-fed post of this round so far.
    pub top: Option<String>,
    pub top_weight: U128,
    /// True while a finished round is waiting for someone to wake Polly.
    pub asleep: bool,
    /// The finished round that is waiting, when `asleep`.
    pub waiting_round: Option<U64>,
    /// Whether waking Polly now makes her squawk.
    pub waiting_squawk: bool,
    /// The streak as it stands once any waiting round is counted.
    pub streak: u32,
    pub best_streak: u32,
    pub squawks: U64,
    /// Polly's cut of a tip right now, in basis points.
    pub cut_bps: u32,
    /// What a cracker fed right now weighs toward the squawk, in basis points.
    pub weight_bps: u32,
    pub supply: U128,
    /// NEAR, in yocto, held for the crackers in circulation: `supply x price`.
    pub nest: U128,
    /// NEAR, in yocto, that Polly can spend: her balance less the nest, her storage, what she
    /// holds for registered accounts and a little slack.
    pub hoard: U128,
    /// NEAR, in yocto, locked by the protocol for this contract's state.
    pub storage: U128,
    /// NEAR, in yocto, held for registered accounts on top of what their rows cost in storage.
    /// It is theirs again when they leave, so it is never part of the hoard.
    pub deposits: U128,
    pub balance: U128,
    /// Lifetime totals. `tipped` is the NEAR sent to writers: a transfer to an account that
    /// doesn't exist comes back and joins the hoard, and is still counted here as sent.
    pub baked: U128,
    pub eaten: U128,
    pub tipped: U128,
    pub cut: U128,
    pub bounties: U128,
    pub log_len: u32,
    pub records_len: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Squawk {
    token: FungibleToken,
    meta: Lazy<FungibleTokenMetadata>,
    rules: Rules,
    website: String,
    genesis_ms: u64,

    /// The round the contract last saw. It moves forward in `wake`.
    round: u64,
    round_fed: u128,
    round_posts: u32,
    top: Option<String>,
    top_weight: u128,
    /// What this round's feeds have added to the hoard so far, in yocto: Polly's cut of each,
    /// less the storage each paid for. The bounty for waking Polly is paid out of this and can
    /// never be more, so waking her can't cost the hoard anything it didn't just earn.
    round_surplus: u128,

    pots: LookupMap<(u64, String), Pot>,
    /// `(round, n)` to the n-th post fed in that round, so a round's posts can be listed.
    index: LookupMap<(u64, u32), String>,
    records: Vector<Record>,
    log: Vector<Entry>,
    writers: LookupMap<AccountId, Writer>,
    patrons: LookupMap<AccountId, Patron>,

    streak: u32,
    best_streak: u32,
    squawks: u64,
    /// Lifetime crackers minted and burned, in base units.
    baked: u128,
    eaten: u128,
    /// Lifetime NEAR, in yocto, sent to writers, taken as cut, and paid as bounties.
    tipped: u128,
    cut: u128,
    bounties: u128,
    /// NEAR, in yocto, held for registered accounts beyond what their rows cost in storage. A
    /// registration pays for the longest possible account name, most names are shorter, and the
    /// whole fee goes back when the account leaves. The difference is owed, not earned.
    deposits: u128,
}

#[near]
impl Squawk {
    /// Launches the coin. This is the only place a parameter is ever written.
    ///
    /// `genesis_ms` lines the rounds up with the clock, for example with midnight UTC. It can't be
    /// in the future or more than one round back, so the coin starts in round 0.
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        name: String,
        symbol: String,
        icon: Option<String>,
        rules: Rules,
        profile_name: String,
        website: String,
        avatar: Option<String>,
        genesis_ms: Option<U64>,
    ) -> Self {
        rules.check();
        check_plain("name", &name, 40);
        check_plain("symbol", &symbol, 12);
        check_plain("profile_name", &profile_name, 60);
        check_plain("website", &website, 200);
        require!(website.starts_with("https://"), "SQUAWK[RULES] website: must start with https://");
        if let Some(avatar) = &avatar {
            check_plain("avatar", avatar, 300);
            require!(avatar.starts_with("fastfs://"), "SQUAWK[RULES] avatar: must be a fastfs:// address");
        }
        let now = env::block_timestamp_ms();
        let genesis = genesis_ms.map(|g| g.0).unwrap_or(now);
        require!(
            genesis <= now && now - genesis < rules.round_ms.0,
            "SQUAWK[RULES] genesis_ms: must be within one round before now"
        );

        let this = Self {
            token: FungibleToken::new(Key::Accounts),
            meta: Lazy::new(
                Key::Meta,
                FungibleTokenMetadata {
                    spec: FT_METADATA_SPEC.to_string(),
                    name,
                    symbol,
                    icon,
                    reference: None,
                    reference_hash: None,
                    decimals: DECIMALS,
                },
            ),
            rules,
            website,
            genesis_ms: genesis,
            round: 0,
            round_fed: 0,
            round_posts: 0,
            top: None,
            top_weight: 0,
            round_surplus: 0,
            pots: LookupMap::new(Key::Pots),
            index: LookupMap::new(Key::Index),
            records: Vector::new(Key::Records),
            log: Vector::new(Key::Log),
            writers: LookupMap::new(Key::Writers),
            patrons: LookupMap::new(Key::Patrons),
            streak: 0,
            best_streak: 0,
            squawks: 0,
            baked: 0,
            eaten: 0,
            tipped: 0,
            cut: 0,
            bounties: 0,
            deposits: 0,
        };

        // Polly introduces herself. From here on this account speaks only through `wake`.
        let mut hello = Batch::new()
            .profile("name", &profile_name)
            .profile("about", &this.about())
            .profile("links/website", &this.website);
        if let Some(avatar) = &avatar {
            hello = hello.profile("avatar", avatar);
        }
        hello.send(&this.rules.social);
        this
    }

    // ----- the three things anyone can do ---------------------------------------------------

    /// Bakes crackers for the attached NEAR, at the fixed price. All of that NEAR goes into the
    /// nest, less what the caller's registration (first time only) and this log line cost in
    /// storage. Returns the crackers minted, in base units.
    #[payable]
    pub fn bake(&mut self) -> U128 {
        let who = env::predecessor_account_id();
        self.wake(&who);

        let deposit = env::attached_deposit().as_yoctonear();
        let byte_cost = env::storage_byte_cost().as_yoctonear();
        let mut fee = 0u128;
        if !self.token.accounts.contains_key(&who) {
            fee += self.register(&who);
        }

        let before = env::storage_usage();
        let line = self.log.len();
        self.log.push(Entry {
            kind: Kind::Bake,
            round: U64(self.round),
            ms: U64(env::block_timestamp_ms()),
            account: who.clone(),
            post: None,
            units: U128(0),
            near: U128(0),
            cut: U128(0),
        });
        self.log.flush();
        fee += (env::storage_usage() - before) as u128 * byte_cost;

        let price = self.rules.yocto_per_unit.0;
        let units = deposit.saturating_sub(fee) / price;
        require!(
            units > 0,
            format!("SQUAWK[SMALL] attach more than {} yoctoNEAR to bake anything", fee + price - 1)
        );
        let into_nest = units * price;
        let entry = &mut self.log[line];
        entry.units = U128(units);
        entry.near = U128(into_nest);
        // Whatever is not in the nest stays with Polly: the fee, and dust smaller than one unit.
        entry.cut = U128(deposit - into_nest);

        self.token.internal_deposit(&who, units);
        self.baked += units;
        FtMint { owner_id: &who, amount: U128(units), memo: Some("baked") }.emit();
        emit("bake", json!({ "account": who, "units": U128(units), "near": U128(into_nest) }));

        self.assert_solvent();
        U128(units)
    }

    /// Burns `amount` crackers on a near.social post, written `account.near/1759140000000`.
    ///
    /// The NEAR baked into those crackers leaves the nest in this same call: the writer of the
    /// post gets all of it but Polly's cut. The crackers also count toward the round's target and
    /// add to the post's pile, weighted by how early in the round they arrive.
    pub fn feed(&mut self, post: String, amount: U128) -> Fed {
        let who = env::predecessor_account_id();
        self.wake(&who);

        let amount = amount.0;
        require!(
            amount >= self.rules.min_feed.0,
            format!("SQUAWK[SMALL] feed at least {} base units", self.rules.min_feed.0)
        );
        let post = PostRef::parse(&post).unwrap_or_else(|why| env::panic_str(&format!("SQUAWK[POST] {why}")));
        let key = post.key();
        let writer = post.author;

        // The burn. `internal_withdraw` stops the call if the caller holds too little.
        self.token.internal_withdraw(&who, amount);
        FtBurn { owner_id: &who, amount: U128(amount), memo: Some("fed to Polly") }.emit();

        let now = env::block_timestamp_ms();
        let value = amount * self.rules.yocto_per_unit.0;
        let cut_bps = self.rules.cut_bps(self.streak);
        let cut = value * cut_bps as u128 / BPS;
        let paid = value - cut;
        let weight = amount * self.rules.weight_bps(now - self.round_start_ms(self.round)) / BPS;

        let before = env::storage_usage();
        let first_of_round = self.round_fed == 0;

        let pot_key = (self.round, key.clone());
        let mut pot = match self.pots.get(&pot_key) {
            Some(pot) => pot.clone(),
            None => {
                self.index.insert((self.round, self.round_posts), key.clone());
                self.round_posts += 1;
                Pot { post: key.clone(), fed: U128(0), weight: U128(0), tipped: U128(0), feeds: 0 }
            }
        };
        pot.fed.0 += amount;
        pot.weight.0 += weight;
        pot.tipped.0 += paid;
        pot.feeds += 1;
        let pile_weight = pot.weight.0;
        self.pots.insert(pot_key, pot);

        // A pile only ever grows, so the best-fed post is always the last one to pass the others.
        // A tie keeps the post that got there first. The first post fed in a round leads even if
        // its crackers are too few to weigh anything, so a fed round always has a best-fed post.
        if self.top.is_none() || pile_weight > self.top_weight {
            self.top_weight = pile_weight;
            self.top = Some(key.clone());
        }
        self.round_fed += amount;

        let mut earned = self.writers.get(&writer).cloned().unwrap_or_default();
        earned.tipped.0 += paid;
        earned.fed.0 += amount;
        earned.feeds += 1;
        self.writers.insert(writer.clone(), earned);

        let mut given = self.patrons.get(&who).cloned().unwrap_or_default();
        given.fed.0 += amount;
        given.given.0 += paid;
        given.sunk.0 += cut;
        given.feeds += 1;
        self.patrons.insert(who.clone(), given);

        self.log.push(Entry {
            kind: Kind::Feed,
            round: U64(self.round),
            ms: U64(now),
            account: who.clone(),
            post: Some(key.clone()),
            units: U128(amount),
            near: U128(paid),
            cut: U128(cut),
        });

        // Every feed pays for the state it adds out of Polly's cut, so the hoard can't be drained
        // by small feeds. The first feed of a round also pays for the record the round will leave.
        self.flush();
        let mut storage = (env::storage_usage() - before) as u128 * env::storage_byte_cost().as_yoctonear();
        if first_of_round {
            storage += RECORD_BYTES as u128 * env::storage_byte_cost().as_yoctonear();
        }
        if cut < storage {
            let needed = (storage * BPS).div_ceil(cut_bps as u128 * self.rules.yocto_per_unit.0);
            env::panic_str(&format!(
                "SQUAWK[SMALL] this feed must be at least {needed} base units to pay for its own storage"
            ));
        }

        self.eaten += amount;
        self.tipped += paid;
        self.cut += cut;
        // What is left of the cut after its storage is what this feed really added to the hoard.
        self.round_surplus += cut - storage;
        if paid > 0 {
            // If the writer's account doesn't exist, the protocol sends the NEAR back, and it
            // simply becomes part of the hoard. The totals still count it as sent.
            Promise::new(writer.clone()).transfer(NearToken::from_yoctonear(paid)).detach();
        }
        emit(
            "feed",
            json!({
                "account": who, "post": key, "writer": writer, "round": U64(self.round),
                "units": U128(amount), "paid": U128(paid), "cut": U128(cut), "weight": U128(weight),
            }),
        );

        self.assert_solvent();
        Fed {
            top: self.top.as_deref() == Some(key.as_str()),
            post: key,
            paid: U128(paid),
            cut: U128(cut),
            weight: U128(weight),
            pile_weight: U128(pile_weight),
        }
    }

    /// Wakes Polly. If a round has ended since anyone last called the contract, it is counted now:
    /// Polly squawks if the flock reached the target, and the caller gets the bounty. `bake` and
    /// `feed` wake her too, so this is only needed when nobody else is around. Returns whether a
    /// round was counted.
    pub fn squawk(&mut self) -> bool {
        let who = env::predecessor_account_id();
        let counted = self.wake(&who);
        self.assert_solvent();
        counted
    }

    // ----- views ----------------------------------------------------------------------------

    pub fn rules(&self) -> Rules {
        self.rules.clone()
    }

    pub fn status(&self) -> Status {
        let now = env::block_timestamp_ms();
        let round_now = self.round_at(now);
        let asleep = round_now > self.round;
        let waiting_squawk = asleep && self.round_fed > 0 && self.round_fed >= self.rules.target.0;
        let streak = self.streak_at(round_now);
        let elapsed = now - self.round_start_ms(round_now);
        let balance = env::account_balance().as_yoctonear();
        let storage = self.storage_cost();
        let slack = SLACK_BYTES as u128 * env::storage_byte_cost().as_yoctonear();
        Status {
            now_ms: U64(now),
            genesis_ms: U64(self.genesis_ms),
            round: U64(round_now),
            round_ends_ms: U64(self.round_start_ms(round_now + 1)),
            fed: U128(if asleep { 0 } else { self.round_fed }),
            target: self.rules.target,
            posts: if asleep { 0 } else { self.round_posts },
            top: if asleep { None } else { self.top.clone() },
            top_weight: U128(if asleep { 0 } else { self.top_weight }),
            asleep,
            waiting_round: asleep.then_some(U64(self.round)),
            waiting_squawk,
            streak,
            best_streak: self.best_streak.max(if waiting_squawk { self.streak + 1 } else { 0 }),
            squawks: U64(self.squawks),
            cut_bps: self.rules.cut_bps(streak),
            weight_bps: self.rules.weight_bps(elapsed) as u32,
            supply: U128(self.token.total_supply),
            nest: U128(self.nest()),
            hoard: U128(balance.saturating_sub(self.nest() + storage + self.deposits + slack)),
            storage: U128(storage),
            deposits: U128(self.deposits),
            balance: U128(balance),
            baked: U128(self.baked),
            eaten: U128(self.eaten),
            tipped: U128(self.tipped),
            cut: U128(self.cut),
            bounties: U128(self.bounties),
            log_len: self.log.len(),
            records_len: self.records.len(),
        }
    }

    /// The posts fed in `round`, in the order they were first fed.
    pub fn posts(&self, round: U64, from: Option<u32>, limit: Option<u32>) -> Vec<Pot> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE);
        (from..from.saturating_add(limit))
            .map_while(|n| self.index.get(&(round.0, n)))
            .filter_map(|post| self.pots.get(&(round.0, post.clone())).cloned())
            .collect()
    }

    /// One post's pile in one round.
    pub fn pot(&self, round: U64, post: String) -> Option<Pot> {
        self.pots.get(&(round.0, post)).cloned()
    }

    /// Finished rounds, oldest first, starting at `from`.
    pub fn records(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Record> {
        page(&self.records, from, limit)
    }

    /// The log of every mint and burn, oldest first, starting at `from`.
    pub fn log(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Entry> {
        page(&self.log, from, limit)
    }

    pub fn writer(&self, account_id: AccountId) -> Writer {
        self.writers.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn patron(&self, account_id: AccountId) -> Patron {
        self.patrons.get(&account_id).cloned().unwrap_or_default()
    }

    /// The smallest feed, in base units, that `account_id` could make on `post` right now.
    ///
    /// A feed has to be big enough for Polly's cut of it to pay for the state it adds: its log
    /// line, the post's pile if this is the first feed on that post this round, the two score
    /// rows if they are new, and the round's record if this is the first feed of the round.
    pub fn feed_floor(&self, account_id: AccountId, post: String) -> U128 {
        let post = PostRef::parse(&post).unwrap_or_else(|why| env::panic_str(&format!("SQUAWK[POST] {why}")));
        let key = post.key();
        let round_now = self.round_at(env::block_timestamp_ms());
        let new_round = round_now > self.round;
        let (feeder, post_len, writer) = (account_id.len() as u64, key.len() as u64, post.author.len() as u64);

        // Each stored row costs its key, its value and 40 bytes of overhead.
        let mut bytes = 119 + feeder + post_len;
        if new_round || self.pots.get(&(self.round, key)).is_none() {
            bytes += (109 + 2 * post_len) + (57 + post_len);
        }
        if self.writers.get(&post.author).is_none() {
            bytes += 85 + writer;
        }
        if self.patrons.get(&account_id).is_none() {
            bytes += 97 + feeder;
        }
        if new_round || self.round_fed == 0 {
            bytes += RECORD_BYTES;
        }
        let cut_bps = self.rules.cut_bps(self.streak_at(round_now)) as u128;
        let cost = bytes as u128 * env::storage_byte_cost().as_yoctonear();
        let floor = (cost * BPS).div_ceil(cut_bps * self.rules.yocto_per_unit.0);
        U128(floor.max(self.rules.min_feed.0))
    }

    /// What Polly's near.social profile says about her right now.
    pub fn about(&self) -> String {
        format!(
            "I am Polly, a parrot nobody owns. This account is a smart contract with no keys, so it is \
             fully automated. Feed me crackers ($SQUAWK) to tip any post on near.social: the writer is \
             paid in NEAR at once, and every round I squawk the best-fed post. Streak: {} (best {}). \
             Squawks: {}. Sent to writers: {} NEAR. {}",
            self.streak,
            self.best_streak,
            self.squawks,
            near3(self.tipped),
            self.website
        )
    }
}

// ----- how the rules are kept ---------------------------------------------------------------

impl Squawk {
    fn round_at(&self, ms: u64) -> u64 {
        (ms - self.genesis_ms) / self.rules.round_ms.0
    }

    fn round_start_ms(&self, round: u64) -> u64 {
        self.genesis_ms + round * self.rules.round_ms.0
    }

    /// The streak once every round before `round_now` is counted, without changing anything.
    fn streak_at(&self, round_now: u64) -> u32 {
        if round_now <= self.round {
            return self.streak;
        }
        if round_now > self.round + 1 {
            return 0;
        }
        if self.round_fed > 0 && self.round_fed >= self.rules.target.0 { self.streak + 1 } else { 0 }
    }

    /// NEAR held for the crackers in circulation. It is computed, never stored, so it can't drift.
    fn nest(&self) -> u128 {
        self.token.total_supply * self.rules.yocto_per_unit.0
    }

    fn storage_cost(&self) -> u128 {
        env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear()
    }

    /// Everything the balance must cover before a single yocto is Polly's to spend: the nest, the
    /// storage, what is held for registered accounts, and a little slack.
    fn owed(&self) -> u128 {
        let slack = SLACK_BYTES as u128 * env::storage_byte_cost().as_yoctonear();
        self.nest() + self.storage_cost() + self.deposits + slack
    }

    /// NEAR Polly can spend right now. This call's own deposit is not hers yet.
    fn spare(&self) -> u128 {
        let balance = env::account_balance().as_yoctonear() - env::attached_deposit().as_yoctonear();
        balance.saturating_sub(self.owed())
    }

    /// Every call that moves NEAR or adds state ends here. If the balance didn't cover what is
    /// owed, the call is undone.
    fn assert_solvent(&mut self) {
        self.flush();
        require!(
            env::account_balance().as_yoctonear() >= self.owed(),
            "SQUAWK[HOARD] Polly's hoard can't cover this. Anyone can refill it by sending NEAR to this account"
        );
    }

    /// Registers `account` as a holder and returns the fee to charge for it. The fee pays for
    /// the longest possible name. Whatever this name leaves unused is recorded as held for the
    /// account, because the whole fee is returned when it leaves.
    fn register(&mut self, account: &AccountId) -> u128 {
        let fee = self.token.storage_balance_bounds().min.as_yoctonear();
        let before = env::storage_usage();
        self.token.internal_register_account(account);
        let row = (env::storage_usage() - before) as u128 * env::storage_byte_cost().as_yoctonear();
        self.deposits += fee.saturating_sub(row);
        fee
    }

    /// Writes pending changes to storage, so `env::storage_usage` is exact.
    pub(crate) fn flush(&mut self) {
        self.meta.flush();
        self.pots.flush();
        self.index.flush();
        self.records.flush();
        self.log.flush();
        self.writers.flush();
        self.patrons.flush();
    }

    /// Counts the round that has ended, if one has. Called at the start of `bake`, `feed` and
    /// `squawk`, so the contract needs no keeper: whoever shows up first wakes Polly.
    fn wake(&mut self, waker: &AccountId) -> bool {
        let now = env::block_timestamp_ms();
        let round_now = self.round_at(now);
        if round_now <= self.round {
            return false;
        }
        let closed = self.round;
        let streak_before = self.streak;
        let mut squawked = false;
        let mut batch = Batch::new();

        // The best-fed post of the round that ended, and its pile. Every fed round has one. This
        // is written so that nothing here can stop the call: a coin with no keys must never be
        // left in a state where waking Polly fails.
        let fed = self.round_fed;
        let winner = self.top.take().filter(|_| fed > 0).and_then(|top| {
            let post = PostRef::parse(&top).ok()?;
            let pot = self.pots.get(&(closed, top.clone())).cloned()?;
            Some((top, post, pot))
        });
        if let Some((top, top_ref, pot)) = winner {
            squawked = self.round_fed >= self.rules.target.0;
            if squawked {
                self.streak += 1;
                self.best_streak = self.best_streak.max(self.streak);
                self.squawks += 1;
                let mut earned = self.writers.get(&top_ref.author).cloned().unwrap_or_default();
                earned.squawks += 1;
                self.writers.insert(top_ref.author.clone(), earned);

                // Said carefully. The winner is the heaviest pile, which need not be the largest,
                // and a tip is sent, which is not the same as received if the account is missing.
                let text = format!(
                    "\u{1F99C} SQUAWK #{}! The flock fed me {} crackers this round. This post came out \
                     on top with {} crackers, and {} NEAR was sent to its writer. Streak: {}. #squawk",
                    self.squawks,
                    crackers(self.round_fed),
                    crackers(pot.fed.0),
                    near3(pot.tipped.0),
                    self.streak
                );
                batch = batch.quote(now, &text, &top_ref).like(&top_ref).follow(&top_ref.author);
            } else {
                self.streak = 0;
            }

            self.records.push(Record {
                round: U64(closed),
                fed: U128(self.round_fed),
                posts: self.round_posts,
                squawked,
                top,
                pile: pot.fed,
                tipped: pot.tipped,
                streak: self.streak,
                woken_ms: U64(now),
                woken_by: waker.clone(),
                bounty: U128(0),
                polly_post: squawked.then_some(U64(now)),
            });
            emit(
                if squawked { "squawk" } else { "miss" },
                json!({ "round": U64(closed), "fed": U128(self.round_fed), "streak": self.streak }),
            );
        } else {
            self.streak = 0;
        }
        // Rounds in which nobody called at all were empty, and an empty round breaks the streak.
        if round_now > closed + 1 {
            self.streak = 0;
        }

        let earned = self.round_surplus;
        self.round = round_now;
        self.round_fed = 0;
        self.round_posts = 0;
        self.top = None;
        self.top_weight = 0;
        self.round_surplus = 0;

        if squawked || self.streak != streak_before {
            batch = batch.profile("about", &self.about());
        }
        batch.send(&self.rules.social);

        // The round's record is written here and now. Its bytes were paid for by the first feed
        // of that round, so they must not land on whichever call happened to wake Polly.
        self.flush();
        if squawked {
            // The bounty comes out of what the round itself added to the hoard, and no more. A
            // round fed only by feeds at their floor earned the hoard nothing and pays nothing.
            let bounty = self.rules.wake_bounty.0.min(earned).min(self.spare());
            if bounty > 0 {
                Promise::new(waker.clone()).transfer(NearToken::from_yoctonear(bounty)).detach();
                self.bounties += bounty;
                let last = self.records.len() - 1;
                self.records[last].bounty = U128(bounty);
            }
        }
        true
    }
}

// ----- NEP-141, NEP-145 and NEP-148 ----------------------------------------------------------

#[near]
impl FungibleTokenCore for Squawk {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Squawk {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        // The standard burns a refund whose sender has unregistered meanwhile. SQUAWK burns only
        // in `feed`, so here the receiver keeps the crackers instead.
        if !self.token.accounts.contains_key(&sender_id) {
            return amount;
        }
        self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount).0.into()
    }
}

#[near]
impl StorageManagement for Squawk {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let who = account_id.clone().unwrap_or_else(env::predecessor_account_id);
        // Crackers sent to Polly herself could never be fed, so she can't hold any.
        require!(who != env::current_account_id(), "SQUAWK[SELF] Polly holds no crackers");
        let before = env::storage_usage();
        let balance = self.token.storage_deposit(account_id, registration_only);
        let grown = env::storage_usage() - before;
        if grown > 0 {
            // A new holder. The fee covers the longest possible name, and the part this name
            // doesn't use is held for the account, since the whole fee goes back when it leaves.
            let row = grown as u128 * env::storage_byte_cost().as_yoctonear();
            self.deposits += balance.total.as_yoctonear().saturating_sub(row);
        }
        self.assert_solvent();
        balance
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// Leaving is allowed with an empty balance only. Leaving with crackers would burn them
    /// outside `feed`, and the only way to burn SQUAWK is to feed Polly.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let _ = force;
        let who = env::predecessor_account_id();
        require!(
            self.token.accounts.get(&who).unwrap_or(0) == 0,
            "SQUAWK[CRUMBS] feed or send your crackers before leaving"
        );
        let fee = self.token.storage_balance_bounds().min.as_yoctonear();
        let before = env::storage_usage();
        let left = self.token.internal_storage_unregister(None).is_some();
        if left {
            // The whole fee was just sent back: the row's own bytes, now free, and the part that
            // was being held for the account.
            let row = (before - env::storage_usage()) as u128 * env::storage_byte_cost().as_yoctonear();
            self.deposits = self.deposits.saturating_sub(fee.saturating_sub(row));
        }
        self.assert_solvent();
        left
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Squawk {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.meta.get().clone()
    }
}

// ----- small helpers -------------------------------------------------------------------------

fn page<T: Clone + near_sdk::borsh::BorshSerialize + near_sdk::borsh::BorshDeserialize>(
    rows: &Vector<T>,
    from: Option<u32>,
    limit: Option<u32>,
) -> Vec<T> {
    let from = from.unwrap_or(0);
    let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE);
    (from..from.saturating_add(limit)).map_while(|n| rows.get(n).cloned()).collect()
}

/// A NEP-297 event under the standard name `squawk`.
fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "squawk", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

/// Whole crackers with thousands separators, rounded down: `1234567`.
pub(crate) fn crackers(units: u128) -> String {
    let digits = (units / ONE).to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// NEAR with three decimals, rounded down.
pub(crate) fn near3(yocto: u128) -> String {
    let milli = yocto / 1_000_000_000_000_000_000_000;
    format!("{}.{:03}", milli / 1_000, milli % 1_000)
}
