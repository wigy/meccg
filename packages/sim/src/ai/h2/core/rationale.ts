/**
 * @module ai/h2/core/rationale
 *
 * Builders and renderers for the explanation tree.
 *
 * A {@link Rationale} is produced by the module that did the reasoning, not
 * reconstructed afterwards by a printer, so an explanation can never drift
 * from the number it explains. The text renderer is what `explain` prints; the
 * JSON form is what tests diff and what `--json` emits.
 */

import type { Rationale, RationaleUnit } from './types.js';

/** Optional annotations shared by both builders. */
interface RationaleOptions {
  /** Unit of the value. */
  readonly unit?: RationaleUnit;
  /** Rule citation or free-form remark. */
  readonly note?: string;
  /** Name of the `Tunables` field the value came from. */
  readonly tunable?: string;
}

/** A rationale line with no sub-derivation. */
export function leaf(label: string, value: number | string, options: RationaleOptions = {}): Rationale {
  return { label, value, ...options };
}

/** A rationale line whose value is derived from `children`. */
export function node(
  label: string,
  value: number | string,
  children: readonly Rationale[],
  options: RationaleOptions = {},
): Rationale {
  return { label, value, ...options, children };
}

/** Format one value according to its unit. */
export function formatValue(value: number | string, unit?: RationaleUnit): string {
  if (typeof value === 'string') return value;
  switch (unit) {
    case 'p':
    case 'winprob':
      return `${(value * 100).toFixed(1)}%`;
    case 'tsd':
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
    case 'mp':
      return `${value >= 0 ? '+' : ''}${value}`;
    case 'turns':
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    default:
      return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
}

/** Render one line's text, without any tree prefix. */
function renderLine(r: Rationale): string {
  const parts = [`${r.label}: ${formatValue(r.value, r.unit)}`];
  if (r.tunable) parts.push(`{${r.tunable}}`);
  if (r.note) parts.push(`[${r.note}]`);
  return parts.join('  ');
}

/**
 * Render a rationale tree as indented text with box-drawing connectors, the
 * form the `explain` CLI prints under each ranked candidate.
 */
export function renderRationale(root: Rationale, indent = ''): string[] {
  const lines = [`${indent}${renderLine(root)}`];
  const children = root.children ?? [];
  children.forEach((child, i) => {
    const last = i === children.length - 1;
    const branch = `${indent}${last ? '└─ ' : '├─ '}`;
    const childIndent = `${indent}${last ? '   ' : '│  '}`;
    const rendered = renderRationale(child, childIndent);
    // Re-attach the first rendered line to the branch connector; deeper lines
    // already carry the continuation indent.
    lines.push(branch + rendered[0].slice(childIndent.length));
    lines.push(...rendered.slice(1));
  });
  return lines;
}

/**
 * Every `Tunables` field name referenced anywhere in the tree.
 *
 * Module tests use this to enforce the "no anonymous constants" invariant: a
 * module that reads a tunable must name it in its rationale, so `explain`
 * output always reveals which constant produced a decision.
 */
export function collectTunables(root: Rationale): Set<string> {
  const found = new Set<string>();
  const walk = (r: Rationale): void => {
    if (r.tunable) found.add(r.tunable);
    for (const child of r.children ?? []) walk(child);
  };
  walk(root);
  return found;
}
