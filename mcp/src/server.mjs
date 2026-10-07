#!/usr/bin/env node
/**
 * mcp-server-caniemail — the MCP surface.
 *
 * A thin adapter over the shared core. All correctness lives in
 * `caniemail-core.mjs`; this file only maps tool calls onto it and shapes the
 * responses.
 *
 * Four tools rather than one. A single `get_caniemail_data` that returned the
 * whole matrix would be 620KB of JSON, roughly 300 features across 48 clients,
 * and would exhaust an agent's context before it did anything useful. Each tool
 * here answers one question and returns only what that question needs.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import {
  checkFeatureSupport,
  lintEmail,
  listClients,
  loadDataset,
  revalidatingDataset,
  searchFeatures,
} from './caniemail-core.mjs';
import pkg from '../package.json' with { type: 'json' };

const offline = process.env.CANIEMAIL_OFFLINE === '1';

/**
 * How long a loaded dataset is trusted inside this process.
 *
 * An MCP server lives as long as its client — days. Loading once at startup
 * meant `data_source` kept reporting `source: "live"` with no warning and a
 * `fetchedAt` from whenever the editor was opened, which is exactly the silent
 * staleness the field exists to prevent.
 *
 * Revalidating on *every* call would be wrong in the other direction:
 * `buildTitleTables` memoises on a WeakMap keyed by the feature array, and each
 * `loadDataset` returns a fresh one, so a per-call reload would rebuild the
 * title tables for every lint. Fifteen minutes keeps the tables warm while
 * bounding how stale an answer can be, and `loadDataset` still owns the 24-hour
 * *disk* cache — so a revalidation with a warm cache is a file read, not a
 * fetch, and processes sharing the cache agree with each other.
 */
const REVALIDATE_MS = 15 * 60 * 1000;

const getDataset = revalidatingDataset(REVALIDATE_MS, { offline });

/**
 * The client roster, inlined into the tool descriptions.
 *
 * This is about fifty fixed strings and an agent cannot call anything usefully without
 * them — it has to know that `outlook.windows` (Word renderer) and
 * `outlook.outlook-com` (webmail) are different engines with very different
 * support before it can pick targets. Spending the tokens here beats a fifth
 * tool that every session would have to call first.
 *
 * Read from the bundled snapshot rather than the live dataset, because tool
 * descriptions are registered once and this is the only thing that has to exist
 * before the first message is answered. Taking it from the snapshot costs no
 * network, so the handshake never waits on caniemail.com — previously a slow or
 * black-holed network delayed `initialize` by the full fetch timeout. The
 * roster is a list of identifiers that changes about never; if upstream adds a
 * client, the descriptions catch up on the next restart while the *data* is
 * already current from the first tool call.
 */
const SNAPSHOT = await loadDataset({ offline: true });
const CLIENT_ROSTER = SNAPSHOT.clients.join(', ');

// Listed for the same reason and from the same place, but described rather than
// enforced: a `z.enum` would reject a category added upstream before the core,
// which validates against the live data, ever saw it.
const CATEGORIES = [...new Set(SNAPSHOT.features.map((feature) => feature.category))].sort();

const CLIENT_ARG = z
  .array(z.string())
  .min(1)
  .describe(
    'Email clients as "family.platform", with * wildcards on either segment: ' +
      '["outlook.windows"], ["outlook.*"], ["*.ios"], or ["*"] for all. ' +
      `Known clients: ${CLIENT_ROSTER}.`,
  );

// Compact, not indented. Nothing human ever reads this — it goes into an
// agent's context — and on a lint of a realistic newsletter against all 48
// clients the indentation alone was 16KB, roughly 4k tokens of whitespace.
/** @param {unknown} value */
const json = (value) => ({
  content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(value) }],
});

// Handlers throw rather than build an error result. The SDK catches anything a
// tool handler throws and returns its message as an `isError` result, which is
// exactly what an agent needs to correct a slug, a glob or a category.

// Every tool only reads, and only from one closed dataset. Saying so lets a
// client run them without asking the user first. `idempotentHint` is left out
// because the spec gives it meaning only for tools that write.
const annotations = { readOnlyHint: true, openWorldHint: false };

// How long a 2026-07-28 client may keep the tool list and the discover result
// before asking again. Both are fixed for the life of the process: the roster
// in the descriptions comes from the bundled snapshot, not the live data, so
// only a new release changes them. Public, because nothing in either depends
// on who asked. A 2025-era client never sees these fields.
const DAY_MS = 24 * 60 * 60 * 1000;
const cacheHints = {
  'tools/list': { ttlMs: DAY_MS, cacheScope: /** @type {const} */ ('public') },
  'server/discover': { ttlMs: DAY_MS, cacheScope: /** @type {const} */ ('public') },
};

/* -------------------------------------------------------------------------- */

/**
 * One server, built per connection. `serveStdio` reads the client's opening
 * message to decide which protocol era the connection speaks, an `initialize`
 * handshake (2025) or a `server/discover` probe (2026-07-28), and pins an
 * instance from this factory for that era. Building one is cheap: the dataset
 * holder and the snapshot above are module-level, so every instance shares them.
 */
function createServer() {
  // Read rather than repeated, so it cannot drift from the published version
  // at the next release. `files` limits the tarball to `src` and `README.md`,
  // but npm always ships package.json at the package root, so `../` resolves
  // once installed exactly as it does here.
  const server = new McpServer({ name: 'caniemail', version: pkg.version }, { cacheHints });

  server.registerTool(
    'lint_email',
    {
      title: 'Lint email HTML/CSS for client compatibility',
      description:
        'Check drafted email HTML and/or CSS against email clients and report only what breaks. ' +
        'Call this after writing an email, before sending. Returns findings at three severities: ' +
        '"error" (unsupported — will not render, use a fallback), ' +
        '"warning" (partial or conditional support — read the notes, usually workable), and ' +
        '"unknown" (never tested on those clients — this is NOT evidence of support; avoid or test). ' +
        'Passing features are never returned. One feature usually yields two or three findings, ' +
        'one per verdict, and a finding carries only what its verdict decides: severity, verdict, ' +
        'clients_affected, client_count, notes and feature_notes. Everything else is in the ' +
        'result\'s "features" legend, keyed by the slug each finding\'s "feature" names — look ' +
        'there for the title, the feature URL, last_test_date, and "positions", every place your ' +
        'markup uses it as "line:col-line:col" (with occurrence_count, which is higher than the ' +
        'list when a feature appears more than ten times). "clients_affected" is compressed ' +
        'against the clients you asked for: "*" means all of them and "outlook.*" means all the ' +
        'ones you asked for in that family, with client_count always the exact number. ' +
        'Per-severity advice is in the "guidance" legend rather than repeated on every finding.',
      annotations,
      inputSchema: z.object({
        html: z.string().optional().describe('The email HTML. Inline styles are checked too.'),
        css: z
          .string()
          .optional()
          .describe('Standalone CSS, e.g. the contents of a <style> block.'),
        clients: CLIENT_ARG,
        include_untested: z
          .boolean()
          .optional()
          .describe('Include never-tested features as "unknown" findings. Default true.'),
      }),
    },
    async ({ html, css, clients, include_untested }) =>
      json(
        lintEmail(await getDataset(), { html, css, clients, includeUntested: include_untested }),
      ),
  );

  server.registerTool(
    'check_feature_support',
    {
      title: 'Check one feature across clients',
      description:
        'Per-client support verdict for a single feature, for deciding HOW to build something ' +
        'rather than checking what you already built. Returns one of four verdicts per client: ' +
        'supported, unsupported, mitigated (works with a documented workaround — read the notes), ' +
        'or untested (no data; not the same as unsupported). Also returns the version the verdict ' +
        'came from, every version on record, and how stale the last test is. ' +
        'Feature slugs are not guessable — use search_features first.',
      annotations,
      inputSchema: z.object({
        feature: z.string().describe('Feature slug, e.g. "css-display-flex", "css-border-radius".'),
        clients: CLIENT_ARG,
        version: z
          .string()
          .optional()
          .describe(
            'Pin a specific client version instead of the newest, e.g. "2016" for Outlook 2016. ' +
              'Works with wildcards: clients that have no such version come back as "untested" ' +
              'with versions_on_record showing what they do have, rather than failing the whole ' +
              'call. Only a version no requested client has at all is an error. The pin is echoed ' +
              'once as version_requested on the result.',
          ),
      }),
    },
    async ({ feature, clients, version }) =>
      json(checkFeatureSupport(await getDataset(), feature, clients, { version })),
  );

  server.registerTool(
    'search_features',
    {
      title: 'Find feature slugs by keyword',
      description:
        'Search the caniemail feature list by keyword and return matching slugs with one-line ' +
        'descriptions. Start here: slugs are not guessable — "rounded corners" is ' +
        '"css-border-radius" and flexbox is "css-display-flex". Returns identifiers only, never ' +
        'support data, so it is cheap to call speculatively.',
      annotations,
      inputSchema: z.object({
        query: z.string().describe('Keywords, e.g. "flexbox", "dark mode", "rounded corners".'),
        category: z
          .string()
          .optional()
          .describe(`Restrict to one category: ${CATEGORIES.join(', ')}.`),
        limit: z.number().int().positive().optional().describe('Max results. Default 15.'),
      }),
    },
    async ({ query, category, limit }) =>
      json(searchFeatures(await getDataset(), query, { category, limit })),
  );

  server.registerTool(
    'list_email_clients',
    {
      title: 'List all email clients',
      description:
        'The full roster of email clients with human-readable names. The same list is inlined in ' +
        'the other tools’ descriptions, so call this only if you need the display names.',
      annotations,
      inputSchema: z.object({}),
    },
    async () => {
      const dataset = await getDataset();
      return json({
        clients: listClients(dataset),
        count: dataset.clients.length,
        data_source: dataset.meta,
      });
    },
  );

  return server;
}

/* -------------------------------------------------------------------------- */

serveStdio(createServer);
