#!/usr/bin/env node
/**
 * Drive the MCP server over a real stdio JSON-RPC session.
 *
 * The core suite tests the implementation; this tests the transport, the tool
 * registrations, and the schemas — everything that only fails once a client is
 * actually talking to the process.
 *
 * By default it runs the working tree. Pass a command to point it elsewhere:
 *   node mcp/smoke.mjs -- npx -y mcp-server-caniemail
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const separator = process.argv.indexOf('--');
const command =
  separator === -1
    ? [process.execPath, join(here, 'src', 'server.mjs')]
    : process.argv.slice(separator + 1);

const child = spawn(command[0], command.slice(1), {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env },
});

let buffer = '';
const pending = new Map();

child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 30_000).unref();
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

const checks = [];
function check(label, condition, detail = '') {
  checks.push({ label, ok: Boolean(condition), detail });
  process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}\n`);
}

function payload(response) {
  return JSON.parse(response.result.content[0].text);
}

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  });
  check('initialize', init.result?.serverInfo?.name === 'caniemail', init.result?.serverInfo?.name);
  notify('notifications/initialized');

  const tools = await request('tools/list', {});
  const names = tools.result.tools.map((t) => t.name).sort();
  check(
    'tools/list returns the four tools',
    names.join(',') === 'check_feature_support,lint_email,list_email_clients,search_features',
    names.join(', '),
  );

  const lintTool = tools.result.tools.find((t) => t.name === 'lint_email');
  check(
    'client roster is inlined in the tool schema',
    JSON.stringify(lintTool.inputSchema).includes('outlook.windows'),
  );

  const search = await request('tools/call', {
    name: 'search_features',
    arguments: { query: 'rounded corners', limit: 3 },
  });
  check(
    'search_features finds border-radius',
    payload(search).results[0].slug === 'css-border-radius',
    payload(search).results[0].slug,
  );

  const support = await request('tools/call', {
    name: 'check_feature_support',
    arguments: { feature: 'css-border-radius', clients: ['outlook.windows'] },
  });
  check(
    'check_feature_support resolves a verdict',
    payload(support).support[0].verdict === 'unsupported',
    payload(support).support[0].verdict,
  );

  const lint = await request('tools/call', {
    name: 'lint_email',
    arguments: {
      html: '<div style="display:flex; border-radius:8px">hi</div>',
      clients: ['*'],
    },
  });
  const findings = payload(lint).findings;
  check('lint_email flags display:flex', findings.some((f) => f.feature === 'css-display-flex'));
  check(
    'lint_email keeps untested distinct from mitigated',
    findings.some((f) => f.verdict === 'untested') || findings.every((f) => f.verdict !== 'untested'),
    `${new Set(findings.map((f) => f.verdict)).size} distinct verdicts`,
  );
  check('lint_email survives the "*" glob', payload(lint).clients_checked.length === 48);

  const bad = await request('tools/call', {
    name: 'check_feature_support',
    arguments: { feature: 'css-nonsense', clients: ['*'] },
  });
  check('unknown slug returns a tool error, not a crash', bad.result.isError === true);

  const clients = await request('tools/call', { name: 'list_email_clients', arguments: {} });
  check('list_email_clients returns 48', payload(clients).count === 48);
} finally {
  child.kill();
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
