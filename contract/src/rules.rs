//! The laws of one SQUAWK coin. They are set once, in `new`, checked there, and never written
//! again: the contract has no owner, no setter and no pause.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, env, near, require};

use crate::BPS;

/// Shortest round a coin may run: five minutes. Polly posts at most once a round, and near.social
/// accepts 300 posts a day from one account, so this keeps her inside that limit (288 a day).
pub const MIN_ROUND_MS: u64 = 300_000;
/// Longest round: 31 days.
pub const MAX_ROUND_MS: u64 = 31 * 24 * 60 * 60 * 1000;
/// Polly may never take more than this share of a tip.
pub const MAX_CUT_BPS: u32 = 5_000;
/// Polly must take at least this much, or feeding your own post would be free.
pub const MIN_CUT_BPS: u32 = 100;
/// A late cracker must still weigh at least this much.
pub const MIN_LATE_WEIGHT_BPS: u32 = 1_000;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    /// Length of one round, in milliseconds.
    pub round_ms: U64,
    /// NEAR, in yocto, baked into one base unit of SQUAWK. This is the price of baking, for ever.
    pub yocto_per_unit: U128,
    /// Base units the flock must feed in one round for Polly to squawk.
    pub target: U128,
    /// The smallest feed, in base units.
    pub min_feed: U128,
    /// Polly's cut of a tip when there is no streak, in basis points.
    pub cut_max_bps: u32,
    /// Polly's smallest cut, reached after a long enough streak.
    pub cut_min_bps: u32,
    /// How far the cut falls for each round of streak.
    pub cut_step_bps: u32,
    /// What a cracker fed at the very end of a round weighs toward the squawk. A cracker fed at
    /// the start weighs 10000, and the weight falls in a straight line between the two.
    pub late_weight_bps: u32,
    /// Paid from the hoard, in yocto, to whoever wakes Polly for a squawk.
    pub wake_bounty: U128,
    /// The account Polly posts to: `social` on mainnet.
    pub social: AccountId,
}

fn fail(rule: &str, why: &str) -> ! {
    env::panic_str(&format!("SQUAWK[RULES] {rule}: {why}"))
}

impl Rules {
    /// Stops the launch if any rule could jam the coin or break a promise the README makes.
    pub fn check(&self) {
        if self.round_ms.0 < MIN_ROUND_MS || self.round_ms.0 > MAX_ROUND_MS {
            fail("round_ms", "a round lasts between five minutes and 31 days");
        }
        if self.yocto_per_unit.0 == 0 {
            fail("yocto_per_unit", "a cracker must cost something to bake");
        }
        if self.min_feed.0 == 0 {
            fail("min_feed", "a feed must burn something");
        }
        if self.target.0 < self.min_feed.0 {
            fail("target", "the target can't be smaller than one feed");
        }
        // The value of the whole target must fit in a u128 with room to spare, so no later
        // multiplication by the price or by 10000 can overflow.
        let target_value = self.target.0.checked_mul(self.yocto_per_unit.0);
        if target_value.and_then(|v| v.checked_mul(BPS * BPS)).is_none() {
            fail("target", "target times price is too large");
        }
        if self.cut_min_bps < MIN_CUT_BPS {
            fail("cut_min_bps", "Polly's cut must be at least 1%, or feeding your own post is free");
        }
        if self.cut_max_bps > MAX_CUT_BPS {
            fail("cut_max_bps", "Polly's cut can't be more than half of a tip");
        }
        if self.cut_min_bps > self.cut_max_bps {
            fail("cut_min_bps", "the smallest cut can't be above the largest");
        }
        if self.late_weight_bps < MIN_LATE_WEIGHT_BPS || self.late_weight_bps as u128 > BPS {
            fail("late_weight_bps", "a late cracker weighs between 10% and 100% of an early one");
        }
        // A round that hits its target always brings in at least this much cut, so the bounty for
        // waking Polly is paid for by the round it rewards.
        let least_cut = target_value.unwrap() * self.cut_min_bps as u128 / BPS;
        if self.wake_bounty.0 > least_cut {
            fail("wake_bounty", "the bounty can't be more than the smallest cut of a round that hits its target");
        }
    }

    /// Polly's cut after `streak` rounds in a row that hit the target.
    pub fn cut_bps(&self, streak: u32) -> u32 {
        let room = (self.cut_max_bps - self.cut_min_bps) as u64;
        let fall = (self.cut_step_bps as u64 * streak as u64).min(room);
        self.cut_max_bps - fall as u32
    }

    /// What a cracker weighs toward the squawk when `elapsed_ms` of the round have gone by.
    pub fn weight_bps(&self, elapsed_ms: u64) -> u128 {
        let round = self.round_ms.0 as u128;
        let elapsed = (elapsed_ms as u128).min(round);
        BPS - (BPS - self.late_weight_bps as u128) * elapsed / round
    }
}

/// Checks a string that ends up in Polly's profile: plain printable ASCII, so it can't smuggle
/// anything, and short enough to be a name or a link.
pub fn check_plain(what: &str, text: &str, max: usize) {
    require!(
        !text.is_empty() && text.len() <= max && text.bytes().all(|b| (0x20..0x7f).contains(&b)),
        format!("SQUAWK[RULES] {what}: 1 to {max} plain ASCII characters")
    );
}
