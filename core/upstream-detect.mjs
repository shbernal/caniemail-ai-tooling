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

const CLIENTS = (() => {
  const clients = new Set();
  for (const feature of bundledData.data ?? []) {
    for (const family of Object.keys(feature.stats ?? {})) {
      for (const platform of Object.keys(feature.stats[family] ?? {})) {
        clients.add(`${family}.${platform}`);
      }
    }
  }
  return [...clients].sort();
})();

/**
 * Union what upstream detects across every client.
 *
 * @param {{html?: string, css?: string}} input
 * @returns {Map<string, {title: string, position: object|undefined}>}
 */
export function upstreamDetect({ html, css }) {
  const detected = new Map();
  for (const client of CLIENTS) {
    let result;
    try {
      result = caniemail({ clients: [client], html, css });
    } catch {
      continue;
    }
    for (const kind of ['errors', 'warnings']) {
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

/** The titles upstream can never report, whatever the markup. */
export { bundledData as upstreamBundledData };
