#!/usr/bin/env node
/**
 * Describe what moved between two caniemail dataset snapshots.
 *
 * Development-only, used by `.github/workflows/refresh-data.yml` to write the
 * body of the refresh PR. It never reaches a surface — it is not in the
 * Makefile's `CORE_FILES` and imports nothing but `node:` builtins.
 *
 * A refresh PR whose body says "the data changed" is not reviewable; the whole
 * point is to see *what* changed before the snapshot becomes both the offline
 * fallback and the fixture every test runs against. The feature list rarely
 * moves — most refreshes are verdict cells flipping — so counting changed cells
 * matters more than counting added slugs.
 *
 *   node .github/scripts/dataset-delta.mjs before.json after.json
 */

import { readFile } from 'node:fs/promises';

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('usage: dataset-delta.mjs <before.json> <after.json>');
  process.exit(2);
}

const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [before, after] = await Promise.all([read(beforePath), read(afterPath)]);

const bySlug = (dataset) => new Map((dataset.data ?? []).map((f) => [f.slug, f]));
const beforeFeatures = bySlug(before);
const afterFeatures = bySlug(after);

const added = [...afterFeatures.keys()].filter((slug) => !beforeFeatures.has(slug));
const removed = [...beforeFeatures.keys()].filter((slug) => !afterFeatures.has(slug));

/** Flatten one feature's stats into `family.platform@version -> letter`. */
function cells(feature) {
  const flat = new Map();
  for (const [family, platforms] of Object.entries(feature?.stats ?? {})) {
    for (const [platform, versions] of Object.entries(platforms ?? {})) {
      for (const [version, value] of Object.entries(versions ?? {})) {
        flat.set(`${family}.${platform}@${version}`, String(value));
      }
    }
  }
  return flat;
}

const changed = [];
for (const [slug, feature] of afterFeatures) {
  const previous = beforeFeatures.get(slug);
  if (!previous) continue;
  const was = cells(previous);
  const now = cells(feature);
  const keys = new Set([...was.keys(), ...now.keys()]);
  const moved = [...keys].filter((key) => was.get(key) !== now.get(key));
  if (moved.length > 0) changed.push({ slug, moved });
}

const total = (list) => list.reduce((sum, entry) => sum + entry.moved.length, 0);

const list = (slugs) =>
  slugs.length === 0 ? '_none_' : slugs.map((slug) => `\`${slug}\``).join(', ');

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const lines = [];

lines.push('| | before | after |');
lines.push('|---|---|---|');
lines.push(`| \`last_update_date\` | \`${before.last_update_date}\` | \`${after.last_update_date}\` |`);
lines.push(`| features | ${beforeFeatures.size} | ${afterFeatures.size} |`);
lines.push('');
lines.push(`**Added** (${added.length}): ${list(added)}`);
lines.push('');
lines.push(`**Removed** (${removed.length}): ${list(removed)}`);
lines.push('');

if (changed.length === 0) {
  lines.push('**Changed verdicts:** none — no support cell moved.');
} else {
  lines.push(
    `**Changed verdicts:** ${plural(total(changed), 'cell')} across ` +
      `${plural(changed.length, 'feature')}.`,
  );
  lines.push('');
  lines.push('<details><summary>Cell by cell</summary>');
  lines.push('');
  for (const { slug, moved } of changed) {
    const was = cells(beforeFeatures.get(slug));
    const now = cells(afterFeatures.get(slug));
    lines.push(`- \`${slug}\``);
    for (const key of moved) {
      lines.push(`  - \`${key}\`: \`${was.get(key) ?? '—'}\` → \`${now.get(key) ?? '—'}\``);
    }
  }
  lines.push('');
  lines.push('</details>');
}

console.log(lines.join('\n'));
