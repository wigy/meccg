/**
 * @module features/vocab
 *
 * Card-definition vocabulary: a stable mapping from `CardDefinitionId` to a
 * dense embedding index. Index 0 is reserved for "unknown / no card" —
 * hidden cards (`UNKNOWN_CARD` / `UNKNOWN_SITE` sentinels) and absent
 * references map there. Indices are assigned by sorting the card-pool keys,
 * so the mapping is reproducible from the same card pool; the FNV-1a hash
 * over the sorted keys travels with exported training data so the Python
 * side can verify it is embedding against the same vocabulary.
 */

import type { CardDefinition } from '@meccg/shared';

/** A frozen card vocabulary. */
export interface CardVocab {
  /** Number of real entries (embedding table needs `size + 1` rows for index 0). */
  readonly size: number;
  /** FNV-1a hash of the sorted definition IDs, for cross-runtime verification. */
  readonly hash: string;
  /** Maps a definition ID to its 1-based index; 0 for unknown/absent. */
  indexOf(definitionId: string | null | undefined): number;
}

/** FNV-1a 32-bit hash, hex-encoded. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Builds the vocabulary from a card pool (sorted keys, indices from 1). */
export function buildCardVocab(cardPool: Readonly<Record<string, CardDefinition>>): CardVocab {
  const ids = Object.keys(cardPool).sort();
  const index = new Map<string, number>(ids.map((id, i) => [id, i + 1]));
  return {
    size: ids.length,
    hash: fnv1a(ids.join('\n')),
    indexOf: definitionId =>
      definitionId === null || definitionId === undefined ? 0 : index.get(definitionId) ?? 0,
  };
}
