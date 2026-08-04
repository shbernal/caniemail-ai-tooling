/**
 * Tests for the skill surface.
 *
 * `mcp/smoke.mjs` drives the MCP server over real stdio; nothing did the same
 * for `skill/scripts/caniemail.mjs`, whose argument parser, stdin fallback and
 * flag handling are its own code rather than the core's. Both are shipped
 * artifacts and only one of them was ever executed by a test.
 *
 * This file lives in `core/` rather than `skill/` on purpose: `docs/releasing.md`
 * asserts the published skill is exactly nine files, and it is not listed in the
 * Makefile's `CORE_FILES`, so it is development-only and never vendored.
 *
 * Every run passes `--offline`, so the suite stays deterministic and needs no
 * network — the same rule the rest of the core suite follows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const cli = join(repo, 'skill', 'scripts', 'caniemail.mjs');

/**
 * Run the CLI and capture both streams and the exit code.
 *
 * `execFile` rejects on a non-zero exit, but a non-zero exit is exactly what
 * half of these tests assert, so the rejection is unwrapped back into a result.
 */
function run(args, { stdin } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [cli, ...args],
      { cwd: repo },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    );
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

/** Parse stdout, failing with the actual output rather than a bare SyntaxError. */
function parse({ stdout }) {
  try {
    return JSON.parse(stdout);
  } catch {
    assert.fail(`expected JSON on stdout, got: ${stdout.slice(0, 200)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* The four commands                                                           */
/* -------------------------------------------------------------------------- */

test('search prints JSON results on stdout', async () => {
  const result = await run(['search', 'rounded corners', '--limit', '3', '--offline']);
  assert.equal(result.code, 0, result.stderr);
  const output = parse(result);
  assert.ok(output.results.length > 0 && output.results.length <= 3);
  assert.ok(output.results.some((r) => r.slug === 'css-border-radius'));
});

test('check prints a per-client verdict', async () => {
  const result = await run([
    'check', 'css-border-radius', '--clients', 'outlook.windows', '--offline',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const output = parse(result);
  assert.equal(output.slug, 'css-border-radius');
  assert.equal(output.support.length, 1);
  assert.equal(output.support[0].client, 'outlook.windows');
});

test('clients lists the whole roster', async () => {
  const result = await run(['clients', '--offline']);
  assert.equal(result.code, 0, result.stderr);
  const output = parse(result);
  assert.equal(output.count, output.clients.length);
  assert.ok(output.count > 40, `expected the full roster, got ${output.count}`);
});

test('lint reads a file given --html', async () => {
  const fixture = join(here, 'fixtures', 'emails', 'template-newsletter.html');
  const result = await run(['lint', '--html', fixture, '--clients', 'outlook.windows', '--offline']);
  assert.equal(result.code, 0, result.stderr);
  const output = parse(result);
  assert.ok(output.findings.length > 0);
  assert.deepEqual(output.clients_checked, ['outlook.windows']);
});

/* -------------------------------------------------------------------------- */
/* The parts that are the CLI's own, not the core's                            */
/* -------------------------------------------------------------------------- */

test('lint falls back to stdin when given neither --html nor --css', async () => {
  const result = await run(['lint', '--clients', 'outlook.windows', '--offline'], {
    stdin: '<div style="display:flex">hi</div>',
  });
  assert.equal(result.code, 0, result.stderr);
  const output = parse(result);
  assert.ok(
    output.findings.some((f) => f.feature === 'css-display-flex'),
    'expected the flex declaration piped on stdin to be linted',
  );
});

test('--no-untested suppresses unknown findings', async () => {
  const args = ['lint', '--clients', '*', '--offline'];
  const html = '<div style="backdrop-filter:blur(2px)">hi</div>';
  const withUntested = parse(await run(args, { stdin: html }));
  const without = parse(await run([...args, '--no-untested'], { stdin: html }));

  assert.ok(withUntested.findings.some((f) => f.verdict === 'untested'));
  assert.ok(!without.findings.some((f) => f.verdict === 'untested'));
});

test('piped output is compact, not indented', async () => {
  // stdout is a pipe here, so the indentation branch must not fire. The point
  // is the agent's context budget, which two-space indent inflated by ~28%.
  const result = await run(['search', 'flexbox', '--limit', '2', '--offline']);
  assert.ok(!result.stdout.trimEnd().includes('\n'), 'expected a single compact line');
});

test('a bad glob fails on stderr with nothing on stdout', async () => {
  const result = await run(['check', 'css-border-radius', '--clients', 'outlook.win', '--offline']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '', 'a failure must not also print a result');
  assert.match(result.stderr, /No client matches: outlook\.win/);
});

test('a limit that cannot return anything fails here, where it is reachable', async () => {
  // The MCP schema rejects these before the core sees them; the CLI is the only
  // surface that could pass them through, so this is the only place it shows.
  const zero = await run(['search', 'flexbox', '--limit', '0', '--offline']);
  assert.equal(zero.code, 1);
  assert.equal(zero.stdout, '');
  assert.match(zero.stderr, /positive integer, not 0/);

  // `Number('abc')` is NaN, which used to slice to nothing and read as "no such
  // feature" — a typo answered with a confident empty result.
  const junk = await run(['search', 'flexbox', '--limit', 'abc', '--offline']);
  assert.equal(junk.code, 1);
  assert.match(junk.stderr, /positive integer, not NaN/);
});

test('a missing --clients is an error, not an empty pass', async () => {
  const result = await run(['search', 'flexbox', '--offline']);
  assert.equal(result.code, 0, 'search does not need --clients');

  const lint = await run(['lint', '--offline'], { stdin: '<div>hi</div>' });
  assert.equal(lint.code, 1);
  assert.match(lint.stderr, /--clients is required/);
});

test('an unknown command prints usage and fails', async () => {
  const result = await run(['explain', '--offline']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown command "explain"/);
});

test('no arguments prints usage and succeeds', async () => {
  const result = await run([]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^caniemail — email client compatibility/);
});

/* -------------------------------------------------------------------------- */
/* The no-install guarantee                                                    */
/* -------------------------------------------------------------------------- */

test('the skill surface imports nothing it would have to install', () => {
  // `skill/` ships with no package.json and must run from a bare checkout.
  // That property is load-bearing (AGENTS.md § Conventions) and was previously
  // enforced by nothing but remembering it — a single bare-specifier import
  // added to the core would have reached both surfaces via `make sync-core` and
  // only failed at publish. pnpm's isolated node_modules catches this for
  // `mcp/`, but `skill/` has no node_modules to be isolated from.
  const dir = join(repo, 'skill', 'scripts');
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.mjs'));
  assert.ok(files.length >= 7, `expected the vendored core, found ${files.length} modules`);

  for (const file of files) {
    const source = readFileSync(join(dir, String(file)), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:^|\s)from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(
        specifier.startsWith('node:') || specifier.startsWith('./') || specifier.startsWith('../'),
        `skill/scripts/${file} imports "${specifier}", which would need an install`,
      );
    }
  }
});
