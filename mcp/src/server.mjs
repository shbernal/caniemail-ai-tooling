#!/usr/bin/env node
/**
 * mcp-server-caniemail — the MCP surface.
 *
 * A thin adapter over the shared core. All correctness lives in
 * `caniemail-core.mjs`; this file only maps tool calls onto it and shapes the
 * responses.
 *
 * Four tools rather than one. A single `get_caniemail_data` that returned the
 * whole matrix would be 620KB of JSON — 307 features across 48 clients — and
 * would exhaust an agent's context before it did anything useful. Each tool
 * here answers one question and returns only what that question needs.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  checkFeatureSupport,
  lintEmail,
  listClients,
  loadDataset,
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

let loaded = null;

async function getDataset() {
  if (!loaded || Date.now() - loaded.at >= REVALIDATE_MS) {
    const next = await loadDataset({ offline });
    const held = loaded?.value;

    // A revalidation that finds upstream unmoved keeps the *same* feature
    // array. That array is the WeakMap key `buildTitleTables` memoises on and
    // `loadDataset` returns a fresh one every time, so adopting `next` wholesale
    // discards title tables that describe data identical to the data replacing
    // it.
    //
    // Worth about 1ms per revalidation, and no more than that — measured, not
    // assumed. The re-parse and re-index still happen (~12ms from a warm disk
    // cache): `loadDataset` owns those and is still called. So this is not what
    // makes revalidation cheap, it is only what stops the tables cold-starting
    // needlessly. It is kept for saying something true — unmoved data is the
    // same dataset — at no runtime cost, not for the microseconds.
    //
    // The new `meta` is adopted regardless, and that is the part that has to be
    // right: it carries `source` and `fetchedAt`, so keeping the old object
    // outright would report a `fetchedAt` from a quarter of an hour ago and call
    // a just-revalidated answer stale — reintroducing, in miniature, the exact
    // bug `REVALIDATE_MS` exists to fix.
    const unmoved =
      held &&
      held.meta.lastUpdate === next.meta.lastUpdate &&
      held.meta.featureCount === next.meta.featureCount;

    loaded = { value: unmoved ? { ...held, meta: next.meta } : next, at: Date.now() };
  }
  return loaded.value;
}

/**
 * The client roster, inlined into the tool descriptions.
 *
 * This is 48 fixed strings and an agent cannot call anything usefully without
 * them — it has to know that `outlook.windows` (Word renderer) and
 * `outlook.outlook-com` (webmail) are different engines with very different
 * support before it can pick targets. Spending the tokens here beats a fifth
 * tool that every session would have to call first.
 *
 * Read from the bundled snapshot rather than the live dataset, because tool
 * descriptions are registered once and this is the only thing that has to exist
 * before `connect()`. Taking it from the snapshot costs no network, so the
 * handshake never waits on caniemail.com — previously a slow or black-holed
 * network delayed `initialize` by the full fetch timeout. The roster is 48
 * identifiers that change about never; if upstream adds a client, the
 * descriptions catch up on the next restart while the *data* is already current
 * from the first tool call.
 */
const CLIENT_ROSTER = (await loadDataset({ offline: true })).clients.join(', ');

const CLIENT_ARG = z
  .array(z.string())
  .min(1)
  .describe(
    'Email clients as "family.platform", with * wildcards on either segment: ' +
      '["outlook.windows"], ["outlook.*"], ["*.ios"], or ["*"] for all. ' +
      `Known clients: ${CLIENT_ROSTER}.`,
  );

// Read rather than repeated, so it cannot drift from the published version at
// the next release. `files` limits the tarball to `src` and `README.md`, but npm
// always ships package.json at the package root, so `../` resolves once
// installed exactly as it does here.
const server = new McpServer({ name: 'caniemail', version: pkg.version });

// Compact, not indented. Nothing human ever reads this — it goes into an
// agent's context — and on a lint of a realistic newsletter against all 48
// clients the indentation alone was 16KB, roughly 4k tokens of whitespace.
const json = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

const fail = (error) => ({
  content: [{ type: 'text', text: error.message }],
  isError: true,
});

/* -------------------------------------------------------------------------- */

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
      'Passing features are never returned. Each finding carries every source position it was ' +
      'seen at as "line:col-line:col" (with occurrence_count, which is higher than the list ' +
      'when a feature appears more than ten times), the clients affected, any documented ' +
      'workaround, and the feature URL. "clients_affected" is compressed against the clients ' +
      'you asked for: "*" means all of them and "outlook.*" means all the ones you asked for in ' +
      'that family, with client_count always the exact number. Per-severity advice is in the ' +
      'result\'s "guidance" legend rather than repeated on every finding.',
    inputSchema: {
      html: z.string().optional().describe('The email HTML. Inline styles are checked too.'),
      css: z.string().optional().describe('Standalone CSS, e.g. the contents of a <style> block.'),
      clients: CLIENT_ARG,
      include_untested: z
        .boolean()
        .optional()
        .describe('Include never-tested features as "unknown" findings. Default true.'),
    },
  },
  async ({ html, css, clients, include_untested }) => {
    try {
      return json(lintEmail(await getDataset(), { html, css, clients, includeUntested: include_untested }));
    } catch (error) {
      return fail(error);
    }
  },
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
    inputSchema: {
      feature: z.string().describe('Feature slug, e.g. "css-display-flex", "css-border-radius".'),
      clients: CLIENT_ARG,
      version: z
        .string()
        .optional()
        .describe(
          'Pin a specific client version instead of the newest, e.g. "2016" for Outlook 2016. ' +
            'Works with wildcards: clients that have no such version come back as "untested" ' +
            'with version_requested set, rather than failing the whole call. Only a version no ' +
            'requested client has at all is an error.',
        ),
    },
  },
  async ({ feature, clients, version }) => {
    try {
      return json(checkFeatureSupport(await getDataset(), feature, clients, { version }));
    } catch (error) {
      return fail(error);
    }
  },
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
    inputSchema: {
      query: z.string().describe('Keywords, e.g. "flexbox", "dark mode", "rounded corners".'),
      category: z
        .enum(['html', 'css', 'image', 'others'])
        .optional()
        .describe('Restrict to one category.'),
      limit: z.number().int().positive().optional().describe('Max results. Default 15.'),
    },
  },
  async ({ query, category, limit }) => {
    try {
      return json(searchFeatures(await getDataset(), query, { category, limit }));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'list_email_clients',
  {
    title: 'List all email clients',
    description:
      'The full roster of email clients with human-readable names. The same list is inlined in ' +
      'the other tools’ descriptions, so call this only if you need the display names.',
    inputSchema: {},
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

/* -------------------------------------------------------------------------- */

await server.connect(new StdioServerTransport());
