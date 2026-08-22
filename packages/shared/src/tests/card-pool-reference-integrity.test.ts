/**
 * @module card-pool-reference-integrity
 *
 * Data-integrity guard for the card pool's *cross-references*. A card that
 * names another card — by `manifestId` (the manifestation chain), or by a
 * card NAME inside an effect condition (`inPlay`, `cardName`, `cardNames`,
 * `requiresCardOnSameSite`) — silently does nothing when that reference is a
 * typo: `manifestIdOf` returns an id that matches no card, a `card-in-play`
 * gate never fires, a `prohibit-card-play` lock never engages. Nothing else
 * catches it, because the effect simply evaluates to "no match".
 *
 * These references all resolve today; this test keeps a future card (or a
 * rename) from introducing a dangling one.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool } from '../index.js';
import type { CardDefinition } from '../index.js';

const pool = loadCardPool();
const defs = Object.values(pool);
const idSet = new Set(defs.map(d => d.id as string));
const nameSet = new Set(defs.map(d => (d as { name?: string }).name).filter((n): n is string => typeof n === 'string'));

/** Keys that hold a card NAME reference inside an effect object. */
const NAME_KEYS = new Set(['inPlay', 'inPlayAnywhere', 'cardName', 'requiresCardOnSameSite']);
/** Keys that hold an ARRAY of card-name references. */
const NAME_ARRAY_KEYS = new Set(['cardNames']);

/** Walk every nested value of a card's effects, collecting (path, value) name refs. */
function collectNameRefs(def: CardDefinition): { where: string; name: string }[] {
  const refs: { where: string; name: string }[] = [];
  const walk = (o: unknown, path: string): void => {
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (NAME_KEYS.has(k) && typeof v === 'string') refs.push({ where: `${path}.${k}`, name: v });
        else if (NAME_ARRAY_KEYS.has(k) && Array.isArray(v)) {
          for (const n of v) if (typeof n === 'string') refs.push({ where: `${path}.${k}`, name: n });
        } else walk(v, `${path}.${k}`);
      }
    }
  };
  const effects = (def as { effects?: unknown }).effects;
  const keyedTo = (def as { keyedTo?: unknown }).keyedTo;
  walk(effects, 'effects');
  walk(keyedTo, 'keyedTo');
  return refs;
}

describe('Card pool cross-reference integrity', () => {
  test('every manifestId references a card in the pool', () => {
    const dangling: string[] = [];
    for (const def of defs) {
      const m = (def as { manifestId?: string }).manifestId;
      if (m !== undefined && !idSet.has(m)) {
        dangling.push(`${def.id as string} (${(def as { name?: string }).name ?? '?'}): manifestId → ${m}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  test('every card-name reference in an effect names a card in the pool', () => {
    const dangling: string[] = [];
    for (const def of defs) {
      for (const { where, name } of collectNameRefs(def)) {
        if (!nameSet.has(name)) {
          dangling.push(`${def.id as string} (${(def as { name?: string }).name ?? '?'}) ${where}: "${name}"`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });
});
