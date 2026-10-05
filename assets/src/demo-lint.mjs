#!/usr/bin/env node
// Writes assets/demo-lint-{light,dark}.svg: an animated agent session that
// drafts an email, lints it, rewrites it and lints it clean.
//
//   node assets/src/demo-lint.mjs
//
// The transcript below is real. Both emails were linted with
//
//   node skill/scripts/caniemail.mjs lint --html <file> \
//     --clients 'outlook.windows,gmail.*,apple-mail.*' --offline
//
// against the bundled snapshot (lastUpdate 2026-08-10). Rows are abridged,
// never invented: verdicts, slugs, clients, positions and notes are copied
// from that output. Re-run the lint and update this data when the snapshot
// moves.
//
// The SVG is shown through <img> on GitHub, so it has no script and no web
// fonts. Every element's resting style is its final-frame state; the
// animation only hides things early. A renderer without CSS animation, or a
// viewer with prefers-reduced-motion, sees the finished session.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- content --

const PROMPT = 'Build a promo email with a two-column hero. It has to work in Outlook and Gmail.';

const DRAFT_SAY = 'Drafting the hero with flexbox.';
const DRAFT_FILE = 'draft.html';
const DRAFT = [
  '<style>',
  '@media (prefers-color-scheme: dark) {',
  '  .hero { background: #111 }',
  '}',
  '</style>',
  '<div class="hero" style="display:flex; gap:24px">',
  '  <img src="hero.webp" width="280" alt="Sale">',
  '  <div style="border-radius:8px; padding:24px">',
  '    <h1>Spring sale</h1>',
  '  </div>',
  '</div>',
];

const CLIENTS = ['outlook.windows', 'gmail.*', 'apple-mail.*'];

// lint_email on DRAFT: 8 errors, 11 warnings, 0 untested, passed false.
// `mark` is the substring of DRAFT[line - 1] the finding points at; it turns
// red in the code as the row arrives.
const DRAFT_SUMMARY = { error: 8, warning: 11, unknown: 0, passed: false };
const DRAFT_ROWS = [
  {
    verdict: 'unsupported',
    feature: 'css-display-flex',
    pos: '6:26',
    clients: 'outlook.windows',
    mark: [6, 'display:flex'],
  },
  {
    verdict: 'unsupported',
    feature: 'css-gap',
    pos: '6:40',
    clients: 'outlook.windows +1',
    mark: [6, 'gap:24px'],
  },
  {
    verdict: 'unsupported',
    feature: 'css-border-radius',
    pos: '8:15',
    clients: 'outlook.windows',
    mark: [8, 'border-radius:8px'],
  },
  {
    verdict: 'unsupported',
    feature: 'image-webp',
    pos: '7:3',
    clients: 'outlook.windows',
    mark: [7, 'hero.webp'],
  },
  {
    verdict: 'unsupported',
    feature: 'html-style',
    pos: '1:1',
    clients: 'gmail.mobile-webmail',
    mark: [1, '<style>'],
  },
  {
    verdict: 'unsupported',
    feature: 'css-at-media-prefers-color-scheme',
    pos: '2:1',
    clients: 'gmail.* +1',
    mark: [2, 'prefers-color-scheme'],
  },
  {
    verdict: 'mitigated',
    feature: 'image-webp',
    pos: '7:3',
    clients: 'gmail.*',
    note: '"Partial: Converts file to jpg."',
  },
];
const DRAFT_HIDDEN = '+ 2 errors and 10 warnings not shown';

const FIXED_SAY = '8 errors. Rewriting as a table layout.';
const FIXED_FILE = 'fixed.html';
const FIXED = [
  '<table role="presentation" width="600"',
  '  cellpadding="0" cellspacing="0">',
  '<tr>',
  '  <td width="280">',
  '    <img src="hero.jpg" alt="Sale" width="280">',
  '  </td>',
  '  <td width="24"></td>',
  '  <td><h1>Spring sale</h1></td>',
  '</tr>',
  '</table>',
];

// lint_email on FIXED: 0 errors, 1 warning, 0 untested, passed true. html-width
// is used at 1:1, 4:3, 5:5 and 7:3; the row shows the first.
const FIXED_SUMMARY = { error: 0, warning: 1, unknown: 0, passed: true };
const FIXED_ROWS = [
  {
    verdict: 'mitigated',
    feature: 'html-width',
    pos: '1:1',
    clients: 'outlook.windows',
    note: '"Sizes set in attributes don\'t scale in',
    note2: ' 120 dpi mode."',
  },
];

const CHANGES_SAY = 'Passes. What changed:';
const CHANGES = [
  ['display:flex, gap', 'table cells'],
  ['hero.webp', 'hero.jpg'],
  ['border-radius', 'square corners'],
  ['<style> dark mode', 'removed'],
];

// ---------------------------------------------------------------- palette --

const PALETTES = {
  light: {
    bg: '#ffffff',
    surface: '#f6f8fa',
    border: '#d0d7de',
    text: '#1f2328',
    muted: '#59636e',
    accent: '#8250df',
    supported: '#1a7f37',
    unsupported: '#cf222e',
    mitigated: '#9a6700',
    untested: '#6e7781',
  },
  dark: {
    bg: '#0d1117',
    surface: '#161b22',
    border: '#30363d',
    text: '#e6edf3',
    muted: '#9198a1',
    accent: '#a371f7',
    supported: '#3fb950',
    unsupported: '#f85149',
    mitigated: '#d29922',
    untested: '#8b949e',
  },
};

// ----------------------------------------------------------------- layout --

const W = 960;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const SIZE = 12;
const LH = 17; // line height
const CW = 7.6; // generous char width, used only to size typing covers
const M = 16; // outer margin
const GUT = 16;
const LEFT_W = 500;
const RIGHT_W = W - 2 * M - GUT - LEFT_W;
const LX = M;
const RX = M + LEFT_W + GUT;
const PAD = 12; // inner padding of boxes
const COL_TOP = 96;

// --------------------------------------------------------------- timeline --
// Seconds. ACTION is when the last line lands; the final frame then holds
// until CYCLE and everything fades out for the loop.

const CYCLE = 28;
const FADE = 0.25;
const OUT = 0.5; // fade-out before the loop

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (t) => `${((t / CYCLE) * 100).toFixed(3)}%`;

function render(theme) {
  const c = PALETTES[theme];
  const css = [];
  const body = [];
  let n = 0;

  // Fade in at t. Resting opacity is 1, so without animation it is shown.
  const appear = (t) => {
    const name = `a${n++}`;
    css.push(
      `@keyframes ${name}{0%,${pct(t)}{opacity:0}${pct(t + FADE)},${pct(CYCLE - OUT)}{opacity:1}100%{opacity:0}}`,
      `.${name}{animation-name:${name}}`,
    );
    return name;
  };
  // Visible only between t0 and t1. Resting opacity is 0: not in the final frame.
  const transient = (t0, t1) => {
    const name = `a${n++}`;
    css.push(
      `@keyframes ${name}{0%,${pct(t0)}{opacity:0}${pct(t0 + 0.1)},${pct(t1)}{opacity:1}${pct(t1 + 0.1)},100%{opacity:0}}`,
      `.${name}{opacity:0;animation-name:${name}}`,
    );
    return name;
  };
  // A cover that shrinks to the right over `chars` steps, revealing typed
  // text beneath it. Resting scale is 0, so without animation it is gone.
  const typing = (t, dur, chars) => {
    const name = `a${n++}`;
    css.push(
      `@keyframes ${name}{0%{transform:scaleX(1)}${pct(t)}{transform:scaleX(1);animation-timing-function:steps(${chars},end)}${pct(t + dur)},100%{transform:scaleX(0)}}`,
      `.${name}{transform:scaleX(0);transform-box:fill-box;transform-origin:100% 50%;animation-name:${name}}`,
    );
    return name;
  };
  // Text that turns from `from` to the resting colour at t.
  const recolor = (t, from) => {
    const name = `a${n++}`;
    css.push(
      `@keyframes ${name}{0%,${pct(t)}{fill:${from}}${pct(t + FADE)},100%{fill:${c.unsupported}}}`,
      `.${name}{animation-name:${name}}`,
    );
    return name;
  };

  const text = (x, y, inner, attrs = '') => `<text x="${x}" y="${y}"${attrs}>${inner}</text>`;
  const span = (s, fill, extra = '') =>
    s ? `<tspan fill="${fill}"${extra}>${esc(s)}</tspan>` : '';

  // A line typed out over `dur` seconds, with a cover of colour `under`.
  const typed = (x, y, inner, chars, t, dur, under, width) => {
    const w = width ?? Math.ceil(chars * CW) + 8;
    // The text fades in under a full cover, so only the fade-out shows.
    body.push(
      `<g class="${appear(t)}">${text(x, y, inner)}</g>`,
      `<rect class="${typing(t, dur, chars)}" x="${x - 1}" y="${y - SIZE}" width="${w}" height="${LH}" fill="${under}"/>`,
    );
  };

  // Light HTML highlighting: tag names and brackets in accent, the rest in
  // text colour. `marks` are [substring, className] painted red.
  const code = (line, marks) => {
    const segs = [];
    let rest = line;
    for (const [sub, cls] of marks) {
      const i = rest.indexOf(sub);
      if (i < 0) throw new Error(`mark "${sub}" not found in "${line}"`);
      segs.push([rest.slice(0, i), null], [sub, cls]);
      rest = rest.slice(i + sub.length);
    }
    segs.push([rest, null]);
    return segs
      .map(([s, cls]) => {
        if (cls) return `<tspan class="${cls}" fill="${c.unsupported}">${esc(s)}</tspan>`;
        return s
          .split(/(<\/?[a-z0-9]+|\/?>)/)
          .map((tok, k) => span(tok, k % 2 ? c.accent : c.text))
          .join('');
      })
      .join('');
  };

  const role = (x, y, who, say, t) => {
    body.push(
      `<g class="${appear(t)}">` +
        text(x, y, span(who, c.accent, ' font-weight="700"') + span(`  ${say}`, c.text)) +
        '</g>',
    );
  };

  const box = (x, y, w, h, fill = c.surface) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${c.border}"/>`;

  const codeBox = (x, y, w, file, lines, t0, step, marksFor) => {
    const h = lines.length * LH + 2 * PAD - 4 + LH;
    body.push(`<g class="${appear(t0 - 0.2)}">${box(x, y, w, h)}`);
    body.push(text(x + PAD, y + PAD + SIZE - 1, span(file, c.muted)), '</g>');
    lines.forEach((line, i) => {
      const yy = y + PAD + SIZE - 1 + (i + 1) * LH;
      const num = span(String(i + 1).padStart(2) + '  ', c.muted);
      body.push(
        `<g class="${appear(t0 + i * step)}">${text(x + PAD, yy, num + code(line, marksFor(i + 1)))}</g>`,
      );
    });
    return y + h;
  };

  const call = (x, y, lines, t, under) => {
    // lines: arrays of [string, colour]
    let tt = t;
    lines.forEach((parts, i) => {
      const chars = parts.reduce((a, [s]) => a + s.length, 0);
      const dur = Math.min(0.9, 0.3 + chars * 0.012);
      typed(x, y + i * LH, parts.map(([s, f]) => span(s, f)).join(''), chars, tt, dur, under);
      tt += dur + 0.05;
    });
    return tt;
  };

  const summary = (s) => {
    const plural = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
    return (
      span(plural(s.error, 'error'), s.error ? c.unsupported : c.supported, ' font-weight="700"') +
      span('  ', c.muted) +
      span(plural(s.warning, 'warning'), c.mitigated) +
      span('  ', c.muted) +
      span(`${s.unknown} untested`, c.untested) +
      span('   passed: ', c.muted) +
      span(String(s.passed), s.passed ? c.supported : c.unsupported, ' font-weight="700"')
    );
  };

  const VCOL = 12;
  const FCOL = 19;
  const row = (r) =>
    span(r.verdict.padEnd(VCOL), c[r.verdict], ' font-weight="700"') +
    span(r.feature.padEnd(FCOL), c.text) +
    span(' ' + r.pos.padEnd(6), c.muted) +
    span(r.clients, c.text);

  const results = (x, y, w, sum, rows, extra, t0, step) => {
    const lines = [];
    lines.push([summary(sum), t0]);
    let t = t0 + 0.3;
    for (const r of rows) {
      lines.push([row(r), t]);
      for (const nt of [r.note, r.note2].filter(Boolean)) {
        lines.push([span(' '.repeat(VCOL) + nt, c.muted), t]);
      }
      t += step;
    }
    if (extra) lines.push([span(extra, c.muted), t]);
    const h = lines.length * LH + 2 * PAD - 4;
    body.push(`<g class="${appear(t0)}">${box(x, y, w, h, c.bg)}</g>`);
    lines.forEach(([inner, tt], i) => {
      body.push(
        `<g class="${appear(tt)}">${text(x + PAD, y + PAD + SIZE - 1 + i * LH, inner)}</g>`,
      );
    });
    return { bottom: y + h, end: t };
  };

  // ------------------------------------------------------------ the scene --

  // User prompt.
  const PY = 50;
  body.push(`<g class="${appear(0.1)}">${box(M, PY, W - 2 * M, 30)}</g>`);
  body.push(text(M + PAD, PY + 19, span('you', c.muted, ' font-weight="700"')));
  typed(
    M + PAD + 5 * 7.2,
    PY + 19,
    span(PROMPT, c.text),
    PROMPT.length,
    0.4,
    1.6,
    c.surface,
    W - 2 * M - PAD * 2 - 5 * 7.2,
  );

  // Left column: draft and its lint.
  const markTimes = new Map();
  const T_DRAFT = 2.4;
  role(LX, COL_TOP + 10, 'agent', DRAFT_SAY, 2.1);
  const T_RESULTS = 7.4;
  const ROW_STEP = 0.22;
  const draftMarks = (ln) =>
    DRAFT_ROWS.map((r, i) => [r, i])
      .filter(([r]) => r.mark && r.mark[0] === ln)
      .sort(([a], [b]) => DRAFT[ln - 1].indexOf(a.mark[1]) - DRAFT[ln - 1].indexOf(b.mark[1]))
      .map(([r, i]) => {
        const t = T_RESULTS + 0.3 + i * ROW_STEP;
        markTimes.set(i, t);
        return [r.mark[1], recolor(t, c.text)];
      });
  const draftEnd = codeBox(LX, COL_TOP + 22, LEFT_W, DRAFT_FILE, DRAFT, T_DRAFT, 0.17, draftMarks);

  const callLines = [
    [
      ['lint_email', c.accent],
      ['({ html: ', c.muted],
      [DRAFT_FILE, c.text],
      [',', c.muted],
    ],
    [
      ['    clients: ', c.muted],
      [JSON.stringify(CLIENTS).replace(/,/g, ', '), c.text],
      [' })', c.muted],
    ],
  ];
  const CALL_Y = draftEnd + 22;
  call(LX, CALL_Y, callLines, 5.0, c.bg);
  const RES_Y = CALL_Y + (callLines.length - 1) * LH + 12;
  body.push(
    text(
      LX + PAD,
      RES_Y + PAD + SIZE - 1,
      span('running...', c.muted),
      ` class="${transient(6.6, T_RESULTS - 0.1)}"`,
    ),
  );
  const left = results(
    LX,
    RES_Y,
    LEFT_W,
    DRAFT_SUMMARY,
    DRAFT_ROWS,
    DRAFT_HIDDEN,
    T_RESULTS,
    ROW_STEP,
  );

  // Right column: rewrite and its lint.
  const T_FIX = Math.max(left.end + 0.9, 10.4);
  role(RX, COL_TOP + 10, 'agent', FIXED_SAY, T_FIX - 0.3);
  const fixedEnd = codeBox(RX, COL_TOP + 22, RIGHT_W, FIXED_FILE, FIXED, T_FIX, 0.17, () => []);
  const fixCall = [
    [
      ['lint_email', c.accent],
      ['({ html: ', c.muted],
      [FIXED_FILE, c.text],
      [',', c.muted],
    ],
    [
      ['    clients: ', c.muted],
      ['["outlook.windows",', c.text],
    ],
    [
      ['              ', c.muted],
      ['"gmail.*", "apple-mail.*"]', c.text],
      [' })', c.muted],
    ],
  ];
  const T_FCALL = T_FIX + FIXED.length * 0.17 + 0.5;
  const fixCallEnd = call(RX, fixedEnd + 22, fixCall, T_FCALL, c.bg);
  const FRES_Y = fixedEnd + 22 + (fixCall.length - 1) * LH + 12;
  // Line the two result boxes up when the columns allow it.
  const fresY = Math.max(FRES_Y, RES_Y);
  const T_FRES = fixCallEnd + 0.7;
  body.push(
    text(
      RX + PAD,
      fresY + PAD + SIZE - 1,
      span('running...', c.muted),
      ` class="${transient(fixCallEnd + 0.1, T_FRES - 0.1)}"`,
    ),
  );
  const right = results(RX, fresY, RIGHT_W, FIXED_SUMMARY, FIXED_ROWS, null, T_FRES, ROW_STEP);

  // What changed.
  const T_CH = right.end + 0.6;
  const CH_Y = right.bottom + 26;
  role(RX, CH_Y, 'agent', CHANGES_SAY, T_CH);
  const fromW = Math.max(...CHANGES.map(([a]) => a.length)) + 2;
  CHANGES.forEach(([a, b], i) => {
    body.push(
      `<g class="${appear(T_CH + 0.35 + i * 0.25)}">` +
        text(
          RX + PAD,
          CH_Y + (i + 1) * LH + 4,
          span(a.padEnd(fromW), c.muted) + span('->  ', c.accent) + span(b, c.text),
        ) +
        '</g>',
    );
  });
  const ACTION = T_CH + 0.35 + CHANGES.length * 0.25;
  if (ACTION > CYCLE - 9) throw new Error(`action runs to ${ACTION}s, leaving too short a hold`);

  const H = Math.ceil(Math.max(left.bottom, CH_Y + CHANGES.length * LH + 4) + 18);

  // ---------------------------------------------------------- the window --

  const chrome = [
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="${c.bg}" stroke="${c.border}"/>`,
    `<path d="M0.5 34V10.5a10 10 0 0 1 10-10h${W - 21}a10 10 0 0 1 10 10V34z" fill="${c.surface}"/>`,
    `<line x1="0.5" y1="34.5" x2="${W - 0.5}" y2="34.5" stroke="${c.border}"/>`,
    ...[0, 1, 2].map(
      (i) =>
        `<circle cx="${20 + i * 18}" cy="17.5" r="5.5" fill="none" stroke="${c.border}" stroke-width="1.5"/>`,
    ),
    text(W / 2, 22, span('agent session  ·  email-compat', c.muted), ' text-anchor="middle"'),
  ];

  const style = [
    `text{font-family:${FONT};font-size:${SIZE}px;white-space:pre}`,
    `.s *{animation-duration:${CYCLE}s;animation-iteration-count:infinite;animation-timing-function:linear}`,
    ...css,
    '@media (prefers-reduced-motion:reduce){.s *{animation:none!important}}',
  ].join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title">
<title id="title">An agent drafts an email with flexbox, lint_email reports display:flex, gap and border-radius as unsupported in Outlook on Windows, and after a rewrite to tables the lint passes with no errors.</title>
<style>
${style}
</style>
${chrome.join('\n')}
<g class="s" xml:space="preserve">
${body.join('\n')}
</g>
</svg>
`;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..');
mkdirSync(out, { recursive: true });
for (const theme of ['light', 'dark']) {
  const file = join(out, `demo-lint-${theme}.svg`);
  writeFileSync(file, render(theme));
  console.log(`wrote ${file}`);
}
