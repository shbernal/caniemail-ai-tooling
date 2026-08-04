/**
 * Tests for `loadDataset`'s fetch-and-cache ladder.
 *
 * This is the code behind the project's loudest promise — that a stale answer
 * is visibly stale — and until this file existed it was the least covered block
 * in the repo. `meta.source` and `meta.warning` are computed nowhere else, and
 * every path that produces them is a failure path: a fetch that 500s, a cache
 * written half-way by a concurrent process, a network that accepts the
 * connection and then says nothing.
 *
 * **These tests run against a loopback server, and that is still "offline".**
 * The rule they look like they break exists so a caniemail.com outage cannot
 * read as a broken commit. A `node:http` server on 127.0.0.1 has no external
 * dependency and is completely deterministic; what it buys is that the genuine
 * `fetch`, the genuine `AbortController` timeout, real HTTP status handling and
 * real JSON parsing are all under test, where injecting a fake `fetch` would
 * have replaced the thing being tested with the test's own idea of it. Every
 * failure mode below is one line of server, and none of them is reachable at
 * all against the real endpoint.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadDataset } from './caniemail-core.mjs';

/**
 * A dataset small enough to read, and distinguishable from the bundled
 * snapshot at a glance — every assertion about *which* copy answered turns on
 * telling these two apart.
 */
const REMOTE = {
  last_update_date: '2031-01-01 00:00:00 +0000',
  data: [
    {
      slug: 'loopback-feature',
      title: 'Loopback feature',
      stats: { loopback: { server: { 1: 'y' } } },
    },
  ],
  nicenames: { family: { loopback: 'Loopback' }, platform: { server: 'Server' } },
};

/** A different one again, so a cache hit cannot be confused with a fetch. */
const CACHED = {
  last_update_date: '2030-01-01 00:00:00 +0000',
  data: [
    {
      slug: 'cached-feature',
      title: 'Cached feature',
      stats: { cached: { disk: { 1: 'y' } } },
    },
  ],
  nicenames: {},
};

const serveJson = (body) => (_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

/**
 * Stand up a loopback dataset server and a private cache directory, both torn
 * down when the test ends.
 *
 * `hits` is the point of the server as much as its body is: "did this touch the
 * network at all" is the assertion for half the cases here, and it is not
 * answerable from the returned dataset.
 */
async function harness(t, handler = serveJson(REMOTE)) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'caniemail-cache-'));
  const state = { hits: 0, cacheDir, cacheFile: join(cacheDir, 'data.json') };

  const server = createServer((request, response) => {
    state.hits += 1;
    handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.dataUrl = `http://127.0.0.1:${server.address().port}/api/data.json`;

  t.after(async () => {
    // A hung request holds a socket open, and `close` waits for it — which
    // would keep `node --test` alive well past the assertion.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(cacheDir, { recursive: true, force: true });
  });

  /** Write a cache entry as `loadDataset` would have written it. */
  state.seedCache = async (raw, ageMs = 0) => {
    await mkdir(cacheDir, { recursive: true });
    const fetchedAt = new Date(Date.now() - ageMs).toISOString();
    await writeFile(state.cacheFile, JSON.stringify({ fetchedAt, raw }));
    return fetchedAt;
  };

  state.load = (options) =>
    loadDataset({ cacheDir, dataUrl: state.dataUrl, timeoutMs: 2_000, ...options });

  return state;
}

/* -------------------------------------------------------------------------- */
/* The happy path                                                              */
/* -------------------------------------------------------------------------- */

test('a successful fetch answers live, and lands in the cache', async (t) => {
  const h = await harness(t);

  const dataset = await h.load();

  assert.equal(dataset.meta.source, 'live');
  assert.equal(dataset.meta.warning, null);
  assert.equal(dataset.meta.lastUpdate, REMOTE.last_update_date);
  assert.equal(dataset.meta.featureCount, 1);
  assert.ok(Date.parse(dataset.meta.fetchedAt) > 0);
  assert.equal(h.hits, 1);

  // Indexed like any other copy, not passed through raw.
  assert.deepEqual(dataset.clients, ['loopback.server']);
  assert.equal(dataset.bySlug.get('loopback-feature').title, 'Loopback feature');

  const written = JSON.parse(await readFile(h.cacheFile, 'utf8'));
  assert.equal(written.fetchedAt, dataset.meta.fetchedAt);
  assert.deepEqual(written.raw, REMOTE);
});

test('a fresh cache is used without touching the network', async (t) => {
  const h = await harness(t);
  const fetchedAt = await h.seedCache(CACHED, 60_000);

  const dataset = await h.load({ maxAgeMs: 24 * 60 * 60 * 1000 });

  assert.equal(h.hits, 0, 'a fresh cache must short-circuit the fetch entirely');
  assert.equal(dataset.meta.source, 'cache');
  assert.equal(dataset.meta.warning, null, 'a fresh cache is not a stale answer');
  assert.equal(dataset.meta.fetchedAt, fetchedAt);
  assert.equal(dataset.meta.lastUpdate, CACHED.last_update_date);
});

test('a cache older than maxAgeMs is refetched and rewritten', async (t) => {
  const h = await harness(t);
  await h.seedCache(CACHED, 60_000);

  const dataset = await h.load({ maxAgeMs: 30_000 });

  assert.equal(h.hits, 1);
  assert.equal(dataset.meta.source, 'live');
  assert.equal(dataset.meta.lastUpdate, REMOTE.last_update_date);

  // The stale entry is replaced, not merely bypassed — otherwise the next
  // process to read the cache gets the old copy back.
  const written = JSON.parse(await readFile(h.cacheFile, 'utf8'));
  assert.deepEqual(written.raw, REMOTE);
});

/* -------------------------------------------------------------------------- */
/* Degradation                                                                 */
/* -------------------------------------------------------------------------- */

test('a corrupt cache file is refetched rather than thrown on', async (t) => {
  const h = await harness(t);
  await mkdir(h.cacheDir, { recursive: true });
  // Exactly what an interrupted write leaves behind, and what the two surfaces
  // sharing one cache directory used to produce before the write became atomic.
  await writeFile(h.cacheFile, '{"fetchedAt":"2031-01-01T00:00:00.000Z","raw":{"da');

  const dataset = await h.load();

  assert.equal(h.hits, 1);
  assert.equal(dataset.meta.source, 'live');
  assert.deepEqual(JSON.parse(await readFile(h.cacheFile, 'utf8')).raw, REMOTE);
});

test('a failed fetch falls back to the cache, and says the answer may be stale', async (t) => {
  const h = await harness(t, (_request, response) => {
    response.writeHead(500).end('upstream is having a day');
  });
  await h.seedCache(CACHED, 48 * 60 * 60 * 1000);

  const dataset = await h.load();

  assert.equal(h.hits, 1, 'the fetch is attempted before the cache is trusted');
  assert.equal(dataset.meta.source, 'cache');
  assert.match(dataset.meta.warning, /may be out of date/);
  assert.equal(dataset.meta.lastUpdate, CACHED.last_update_date);
});

test('a body that is not JSON counts as a failed fetch', async (t) => {
  const h = await harness(t, (_request, response) => {
    // A 200 with an HTML error page is what a captive portal or a misrouted
    // proxy returns, and it must not be indexed as a dataset.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('<html>sign in to continue</html>');
  });

  const dataset = await h.load();

  assert.equal(dataset.meta.source, 'bundled');
  assert.match(dataset.meta.warning, /bundled/);
  assert.ok(dataset.features.length > 250, 'the real snapshot, not the loopback one');
});

test('an error status is an error even when its body parses', async (t) => {
  const h = await harness(t, (_request, response) => {
    // The dangerous shape: a gateway or an API that answers every request with
    // JSON, error or not. The body parses, `data` is absent, and `indexDataset`
    // would happily produce an empty dataset labelled `source: "live"` — a
    // confident answer that every feature is unknown. Only the status check
    // stands between that and the caller.
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'bad gateway' }));
  });

  const dataset = await h.load();

  assert.equal(dataset.meta.source, 'bundled');
  assert.ok(dataset.features.length > 250, 'an error body must never index as a dataset');
});

test('a failed fetch with no cache falls back to the bundled snapshot', async (t) => {
  const h = await harness(t, (_request, response) => {
    response.writeHead(503).end();
  });

  const dataset = await h.load();

  assert.equal(dataset.meta.source, 'bundled');
  assert.equal(dataset.meta.fetchedAt, null);
  assert.match(dataset.meta.warning, /Live fetch and cache both unavailable/);
  assert.ok(dataset.features.length > 250);
});

// The `timeout` is load-bearing, not belt-and-braces: with the abort broken
// this test does not fail, it waits for as long as the peer holds the socket —
// which is the defect itself, and would wedge `node --test` rather than report
// anything. Five seconds is twenty times the abort it is checking.
test('a server that accepts the connection and says nothing hits the timeout', { timeout: 5_000 }, async (t) => {
  // Never responds. Without the AbortController this hangs for as long as the
  // peer keeps the socket open, which for an MCP server means the editor's
  // first tool call never returns.
  const h = await harness(t, () => {});

  const started = Date.now();
  const dataset = await h.load({ timeoutMs: 250 });
  const elapsed = Date.now() - started;

  assert.equal(dataset.meta.source, 'bundled');
  assert.ok(elapsed < 5_000, `fell back after ${elapsed}ms, so the abort fired`);
});

/* -------------------------------------------------------------------------- */
/* Offline                                                                     */
/* -------------------------------------------------------------------------- */

test('offline reaches for neither the network nor the cache', async (t) => {
  const h = await harness(t);
  await h.seedCache(CACHED, 0);

  const dataset = await h.load({ offline: true });

  assert.equal(h.hits, 0);
  assert.equal(dataset.meta.source, 'bundled');
  // Deliberately not the cache, fresh though it is: offline means "answer from
  // the copy that shipped with this tool", which is the only one whose contents
  // are known. The warning names that rather than a failure.
  assert.match(dataset.meta.warning, /^Offline mode/);
  assert.ok(dataset.features.length > 250);
});

/* -------------------------------------------------------------------------- */
/* The cache write itself                                                      */
/* -------------------------------------------------------------------------- */

test('the cache write leaves no temp file behind', async (t) => {
  const h = await harness(t);

  await h.load();

  assert.deepEqual(await readdir(h.cacheDir), ['data.json']);
});

test('an unwritable cache costs a rewrite, not the answer', async (t) => {
  const h = await harness(t);
  // A directory where the cache file goes: the temp file writes fine and the
  // rename onto it cannot succeed, which is the only way to reach the cleanup
  // branch without stubbing the filesystem.
  await mkdir(h.cacheFile, { recursive: true });

  const dataset = await h.load();

  assert.equal(dataset.meta.source, 'live', 'a cache that cannot be written is not an error');
  assert.equal(dataset.meta.lastUpdate, REMOTE.last_update_date);

  const left = await readdir(h.cacheDir);
  assert.deepEqual(
    left.filter((entry) => entry.endsWith('.tmp')),
    [],
    'the temp file is cleaned up when the rename fails',
  );
});
