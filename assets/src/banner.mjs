// Writes assets/banner-light.svg and assets/banner-dark.svg.
// Zero dependencies: `node assets/src/banner.mjs` from anywhere.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');

const THEMES = {
  light: {
    bg: '#ffffff', surface: '#f6f8fa', border: '#d0d7de', text: '#1f2328',
    muted: '#59636e', accent: '#8250df',
    supported: '#1a7f37', unsupported: '#cf222e', mitigated: '#9a6700', untested: '#6e7781',
  },
  dark: {
    bg: '#0d1117', surface: '#161b22', border: '#30363d', text: '#e6edf3',
    muted: '#9198a1', accent: '#a371f7',
    supported: '#3fb950', unsupported: '#f85149', mitigated: '#d29922', untested: '#8b949e',
  },
};

const VERDICTS = ['supported', 'unsupported', 'mitigated', 'untested'];
const CLASS = { supported: 'vs', unsupported: 'vx', mitigated: 'vm', untested: 'vt' };

const W = 1280;
const H = 320;
const SANS = "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Grid of client cells: 12 x 4.
const COLS = 12;
const ROWS = 4;
const CELL = 28;
const GAP = 10;
const PITCH = CELL + GAP;
const GRID_W = COLS * PITCH - GAP;
const GRID_H = ROWS * PITCH - GAP;
const PANEL_PAD = 24;
const PANEL_W = GRID_W + 2 * PANEL_PAD;
const PANEL_H = GRID_H + 2 * PANEL_PAD;
const PANEL_X = W - 56 - PANEL_W;
const PANEL_Y = (H - PANEL_H) / 2;
const GRID_X = PANEL_X + PANEL_PAD;
const GRID_Y = PANEL_Y + PANEL_PAD;

// Animation timing: a scan bar crosses the columns, and each column
// briefly greys out and resolves back to its verdict as the bar passes.
const CYCLE = 9; // seconds
const SWEEP_START = 0.03; // fraction of cycle
const SWEEP_END = 0.36;
const STEP = ((SWEEP_END - SWEEP_START) * CYCLE) / (COLS - 1);

// Deterministic verdict layout: fixed counts, shuffled by a seeded PRNG.
const COUNTS = { supported: 22, mitigated: 9, unsupported: 8, untested: 9 };
const LAYOUT = (() => {
  const cells = Object.entries(COUNTS).flatMap(([v, n]) => Array(n).fill(v));
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
})();
const verdictAt = (i) => LAYOUT[i];

const r = (n) => Number(n.toFixed(2));

function build(name) {
  const t = THEMES[name];

  const cells = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const v = verdictAt(row * COLS + col);
      cells.push(
        `<rect class="c ${CLASS[v]}" x="${GRID_X + col * PITCH}" y="${GRID_Y + row * PITCH}" ` +
          `width="${CELL}" height="${CELL}" rx="6" style="animation-delay:${r(col * STEP)}s"/>`,
      );
    }
  }

  const resolve = VERDICTS.map(
    (v) =>
      `@keyframes r-${CLASS[v]}{0%,100%{fill:${t[v]}}2.5%{fill:${t.border}}9%{fill:${t[v]}}}\n` +
      `.${CLASS[v]}{fill:${t[v]};animation-name:r-${CLASS[v]}}`,
  ).join('\n');

  const barX0 = GRID_X + CELL / 2 - 2;
  const travel = (COLS - 1) * PITCH;

  // Space legend items by label length, allowing for a wide fallback font.
  let lx = 64;
  const legend = VERDICTS.map((v) => {
    const x = lx;
    lx += 20 + v.length * 14 * 0.62 + 32;
    return (
      `<rect x="${x}" y="249" width="12" height="12" rx="3" fill="${t[v]}"/>` +
      `<text x="${x + 20}" y="260" font-family="${MONO}" font-size="14" fill="${t.muted}">${v}</text>`
    );
  }).join('\n    ');

  const pill = (x, w, label) =>
    `<rect x="${x}" y="182" width="${w}" height="30" rx="15" fill="${t.surface}" stroke="${t.border}"/>` +
    `<text x="${x + w / 2}" y="202" text-anchor="middle" font-family="${MONO}" font-size="14" fill="${t.text}">${label}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="title desc">
  <title id="title">caniemail-ai-tooling</title>
  <desc id="desc">Email client compatibility for AI agents. A grid of email clients, each cell coloured by verdict: supported, unsupported, mitigated or untested.</desc>
  <style>
    .c{animation-duration:${CYCLE}s;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
    ${resolve.replace(/\n/g, '\n    ')}
    @keyframes sweep{
      0%{opacity:0;transform:translateX(0)}
      ${SWEEP_START * 100}%{opacity:1;transform:translateX(0)}
      ${SWEEP_END * 100}%{opacity:1;transform:translateX(${travel}px)}
      ${(SWEEP_END + 0.04) * 100}%,100%{opacity:0;transform:translateX(${travel}px)}
    }
    .bar{opacity:0;animation:sweep ${CYCLE}s linear infinite}
    @media (prefers-reduced-motion: reduce){.c,.bar{animation:none}}
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="${t.bg}" stroke="${t.border}"/>

  <text x="64" y="118" font-family="${MONO}" font-size="44" font-weight="600" fill="${t.text}">caniemail-ai-tooling</text>
  <text x="64" y="160" font-family="${SANS}" font-size="26" fill="${t.muted}">Email client compatibility for AI agents</text>
  ${pill(64, 96, 'skill')}
  ${pill(172, 140, 'MCP server')}
  <g>
    ${legend}
  </g>

  <rect x="${PANEL_X + 0.5}" y="${PANEL_Y + 0.5}" width="${PANEL_W - 1}" height="${PANEL_H - 1}" rx="12" fill="${t.surface}" stroke="${t.border}"/>
  <g>
    ${cells.join('\n    ')}
  </g>
  <rect class="bar" x="${barX0}" y="${GRID_Y - 10}" width="4" height="${GRID_H + 20}" rx="2" fill="${t.accent}"/>
</svg>
`;
}

for (const name of Object.keys(THEMES)) {
  writeFileSync(join(OUT, `banner-${name}.svg`), build(name));
}
