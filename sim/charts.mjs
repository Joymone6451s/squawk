#!/usr/bin/env node
// Draws the simulation's charts as plain SVG files, from sim/out/scenarios.json.
//
//   node sim/charts.mjs
//
// Three figures, written to docs/sim/:
//   supply.svg    crackers in circulation over the 60 days, one small panel per scenario
//   squawks.svg   which days Polly squawked, and whose post it was
//   near.svg      where the NEAR in the eaten crackers went
//
// Every number drawn here is also in the tables of docs/SIMULATION.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const data = JSON.parse(readFileSync(here("./out/scenarios.json"), "utf8"));
const scenarios = data.scenarios;
mkdirSync(here("../docs/sim"), { recursive: true });

// One stylesheet for all three. Colours are roles, so the dark values swap in one place.
const STYLE = `
  .surface { fill: #fcfcfb; }
  .ink { fill: #0b0b0b; }
  .ink2 { fill: #52514e; }
  .muted { fill: #898781; }
  .grid { stroke: #e1e0d9; stroke-width: 1; }
  .axis { stroke: #c3c2b7; stroke-width: 1; }
  .s1 { fill: #2a78d6; }
  .s1-line { stroke: #2a78d6; stroke-width: 2; fill: none; stroke-linejoin: round; stroke-linecap: round; }
  .s1-wash { fill: #2a78d6; fill-opacity: 0.1; }
  .s2 { fill: #eb6834; }
  .quiet { fill: #e1e0d9; }
  .ring { stroke: #fcfcfb; stroke-width: 2; }
  text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .title { font-size: 15px; font-weight: 600; }
  .label { font-size: 12px; }
  .tick { font-size: 11px; font-variant-numeric: tabular-nums; }
  .inside { fill: #ffffff; font-size: 11px; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #1a1a19; }
    .ink { fill: #f0efec; }
    .ink2 { fill: #c3c2b7; }
    .grid { stroke: #2c2c2a; }
    .axis { stroke: #383835; }
    .s1 { fill: #3987e5; }
    .s1-line { stroke: #3987e5; }
    .s1-wash { fill: #3987e5; }
    .s2 { fill: #d95926; }
    .quiet { fill: #2c2c2a; }
    .ring { stroke: #1a1a19; }
  }`;

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (value) => Number(value.toFixed(2));
/** 8,324 under ten thousand, 57.4K above. One style per axis is chosen by the caller. */
const compact = (value) => (value >= 10_000 ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K` : Math.round(value).toLocaleString("en-US"));

function svg(width, height, title, description, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(description)}</desc>
<style>${STYLE}</style>
<rect class="surface" width="${width}" height="${height}" rx="8"/>
${body}
</svg>
`;
}

// ----- Figure 1: crackers in circulation, small multiples --------------------------------------

function supplyChart() {
  const cols = 4;
  const panelW = 262;
  const panelH = 190;
  const padX = 24;
  const top = 64;
  const plot = { left: 40, right: 44, top: 44, bottom: 26 };
  const width = padX * 2 + cols * panelW;
  const height = top + Math.ceil(scenarios.length / cols) * panelH + 30;
  const parts = [
    `<text class="ink title" x="${padX}" y="30" style="font-size:17px">Crackers in circulation over 60 days</text>`,
    `<text class="ink2 label" x="${padX}" y="50">Baked and not yet fed. One panel per scenario, at the launch rules. The sybil panel has its own scale.</text>`,
  ];
  scenarios.forEach((s, i) => {
    const x0 = padX + (i % cols) * panelW;
    const y0 = top + Math.floor(i / cols) * panelH;
    const max = Math.max(...s.rows.map((r) => r.supply));
    // Seven scenarios share one scale, so their panels compare at a glance. The sybil swarm
    // holds ten times the crackers and gets its own.
    const scaleMax = max > 12_000 ? Math.ceil(max / 50_000) * 50_000 : 10_000;
    const w = panelW - plot.left - plot.right;
    const h = panelH - plot.top - plot.bottom;
    const px = (day) => x0 + plot.left + ((day - 1) / (s.rows.length - 1)) * w;
    const py = (value) => y0 + plot.top + h - (value / scaleMax) * h;
    const line = s.rows.map((r, k) => `${k ? "L" : "M"}${n(px(r.day))} ${n(py(r.supply))}`).join("");
    const last = s.rows.at(-1);
    const ticks = [0, scaleMax / 2, scaleMax];
    parts.push(`<g>
  <text class="ink title" x="${x0 + plot.left}" y="${y0 + 16}">${esc(s.title)}</text>
  <text class="ink2 label" x="${x0 + plot.left}" y="${y0 + 32}">${esc(s.squawks)} squawks${scaleMax > 10_000 ? `, scale to ${compact(scaleMax)}` : ""}</text>
  ${ticks.map((t) => `<line class="${t === 0 ? "axis" : "grid"}" x1="${x0 + plot.left}" x2="${x0 + plot.left + w}" y1="${n(py(t))}" y2="${n(py(t))}"/><text class="muted tick" x="${x0 + plot.left - 6}" y="${n(py(t) + 4)}" text-anchor="end">${t === 0 ? "0" : `${t / 1000}K`}</text>`).join("")}
  <path class="s1-wash" d="${line}L${n(px(last.day))} ${n(py(0))}L${n(px(1))} ${n(py(0))}Z"/>
  <path class="s1-line" d="${line}"><title>${esc(s.title)}: ${compact(s.rows[0].supply)} crackers on day 1, ${compact(last.supply)} on day ${last.day}, peak ${compact(max)}</title></path>
  <circle class="s1 ring" cx="${n(px(last.day))}" cy="${n(py(last.supply))}" r="4.5"/>
  <text class="ink tick" x="${n(px(last.day) + 8)}" y="${n(py(last.supply) + 4)}">${compact(last.supply)}</text>
  ${[1, 30, 60].map((d) => `<text class="muted tick" x="${n(px(d))}" y="${y0 + plot.top + h + 15}" text-anchor="${d === 1 ? "start" : d === 60 ? "end" : "middle"}">${d === 1 ? "day 1" : d}</text>`).join("")}
</g>`);
  });
  return svg(width, height, "Crackers in circulation over 60 days, by scenario", "Eight small line charts of SQUAWK supply over 60 simulated days. Supply stays between about 4,000 and 10,000 crackers in every scenario except the sybil swarm, where idle balances across 800 accounts push it to about 57,000.", parts.join("\n"));
}

// ----- Figure 2: which days Polly squawked -----------------------------------------------------

function squawkChart() {
  const cell = 12;
  const gap = 2;
  const rowH = 30;
  const left = 232;
  const top = 104;
  const days = scenarios[0].rows.length;
  const width = left + days * (cell + gap) + 96;
  const height = top + scenarios.length * rowH + 34;
  const legendY = 78;
  const legend = [
    ["s1", "Polly squawked the flock's pick"],
    ["s2", "Polly squawked the self-promoter's post"],
    ["quiet", "No squawk: the flock fed less than the target"],
  ];
  let lx = 24;
  const legendParts = legend.map(([cls, text]) => {
    const part = `<rect class="${cls}" x="${lx}" y="${legendY - 10}" width="12" height="12" rx="2"/><text class="ink2 label" x="${lx + 18}" y="${legendY}">${esc(text)}</text>`;
    lx += 18 + text.length * 6.4 + 22;
    return part;
  });
  const parts = [
    `<text class="ink title" x="24" y="30" style="font-size:17px">Which days Polly squawked</text>`,
    `<text class="ink2 label" x="24" y="50">One square a day for 60 days, at the launch rules.</text>`,
    ...legendParts,
  ];
  scenarios.forEach((s, i) => {
    const y = top + i * rowH;
    parts.push(`<text class="ink label" x="24" y="${y + 13}" style="font-size:13px">${esc(s.title)}</text>`);
    for (const r of s.rows) {
      const cls = !r.squawked ? "quiet" : r.promoter_won ? "s2" : "s1";
      const what = !r.squawked ? "no squawk" : r.promoter_won ? "squawked the self-promoter's post" : "squawked the flock's pick";
      parts.push(`<rect class="${cls}" x="${left + (r.day - 1) * (cell + gap)}" y="${y}" width="${cell}" height="18" rx="2"><title>${esc(s.title)}, day ${r.day}: ${Math.round(r.fed)} crackers fed, ${what}</title></rect>`);
    }
    parts.push(`<text class="ink tick" x="${left + days * (cell + gap) + 10}" y="${y + 13}" style="font-size:12px">${s.squawks} of ${days}</text>`);
  });
  for (const d of [1, 10, 20, 30, 40, 50, 60]) {
    parts.push(`<text class="muted tick" x="${left + (d - 1) * (cell + gap) + cell / 2}" y="${top + scenarios.length * rowH + 12}" text-anchor="middle">${d === 1 ? "day 1" : d}</text>`);
  }
  return svg(width, height, "Which days Polly squawked, by scenario", "A grid of 60 days by eight scenarios. A steady flock of about 14 tippers a day squawks on roughly two days in three. A fading flock stops squawking after about two weeks. A ghost town never squawks. With a self-promoter present Polly squawks every day, and the promoter's post wins on the days marked in orange.", parts.join("\n"));
}

// ----- Figure 3: where the NEAR went -----------------------------------------------------------

function nearChart() {
  const left = 232;
  const right = 190;
  const barH = 20;
  const rowH = 38;
  const top = 96;
  const plotW = 520;
  const width = left + plotW + right;
  const height = top + scenarios.length * rowH + 40;
  const price = 0.001;
  const totals = scenarios.map((s) => ({ s, writers: s.tipped, polly: s.eaten * price - s.tipped }));
  const max = Math.ceil(Math.max(...totals.map((t) => t.writers + t.polly)) / 25) * 25;
  const px = (value) => (value / max) * plotW;
  const parts = [
    `<text class="ink title" x="24" y="30" style="font-size:17px">Where the NEAR in the eaten crackers went</text>`,
    `<text class="ink2 label" x="24" y="50">Total over 60 days. Every cracker fed released 0.001 NEAR: most to the post's writer, the rest to Polly's hoard.</text>`,
    `<rect class="s1" x="24" y="64" width="12" height="12" rx="2"/><text class="ink2 label" x="42" y="74">Paid to writers</text>`,
    `<rect class="s2" x="150" y="64" width="12" height="12" rx="2"/><text class="ink2 label" x="168" y="74">Polly's cut</text>`,
  ];
  for (let t = 0; t <= max; t += 25) {
    const x = left + px(t);
    parts.push(`<line class="${t === 0 ? "axis" : "grid"}" x1="${n(x)}" x2="${n(x)}" y1="${top - 6}" y2="${top + scenarios.length * rowH - 8}"/>`);
    parts.push(`<text class="muted tick" x="${n(x)}" y="${top + scenarios.length * rowH + 8}" text-anchor="middle">${t}</text>`);
  }
  parts.push(`<text class="muted tick" x="${left + plotW}" y="${top + scenarios.length * rowH + 24}" text-anchor="end">NEAR</text>`);
  totals.forEach(({ s, writers, polly }, i) => {
    const y = top + i * rowH;
    const w1 = px(writers);
    // A 2px gap in the surface colour separates the two segments. The bar's free end is rounded.
    const w2 = Math.max(0, px(polly) - 2);
    const share = `${Math.round((writers / (writers + polly)) * 100)}%`;
    parts.push(`<text class="ink label" x="24" y="${y + 14}" style="font-size:13px">${esc(s.title)}</text>`);
    parts.push(`<rect class="s1" x="${left}" y="${y}" width="${n(w1)}" height="${barH}"><title>${esc(s.title)}: ${writers.toFixed(2)} NEAR paid to writers (${share})</title></rect>`);
    if (w2 > 0) {
      parts.push(`<path class="s2" d="M${n(left + w1 + 2)} ${y}h${n(Math.max(0, w2 - 4))}a4 4 0 0 1 4 4v${barH - 8}a4 4 0 0 1-4 4h-${n(Math.max(0, w2 - 4))}z"><title>${esc(s.title)}: ${polly.toFixed(2)} NEAR kept as Polly's cut</title></path>`);
    }
    // The share goes inside the writers' segment only where it fits with room to spare.
    if (w1 > 44) parts.push(`<text class="inside" x="${left + 8}" y="${y + 14}">${share}</text>`);
    parts.push(`<text class="ink tick" x="${n(left + w1 + 2 + w2 + 8)}" y="${y + 14}" style="font-size:12px">${writers.toFixed(1)} to writers, ${polly.toFixed(1)} to Polly</text>`);
  });
  return svg(width, height, "Where the NEAR in the eaten crackers went, by scenario", "Horizontal stacked bars of NEAR paid to writers and NEAR kept as Polly's cut over 60 simulated days. Writers received between 75 and 89 percent in every scenario.", parts.join("\n"));
}

writeFileSync(here("../docs/sim/supply.svg"), supplyChart());
writeFileSync(here("../docs/sim/squawks.svg"), squawkChart());
writeFileSync(here("../docs/sim/near.svg"), nearChart());
console.log("wrote docs/sim/supply.svg, squawks.svg and near.svg");
