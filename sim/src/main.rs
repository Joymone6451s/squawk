//! Sixty days of community behaviour, run through the real SQUAWK contract.
//!
//!   cargo run -p squawk-sim --release -- scenarios sim/out     the eight scenarios, launch rules
//!   cargo run -p squawk-sim --release -- sweep sim/out         every rule set in the grid
//!
//! Nothing here re-implements a rule. Each simulated person calls `bake`, `feed` or `squawk` on
//! the contract itself, so the numbers are what the chain would compute.

mod world;

use std::fs;
use std::path::Path;

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::{Value, json};
use squawk::{ONE, Rules};
use world::{NEAR, Rng, T0, World};

const DAY: u64 = 86_400_000;
const DAYS: u32 = 60;
const MINUTE: u64 = 60_000;
/// How many different accounts tip over the two months.
const FAN_POOL: u64 = 80;
/// Posts worth tipping on any one day. Their pull follows 1, 1/2, 1/3 and so on.
const POSTS_PER_DAY: usize = 6;
/// The middle tip, in crackers. Half of all tips are smaller.
const MEDIAN_TIP: f64 = 35.0;
const TIP_SPREAD: f64 = 0.8;
const PROMOTER: &str = "promoter.near";

/// The rules the coin launches with. `docs/SIMULATION.md` says why.
pub fn launch_rules() -> Rules {
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
        social: "social".parse().unwrap(),
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Promoter {
    None,
    /// Feeds their own post at midday, every day, with enough to lead.
    Hog,
    /// Feeds their own post in the last minute of the round.
    Sniper,
}

#[derive(Clone, Copy)]
struct Scenario {
    key: &'static str,
    title: &'static str,
    blurb: &'static str,
    /// How many fans are expected to tip on day `d`, counting from 0.
    fans: fn(u32) -> f64,
    promoter: Promoter,
    /// Each tip is split across this many accounts. 1 means no sybils.
    split: u32,
    /// A bot wakes Polly one minute into every round.
    bot: bool,
}

const SCENARIOS: [Scenario; 8] = [
    Scenario {
        key: "steady",
        title: "Steady flock",
        blurb: "About 14 people tip every day.",
        fans: |_| 14.0,
        promoter: Promoter::None,
        split: 1,
        bot: true,
    },
    Scenario {
        key: "growth",
        title: "Slow start, then it catches on",
        blurb: "From 2 tippers a day to about 30 by the end.",
        fans: |d| 2.0 + 28.0 / (1.0 + (-(d as f64 - 25.0) / 6.0).exp()),
        promoter: Promoter::None,
        split: 1,
        bot: true,
    },
    Scenario {
        key: "fade",
        title: "Hype, then it fades",
        blurb: "30 tippers on day one, halving about every 8 days.",
        fans: |d| 30.0 * (-(d as f64) / 12.0).exp(),
        promoter: Promoter::None,
        split: 1,
        bot: true,
    },
    Scenario {
        key: "weekend",
        title: "Quiet weekends",
        blurb: "14 tippers on weekdays, 2 on Saturday and Sunday.",
        fans: |d| if d % 7 >= 5 { 2.0 } else { 14.0 },
        promoter: Promoter::None,
        split: 1,
        bot: true,
    },
    Scenario {
        key: "hog",
        title: "One loud self-promoter",
        blurb: "The steady flock, plus one account that buys the squawk for its own post every day.",
        fans: |_| 14.0,
        promoter: Promoter::Hog,
        split: 1,
        bot: true,
    },
    Scenario {
        key: "sniper",
        title: "Last-minute sniper",
        blurb: "The same self-promoter, feeding in the final minute of each round.",
        fans: |_| 14.0,
        promoter: Promoter::Sniper,
        split: 1,
        bot: true,
    },
    Scenario {
        key: "sybil",
        title: "Sybil swarm",
        blurb: "The steady flock, tip for tip, but every tip is split across up to 10 accounts.",
        fans: |_| 14.0,
        promoter: Promoter::None,
        split: 10,
        bot: true,
    },
    Scenario {
        key: "ghost",
        title: "Ghost town",
        blurb: "A tip every two or three days, and nobody waking Polly on time.",
        fans: |_| 0.4,
        promoter: Promoter::None,
        split: 1,
        bot: false,
    },
];

/// One day of one scenario, as the contract reported it.
#[derive(Clone, Default)]
struct Row {
    day: u32,
    tippers: u32,
    feeds: u32,
    /// Crackers, in whole units.
    fed: f64,
    supply: f64,
    baked: f64,
    eaten: f64,
    /// NEAR.
    nest: f64,
    hoard: f64,
    tipped: f64,
    cut_bps: u32,
    streak: u32,
    squawked: bool,
    /// Whether the best-fed post was the promoter's.
    promoter_won: bool,
}

struct Outcome {
    rows: Vec<Row>,
    squawks: u32,
    best_streak: u32,
    /// Share of all NEAR in eaten crackers that reached writers.
    writer_share: f64,
    /// NEAR the fans spent, and how much of it reached the writers they picked.
    fans_spent: f64,
    /// NEAR the promoter paid in, got back as tips to themselves, and lost for good.
    promoter_in: f64,
    promoter_back: f64,
    promoter_wins: u32,
    /// Storage fees and registrations paid on top of the tips themselves.
    accounts: u32,
    bounty_paid: f64,
    hoard_low: f64,
    hoard_end: f64,
    polly_posts: u32,
    calls: u64,
}

fn near(yocto: u128) -> f64 {
    yocto as f64 / NEAR as f64
}

fn whole(units: u128) -> f64 {
    units as f64 / ONE as f64
}

enum Who {
    Bot,
    Fan { fan: u64, post: usize, crackers: f64 },
    Promoter,
}

fn run(s: &Scenario, rules: &Rules, seed: u64) -> Outcome {
    let mut w = World::new(rules.clone());
    let mut rng = Rng::new(seed);
    let price = rules.yocto_per_unit.0;
    let pull: Vec<f64> = (1..=POSTS_PER_DAY).map(|n| 1.0 / n as f64).collect();
    let mut rows = Vec::with_capacity(DAYS as usize);
    let mut accounts = std::collections::BTreeSet::new();
    let mut hoard_low = f64::MAX;
    let mut promoter_wins = 0;

    // Makes sure `who` holds `units`, baking in 0.1 NEAR steps when short.
    let top_up = |w: &mut World, who: &str, units: u128| {
        let have = w.balance_of(who);
        if have < units {
            let short = (units - have) * price;
            let tenth = NEAR / 10;
            w.bake(who, (short / tenth + 2) * tenth);
        }
    };

    for day in 0..DAYS {
        let start = T0 + day as u64 * DAY;
        let mut events: Vec<(u64, Who)> = Vec::new();
        if s.bot {
            events.push((start + MINUTE, Who::Bot));
        }
        let tippers = rng.poisson((s.fans)(day));
        for _ in 0..tippers {
            let at = start + 5 * MINUTE + rng.below(DAY - 10 * MINUTE);
            let crackers = (MEDIAN_TIP * (TIP_SPREAD * rng.normal()).exp()).clamp(5.0, 400.0);
            events.push((at, Who::Fan { fan: rng.below(FAN_POOL), post: rng.pick(&pull), crackers }));
        }
        match s.promoter {
            Promoter::Hog => events.push((start + DAY / 2, Who::Promoter)),
            Promoter::Sniper => events.push((start + DAY - MINUTE, Who::Promoter)),
            Promoter::None => {}
        }
        events.sort_by_key(|(at, _)| *at);

        let mut feeds = 0;
        for (at, who) in events {
            w.now = at;
            match who {
                Who::Bot => {
                    w.squawk("bot.near");
                }
                Who::Fan { fan, post, crackers } => {
                    let post = format!("writer{post}.near/{}", 1_000 + day);
                    // A sybil spreads the same tip over several accounts. The total stays the
                    // same, so the only question is whether splitting buys anything.
                    let total = (crackers * ONE as f64) as u128;
                    let each = total / s.split as u128;
                    let mut left = total;
                    for part in 0..s.split {
                        let who = if s.split == 1 { format!("fan{fan}.near") } else { format!("fan{fan}-{part}.near") };
                        let floor = w.c_feed_floor(&who, &post);
                        // The last account, or the last one the tip can still feed, takes the rest.
                        let last = part + 1 == s.split || left < each.max(floor) + floor;
                        let units = if last { left } else { each.max(floor) }.max(floor);
                        accounts.insert(who.clone());
                        top_up(&mut w, &who, units);
                        w.feed(&who, &post, units);
                        feeds += 1;
                        left = left.saturating_sub(units);
                        if last {
                            break;
                        }
                    }
                }
                Who::Promoter => {
                    // Enough to lead by a tenth, and enough for the round to reach its target.
                    let post = format!("{PROMOTER}/{}", 1_000 + day);
                    let st = w.status();
                    let lead = st.top_weight.0 * 11 / 10 * 10_000 / st.weight_bps as u128 + ONE;
                    let reach = st.target.0.saturating_sub(st.fed.0);
                    let units = lead.max(reach).max(w.c_feed_floor(PROMOTER, &post));
                    top_up(&mut w, PROMOTER, units);
                    w.feed(PROMOTER, &post, units);
                    feeds += 1;
                }
            }
            hoard_low = hoard_low.min(near(w.status().hoard.0));
        }

        // The last millisecond of the round: what the flock did today.
        w.now = start + DAY - 1;
        let end = w.status();
        // One millisecond into the next round the contract already knows how today went.
        w.now = start + DAY + 1;
        let after = w.status();
        let promoter_won = after.waiting_squawk && end.top.as_deref().is_some_and(|t| t.starts_with(PROMOTER));
        promoter_wins += promoter_won as u32;
        rows.push(Row {
            day: day + 1,
            tippers,
            feeds,
            fed: whole(end.fed.0),
            supply: whole(end.supply.0),
            baked: whole(end.baked.0),
            eaten: whole(end.eaten.0),
            nest: near(end.nest.0),
            hoard: near(end.hoard.0),
            tipped: near(end.tipped.0),
            cut_bps: end.cut_bps,
            streak: after.streak,
            squawked: after.waiting_squawk,
            promoter_won,
        });
    }
    // Count the last round too, so the totals include it.
    w.now = T0 + DAYS as u64 * DAY + MINUTE;
    w.squawk("bot.near");
    let end = w.status();

    let fans_spent: u128 = w.spent.iter().filter(|(who, _)| who.starts_with("fan")).map(|(_, n)| n).sum();
    Outcome {
        squawks: end.squawks.0 as u32,
        best_streak: end.best_streak,
        writer_share: if end.eaten.0 == 0 { 0.0 } else { end.tipped.0 as f64 / (end.eaten.0 * price) as f64 },
        fans_spent: near(fans_spent),
        promoter_in: near(w.spent(PROMOTER)),
        promoter_back: near(w.received(PROMOTER)),
        promoter_wins,
        accounts: accounts.len() as u32,
        bounty_paid: near(end.bounties.0),
        hoard_low: if hoard_low == f64::MAX { near(end.hoard.0) } else { hoard_low },
        hoard_end: near(end.hoard.0),
        polly_posts: w.posts,
        calls: w.calls,
        rows,
    }
}

fn rows_json(rows: &[Row]) -> Value {
    Value::Array(
        rows.iter()
            .map(|r| {
                json!({
                    "day": r.day, "tippers": r.tippers, "feeds": r.feeds, "fed": r.fed, "supply": r.supply,
                    "baked": r.baked, "eaten": r.eaten, "nest": r.nest, "hoard": r.hoard, "tipped": r.tipped,
                    "cut_bps": r.cut_bps, "streak": r.streak, "squawked": r.squawked, "promoter_won": r.promoter_won,
                })
            })
            .collect(),
    )
}

fn outcome_json(s: &Scenario, o: &Outcome) -> Value {
    let last = o.rows.last().cloned().unwrap_or_default();
    json!({
        "key": s.key, "title": s.title, "blurb": s.blurb,
        "squawks": o.squawks, "hit_rate": o.squawks as f64 / DAYS as f64, "best_streak": o.best_streak,
        "writer_share": o.writer_share, "fans_spent": o.fans_spent,
        "promoter_in": o.promoter_in, "promoter_back": o.promoter_back, "promoter_wins": o.promoter_wins,
        "accounts": o.accounts, "bounty_paid": o.bounty_paid,
        "hoard_low": o.hoard_low, "hoard_end": o.hoard_end, "polly_posts": o.polly_posts, "calls": o.calls,
        "baked": last.baked, "eaten": last.eaten, "supply": last.supply, "nest": last.nest, "tipped": last.tipped,
        "rows": rows_json(&o.rows),
    })
}

fn scenarios(out: &Path) {
    let rules = launch_rules();
    let mut all = Vec::new();
    println!("{:<8} {:>7} {:>6} {:>8} {:>9} {:>9} {:>9} {:>9} {:>8}", "scenario", "squawks", "best", "writers", "baked", "eaten", "supply", "tips NEAR", "hoard");
    for s in &SCENARIOS {
        let o = run(s, &rules, 7);
        let last = o.rows.last().unwrap();
        println!(
            "{:<8} {:>7} {:>6} {:>7.1}% {:>9.0} {:>9.0} {:>9.0} {:>9.2} {:>8.3}",
            s.key, o.squawks, o.best_streak, o.writer_share * 100.0, last.baked, last.eaten, last.supply, last.tipped, o.hoard_end
        );
        all.push(outcome_json(s, &o));
    }
    let doc = json!({
        "days": DAYS,
        "rules": rules,
        "model": {
            "fan_pool": FAN_POOL, "posts_per_day": POSTS_PER_DAY, "median_tip_crackers": MEDIAN_TIP,
            "tip_spread_sigma": TIP_SPREAD, "seed": 7,
        },
        "scenarios": all,
    });
    fs::create_dir_all(out).unwrap();
    fs::write(out.join("scenarios.json"), near_sdk::serde_json::to_string_pretty(&doc).unwrap()).unwrap();
    println!("wrote {}", out.join("scenarios.json").display());
}

/// One row of the sweep: a rule set, run through every scenario but the sybil swarm with three
/// seeds. The sybil swarm is ten times the calls and its answer doesn't depend on these rules.
fn sweep_row(target: u128, cut_max: u32, cut_min: u32, step: u32, late: u32) -> String {
    const SEEDS: [u64; 3] = [7, 11, 13];
    let mut rules = launch_rules();
    rules.target = U128(target * ONE);
    rules.cut_max_bps = cut_max;
    rules.cut_min_bps = cut_min;
    rules.cut_step_bps = step;
    rules.late_weight_bps = late;
    // Keep the bounty inside what the smallest round that hits its target brings in.
    let least = target * ONE * rules.yocto_per_unit.0 * cut_min as u128 / 10_000;
    rules.wake_bounty = U128((NEAR / 100).min(least));

    let n = SEEDS.len() as f64;
    let mut hit = std::collections::BTreeMap::new();
    let (mut share, mut best, mut low) = (0.0, 0.0, f64::MAX);
    let (mut hog_wins, mut hog_lost, mut snipe_wins, mut snipe_lost) = (0.0, 0.0, 0.0, 0.0);
    for seed in SEEDS {
        for s in SCENARIOS.iter().filter(|s| s.split == 1) {
            let o = run(s, &rules, seed);
            *hit.entry(s.key).or_insert(0.0) += o.squawks as f64 / DAYS as f64 / n;
            low = low.min(o.hoard_low);
            match s.key {
                "steady" => {
                    share += o.writer_share / n;
                    best += o.best_streak as f64 / n;
                }
                "hog" => {
                    hog_wins += o.promoter_wins as f64 / n;
                    hog_lost += (o.promoter_in - o.promoter_back) / n;
                }
                "sniper" => {
                    snipe_wins += o.promoter_wins as f64 / n;
                    snipe_lost += (o.promoter_in - o.promoter_back) / n;
                }
                _ => {}
            }
        }
    }
    // What a lone promoter must lose to buy one squawk when nobody else feeds: Polly's cut of
    // exactly the target. And the smallest first feed of a round, which pays for the round's record.
    let floor = |cut: u32| target as f64 * 0.001 * cut as f64 / 10_000.0;
    let opener = |cut: u32| 1_030.0 * 0.00001 / (cut as f64 / 10_000.0) / 0.001;
    let per = |lost: f64, wins: f64| if wins > 0.0 { lost / wins } else { 0.0 };
    format!(
        "{target},{cut_max},{cut_min},{step},{late},{:.3},{:.3},{:.3},{:.3},{:.3},{:.4},{:.1},{:.1},{:.4},{:.1},{:.4},{:.4},{:.4},{:.4},{:.1},{:.1}",
        hit["steady"], hit["growth"], hit["fade"], hit["weekend"], hit["ghost"], share, best,
        hog_wins, per(hog_lost, hog_wins), snipe_wins, per(snipe_lost, snipe_wins),
        low, floor(cut_max), floor(cut_min), opener(cut_max), opener(cut_min),
    )
}

/// Every rule set in the grid, spread over the machine's cores. The mocked chain is one per
/// thread, so the runs can't disturb each other.
fn sweep(out: &Path) {
    let mut grid = Vec::new();
    for target in [250u128, 500, 750, 1_000] {
        for cut_max in [1_500u32, 2_500, 3_500] {
            for cut_min in [500u32, 1_000] {
                for step in [50u32, 100, 200] {
                    for late in [2_500u32, 5_000, 10_000] {
                        grid.push((target, cut_max, cut_min, step, late));
                    }
                }
            }
        }
    }
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let next = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let grid = std::sync::Arc::new(grid);
    let handles: Vec<_> = (0..workers)
        .map(|_| {
            let (next, grid) = (next.clone(), grid.clone());
            std::thread::spawn(move || {
                let mut rows = Vec::new();
                loop {
                    let i = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let Some(&(target, cut_max, cut_min, step, late)) = grid.get(i) else { break };
                    rows.push((i, sweep_row(target, cut_max, cut_min, step, late)));
                }
                rows
            })
        })
        .collect();
    let mut rows: Vec<(usize, String)> = handles.into_iter().flat_map(|h| h.join().unwrap()).collect();
    rows.sort();
    let mut lines = vec![String::from(
        "target,cut_max_bps,cut_min_bps,cut_step_bps,late_weight_bps,steady_hit,growth_hit,fade_hit,weekend_hit,ghost_hit,steady_writer_share,steady_best_streak,hog_wins,hog_cost_per_win,sniper_wins,sniper_cost_per_win,hoard_low,megaphone_floor_start,megaphone_floor_long_streak,opener_crackers_start,opener_crackers_long_streak",
    )];
    lines.extend(rows.into_iter().map(|(_, line)| line));
    fs::create_dir_all(out).unwrap();
    fs::write(out.join("sweep.csv"), lines.join("
") + "
").unwrap();
    println!("wrote {} rule sets to {}", grid.len(), out.join("sweep.csv").display());
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = Path::new(args.get(2).map(String::as_str).unwrap_or("sim/out"));
    match args.get(1).map(String::as_str) {
        Some("scenarios") => scenarios(out),
        Some("sweep") => sweep(out),
        _ => {
            eprintln!("usage: squawk-sim <scenarios|sweep> [out-dir]");
            std::process::exit(1);
        }
    }
}
