/**
 * The upstream `caniemail` package's detection, isolated behind one function.
 *
 * DEVELOPMENT ONLY. This module is never vendored into `skill/` or `mcp/`, and
 * nothing in the shipped core imports it. It exists so the differential suite
 * can compare our extractor against the implementation it replaced, and so the
 * `caniemail` package can stay a devDependency doing exactly one job: being the
 * thing we are checked against.
 *
 * It reproduces the 48-client loop that `detectFeatures` used to be — including
 * the try/catch, because 14 of 48 clients still throw `RangeError` on realistic
 * markup. Do not "fix" that here; the point is to capture what upstream
 * actually produced, warts included.
 */

import { caniemail } from 'caniemail';
import bundledData from 'caniemail/caniemail.json' with { type: 'json' };

/** @typedef {import('caniemail').CanIEmailOptions['clients'][number]} UpstreamClient */

/** Only the part of the package's snapshot read here; see `RawDataset` in the core. */
const upstreamData = /** @type {{data: {stats: Record<string, Record<string, unknown>>}[]}} */ (
  /** @type {unknown} */ (bundledData)
);

const CLIENTS = (() => {
  // Derived from the package's own data, so every one is a client it knows,
  // which its literal-union type cannot see in a string built at runtime.
  /** @type {Set<UpstreamClient>} */
  const clients = new Set();
  for (const feature of upstreamData.data ?? []) {
    for (const family of Object.keys(feature.stats ?? {})) {
      for (const platform of Object.keys(feature.stats[family] ?? {})) {
        clients.add(/** @type {UpstreamClient} */ (`${family}.${platform}`));
      }
    }
  }
  return [...clients].sort();
})();

/**
 * A position as upstream reports it, 1-based, before our `line:col-line:col`
 * rendering.
 *
 * @typedef {{start: {line: number, column: number}, end: {line: number, column: number}}} Range
 */

/**
 * Union what upstream detects across every client.
 *
 * @param {{html?: string, css?: string}} input
 * @returns {Map<string, {title: string, position: Range|undefined}>}
 */
export function upstreamDetect({ html, css }) {
  /** @type {Map<string, {title: string, position: Range|undefined}>} */
  const detected = new Map();
  for (const client of CLIENTS) {
    let result;
    try {
      result = caniemail({ clients: [client], html, css });
    } catch {
      continue;
    }
    for (const kind of /** @type {const} */ (['errors', 'warnings'])) {
      for (const [, issues] of result.issues[kind]) {
        for (const issue of issues) {
          if (!detected.has(issue.title)) {
            detected.set(issue.title, { title: issue.title, position: issue.position });
          }
        }
      }
    }
  }
  return detected;
}
