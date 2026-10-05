// Writes assets/verdicts-light.svg and assets/verdicts-dark.svg.
// Zero dependencies: `node assets/src/verdicts.mjs` from anywhere.
//
// The matrix is real `check_feature_support` output, taken from the bundled
// snapshot (dataset lastUpdate 2026-08-10) with
//   node skill/scripts/caniemail.mjs check <slug> --clients '<CLIENTS>' --offline
// Refresh this table by hand if the snapshot moves and the picture should follow.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..');

// S supported, X unsupported, M mitigated, ? untested. One letter per client.
const CLIENTS = [
  ['outlook.windows', 'Outlook', 'Windows'],
  ['outlook.macos', 'Outlook', 'macOS'],
  ['gmail.desktop-webmail', 'Gmail', 'webmail'],
  ['gmail.ios', 'Gmail', 'iOS'],
  ['apple-mail.ios', 'Apple Mail', 'iOS'],
  ['yahoo.desktop-webmail', 'Yahoo', 'webmail'],
  ['samsung-email.android', 'Samsung', 'Android'],
  ['thunderbird.macos', 'Thunderbird', 'macOS'],
];
const DATA = [
  ['css-border-radius', 'XSSSSMSS'],
  ['css-at-media-prefers-color-scheme', 'XSXXSXSX'],
  ['css-gap', 'XMMMSXSS'],
  ['css-word-wrap', 'X?M?SS??'],
  ['css-clear', 'X?SSSMS?'],
  ['css-display-flex', 'XSSMSSSS'],
];
// The mitigated cell whose note is shown, and that note verbatim.
const NOTE = { row: 5, col: 3, text: 'Not supported with non Google accounts.' };
const SNAPSHOT = '2026-08-10';

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

const VERDICT = { S: 'supported', X: 'unsupported', M: 'mitigated', '?': 'untested' };
const SANS = "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Layout.
const W = 960;
const H = 452;
const PAD = 32;
const GRID_X = 304;
const COL_W = (W - PAD - GRID_X) / CLIENTS.length;
const GRID_Y = 122;
const ROW_H = 36;
const CHIP_W = 56;
const CHIP_H = 24;
const colX = (c) => GRID_X + COL_W * (c + 0.5);
const rowY = (r) => GRID_Y + ROW_H * (r + 0.5);
const GRID_BOTTOM = GRID_Y + ROW_H * DATA.length;
const NOTE_Y = GRID_BOTTOM + 16;
const LEGEND_Y = NOTE_Y + 50;

// Timeline, in seconds of one shared cycle. Every element's resting style is
// its final-frame state; the keyframes only describe the way there.
const CYCLE = 20;
const COL_START = 0.6; // first column fades in
const COL_STEP = 0.4;
const FADE = 0.45;
const SWITCH = 5.6; // caption changes from the three-state reading
const RESOLVE_START = 6.1; // first untested cell resolves
const RESOLVE_STEP = 0.3;
const NOTE_AT = 8.9;
const OUT_AT = 19.1; // everything fades for the loop
const OUT_END = 19.6;

const pct = (t) => `${+((t / CYCLE) * 100).toFixed(3)}%`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const keyframes = [];
// stops: [[seconds, opacity], ...]; must start at 0 and end at CYCLE.
function anim(name, stops) {
  keyframes.push(
    `@keyframes ${name}{${stops.map(([t, o]) => `${pct(t)}{opacity:${o}}`).join('')}}`,
  );
  return `animation:${name} ${CYCLE}s ease-in-out infinite`;
}

// Glyphs drawn in currentColor, centred on (0,0).
function glyph(v) {
  switch (v) {
    case 'supported':
      return '<path d="M-5 0.5 L-1.5 4 L5.5 -4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    case 'unsupported':
      return '<path d="M-4 -4 L4 4 M4 -4 L-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';
    case 'mitigated':
      return '<path d="M-6 1.5 C-4 -3 -1.5 -3 0 0 S4 3 6 -1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';
    default:
      return '<path d="M-3.2 -2.6 C-3.2 -6.4 3.4 -6.4 3.4 -2.6 C3.4 0.2 0 0 0 2.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="0" cy="6" r="1.3" fill="currentColor"/>';
  }
}

function chip(v, w = CHIP_W, h = CHIP_H) {
  const box =
    v === 'untested'
      ? `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="6" fill="none" stroke="currentColor" stroke-opacity="0.7" stroke-dasharray="3 3"/>`
      : `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="6" fill="currentColor" fill-opacity="0.13" stroke="currentColor" stroke-opacity="0.45"/>`;
  return `<g class="v-${v}">${box}${glyph(v)}</g>`;
}

function build(theme) {
  keyframes.length = 0;
  const p = THEMES[theme];
  const out = [];

  // Header.
  out.push(
    `<text x="${PAD}" y="42" class="mono" font-size="15" font-weight="600" fill="${p.accent}">check_feature_support</text>`,
    `<text x="${W - PAD}" y="42" class="sans" font-size="12" fill="${p.muted}" text-anchor="end">6 features × 8 clients · caniemail.com data, snapshot ${SNAPSHOT}</text>`,
  );

  const cells = DATA.flatMap(([, row], r) => [...row].map((l, c) => ({ r, c, v: VERDICT[l] })));
  const count = (v) => cells.filter((x) => x.v === v).length;
  const untested = cells.filter((x) => x.v === 'untested').sort((a, b) => a.c - b.c || a.r - b.r);

  // Captions: the three-state reading first, then the four verdicts.
  const capA = anim('capA', [[0, 1], [SWITCH, 1], [SWITCH + FADE, 0], [OUT_END, 0], [CYCLE, 1]]);
  const capB = anim('capB', [[0, 0], [SWITCH, 0], [SWITCH + FADE, 1], [OUT_AT, 1], [OUT_END, 0], [CYCLE, 0]]);
  const partial = count('mitigated') + count('untested');
  out.push(
    `<g style="${capA}" opacity="0">`,
    `<text x="${PAD}" y="68" class="sans" font-size="13" fill="${p.muted}">Three-state reading: untested folded into partial</text>`,
    `<text x="${W - PAD}" y="68" class="sans" font-size="13" fill="${p.muted}" text-anchor="end">${count('supported')} supported · ${count('unsupported')} unsupported · <tspan fill="${p.mitigated}">${partial} partial</tspan></text>`,
    '</g>',
    `<g style="${capB}">`,
    `<text x="${PAD}" y="68" class="sans" font-size="13" fill="${p.text}">Four verdicts: no data stays no data</text>`,
    `<text x="${W - PAD}" y="68" class="sans" font-size="13" fill="${p.muted}" text-anchor="end">${count('supported')} supported · ${count('unsupported')} unsupported · ${count('mitigated')} mitigated · <tspan fill="${p.untested}" font-weight="600">${count('untested')} untested</tspan></text>`,
    '</g>',
  );

  // Column headers.
  CLIENTS.forEach(([, family, platform], c) => {
    out.push(
      `<text x="${colX(c)}" y="${GRID_Y - 22}" class="sans" font-size="12" font-weight="600" fill="${p.text}" text-anchor="middle">${esc(family)}</text>`,
      `<text x="${colX(c)}" y="${GRID_Y - 8}" class="sans" font-size="11" fill="${p.muted}" text-anchor="middle">${esc(platform)}</text>`,
    );
  });

  // Row bands and labels.
  out.push(
    `<rect x="${PAD - 10}" y="${GRID_Y}" width="${W - 2 * PAD + 20}" height="${GRID_BOTTOM - GRID_Y}" rx="8" fill="${p.surface}" stroke="${p.border}"/>`,
  );
  DATA.forEach(([slug], r) => {
    if (r > 0)
      out.push(
        `<line x1="${PAD - 10}" x2="${W - PAD + 10}" y1="${GRID_Y + ROW_H * r}" y2="${GRID_Y + ROW_H * r}" stroke="${p.border}" stroke-opacity="0.6"/>`,
      );
    out.push(
      `<text x="${PAD}" y="${rowY(r) + 4.5}" class="mono" font-size="12.5" fill="${p.text}">${slug}</text>`,
    );
  });

  // Cells, swept in column by column. Untested cells first appear the way a
  // three-state tool shows them, as partial, then resolve.
  const resolveAt = new Map(untested.map((x, k) => [x, RESOLVE_START + k * RESOLVE_STEP]));
  for (let c = 0; c < CLIENTS.length; c++) {
    const t = COL_START + c * COL_STEP;
    const colAnim = anim(`col${c}`, [[0, 0], [t, 0], [t + FADE, 1], [OUT_AT, 1], [OUT_END, 0], [CYCLE, 0]]);
    out.push(`<g style="${colAnim}">`);
    for (const cell of cells.filter((x) => x.c === c)) {
      const at = `translate(${colX(cell.c).toFixed(2)} ${rowY(cell.r)})`;
      if (cell.v !== 'untested') {
        out.push(`<g transform="${at}">${chip(cell.v)}</g>`);
        continue;
      }
      const t0 = resolveAt.get(cell);
      const was = anim(`was${cell.r}_${cell.c}`, [[0, 1], [t0, 1], [t0 + FADE, 0], [CYCLE, 0]]);
      const now = anim(`now${cell.r}_${cell.c}`, [[0, 0], [t0, 0], [t0 + FADE, 1], [CYCLE, 1]]);
      out.push(
        `<g transform="${at}">`,
        `<g style="${was}" opacity="0">${chip('mitigated')}</g>`,
        `<g style="${now}">${chip('untested')}</g>`,
        '</g>',
      );
    }
    out.push('</g>');
  }

  // Note callout for one mitigated cell.
  const nx = colX(NOTE.col);
  const ny = rowY(NOTE.row);
  const noteAnim = anim('note', [[0, 0], [NOTE_AT, 0], [NOTE_AT + 0.6, 1], [OUT_AT, 1], [OUT_END, 0], [CYCLE, 0]]);
  const boxX = GRID_X - 4;
  const boxW = W - PAD - boxX;
  out.push(
    `<g style="${noteAnim}">`,
    `<rect x="${nx - CHIP_W / 2 - 3}" y="${ny - CHIP_H / 2 - 3}" width="${CHIP_W + 6}" height="${CHIP_H + 6}" rx="8" fill="none" stroke="${p.mitigated}" stroke-width="1.5"/>`,
    `<line x1="${nx}" x2="${nx}" y1="${ny + CHIP_H / 2 + 3}" y2="${NOTE_Y}" stroke="${p.mitigated}" stroke-width="1.5"/>`,
    `<rect x="${boxX}" y="${NOTE_Y}" width="${boxW}" height="30" rx="7" fill="${p.bg}" stroke="${p.mitigated}" stroke-opacity="0.7"/>`,
    `<text x="${boxX + 14}" y="${NOTE_Y + 19.5}" class="sans" font-size="13" fill="${p.text}"><tspan class="mono" font-size="12" fill="${p.muted}">gmail.ios · css-display-flex</tspan><tspan fill="${p.mitigated}" font-weight="600" dx="12">mitigated</tspan><tspan dx="12">“${esc(NOTE.text)}”</tspan></text>`,
    '</g>',
  );

  // Legend.
  const LEGEND = [
    ['supported', 'works as tested'],
    ['unsupported', 'does not work'],
    ['mitigated', 'works, with a caveat in the note'],
    ['untested', 'no data: not evidence either way'],
  ];
  const itemW = (W - 2 * PAD) / LEGEND.length;
  LEGEND.forEach(([v, meaning], i) => {
    const x = PAD + i * itemW;
    out.push(
      `<g transform="translate(${x + 17} ${LEGEND_Y + 6})">${chip(v, 34, 22)}</g>`,
      `<text x="${x + 44}" y="${LEGEND_Y + 3}" class="sans" font-size="12.5" font-weight="600" fill="${p[v]}">${v}</text>`,
      `<text x="${x + 44}" y="${LEGEND_Y + 19}" class="sans" font-size="11.5" fill="${p.muted}">${meaning}</text>`,
    );
  });

  const style = [
    `.sans{font-family:${SANS}}`,
    `.mono{font-family:${MONO}}`,
    ...['supported', 'unsupported', 'mitigated', 'untested'].map((v) => `.v-${v}{color:${p[v]}}`),
    ...keyframes,
    '@media (prefers-reduced-motion: reduce){*{animation:none!important}}',
  ].join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">`,
    `<title id="t">check_feature_support verdict matrix</title>`,
    `<desc id="d">Six CSS features checked against eight email clients. Each cell is one of four verdicts: supported, unsupported, mitigated, or untested. The animation first shows untested cells merged into partial, as a three-state tool would, then resolves them to untested. A mitigated cell for display:flex in Gmail on iOS carries the note: ${esc(NOTE.text)}</desc>`,
    `<style>\n${style}\n</style>`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${p.bg}" stroke="${p.border}"/>`,
    ...out,
    '</svg>',
    '',
  ].join('\n');
}

for (const theme of Object.keys(THEMES)) {
  writeFileSync(join(OUT, `verdicts-${theme}.svg`), build(theme));
}
