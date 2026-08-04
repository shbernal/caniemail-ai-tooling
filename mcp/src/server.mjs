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

const dataset = await loadDataset({ offline: process.env.CANIEMAIL_OFFLINE === '1' });

/**
 * The client roster, inlined into the tool descriptions.
 *
 * This is 48 fixed strings and an agent cannot call anything usefully without
 * them — it has to know that `outlook.windows` (Word renderer) and
 * `outlook.outlook-com` (webmail) are different engines with very different
 * support before it can pick targets. Spending the tokens here beats a fifth
 * tool that every session would have to call first.
 */
const CLIENT_ROSTER = dataset.clients.join(', ');

const CLIENT_ARG = z
  .array(z.string())
  .min(1)
  .describe(
    'Email clients as "family.platform", with * wildcards on either segment: ' +
      '["outlook.windows"], ["outlook.*"], ["*.ios"], or ["*"] for all. ' +
      `Known clients: ${CLIENT_ROSTER}.`,
  );

const server = new McpServer({ name: 'caniemail', version: '0.1.0' });

const json = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

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
      'Passing features are never returned. Each finding carries the source position, the ' +
      'clients affected, any documented workaround, and the feature URL.',
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
      return json(lintEmail(dataset, { html, css, clients, includeUntested: include_untested }));
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
            'Must be one of the versions on record for every client requested.',
        ),
    },
  },
  async ({ feature, clients, version }) => {
    try {
      return json(checkFeatureSupport(dataset, feature, clients, { version }));
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
      return json(searchFeatures(dataset, query, { category, limit }));
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
  async () => json({ clients: listClients(dataset), count: dataset.clients.length, data_source: dataset.meta }),
);

/* -------------------------------------------------------------------------- */

await server.connect(new StdioServerTransport());
