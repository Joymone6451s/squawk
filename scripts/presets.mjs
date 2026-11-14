// The two sets of launch rules. Every number here is written into the contract once, at launch,
// and can never be changed afterwards. docs/SIMULATION.md explains how they were chosen.
import { NEAR, ONE } from "./lib.mjs";

// The token icon: a small parrot, stored on chain as an SVG data URI.
export const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>" +
      "<circle cx='48' cy='48' r='48' fill='#ffd447'/>" +
      "<path d='M24 74c-6-28 4-54 28-54 15 0 24 11 24 24 0 18-14 32-32 32-8 0-15-1-20-2z' fill='#12a36d'/>" +
      "<path d='M60 34c9 0 15 6 15 13 0 7-4 11-9 13 1-7-1-11-6-13z' fill='#ff6b35'/>" +
      "<path d='M30 60c8 2 16 0 22-6-2 10-10 16-20 16z' fill='#0b7a52'/>" +
      "<circle cx='52' cy='37' r='6' fill='#fff'/><circle cx='53.5' cy='37' r='3' fill='#1b1b1f'/>" +
      "</svg>",
  );

const base = {
  yocto_per_unit: "1000", // 0.001 NEAR bakes one cracker (18 decimals)
  min_feed: ONE.toString(),
  cut_max_bps: 2_500,
  cut_min_bps: 1_000,
  cut_step_bps: 100,
  late_weight_bps: 2_500,
  social: "social",
};

export const PRESETS = {
  // The real coin: one round a day, ending at midnight UTC.
  daily: {
    name: "Squawk",
    symbol: "SQUAWK",
    profile_name: "Polly, the parrot nobody owns",
    rules: {
      ...base,
      round_ms: String(24 * 60 * 60 * 1000),
      target: (500n * ONE).toString(),
      wake_bounty: (NEAR / 100n).toString(),
    },
  },
  // The same contract on fast-forward, so a full round fits in a demo: five-minute rounds.
  speedrun: {
    name: "Squawk Speedrun",
    symbol: "SQUAWK5",
    profile_name: "Polly on fast-forward",
    rules: {
      ...base,
      round_ms: String(5 * 60 * 1000),
      target: (150n * ONE).toString(),
      wake_bounty: (NEAR / 500n).toString(),
    },
  },
};
