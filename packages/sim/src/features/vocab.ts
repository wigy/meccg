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

import { ACTS_AS_SITE_ID_SUFFIX, isSiteCard, type CardDefinition } from '@meccg/shared';

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

/**
 * The source card id of a synthesized `acts-as-site` companion definition
 * (Wondrous Maps td-171 → `td-171-site`), or `null` for a real card.
 *
 * The card-pool loader synthesizes one `SiteCard`-shaped entry per card that
 * carries an `acts-as-site` effect, so every site-lookup path treats the
 * resource card as a site while a company stands on it. Those entries are not
 * cards: they are never drawn, never in a deck, never in a hand.
 */
function actsAsSiteSourceId(
  id: string,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string | null {
  if (!id.endsWith(ACTS_AS_SITE_ID_SUFFIX)) return null;
  const def = cardPool[id];
  // Only a synthesized companion is both a site and a carrier of the effect —
  // `acts-as-site` itself is printed on resource-event cards.
  if (!isSiteCard(def) || !def.effects?.some(effect => effect.type === 'acts-as-site')) return null;
  const sourceId = id.slice(0, -ACTS_AS_SITE_ID_SUFFIX.length);
  return cardPool[sourceId] ? sourceId : null;
}

/**
 * Builds the vocabulary from a card pool (sorted keys, indices from 1).
 *
 * Synthesized `acts-as-site` companions get no index of their own: they are
 * aliased to their source card, so a company standing on one embeds as the
 * card it actually is, and the hash stays a function of the real card
 * universe — certifying such a card must not invalidate every trained model.
 */
export function buildCardVocab(cardPool: Readonly<Record<string, CardDefinition>>): CardVocab {
  const aliases = new Map<string, string>();
  for (const id of Object.keys(cardPool)) {
    const sourceId = actsAsSiteSourceId(id, cardPool);
    if (sourceId !== null) aliases.set(id, sourceId);
  }
  const ids = Object.keys(cardPool)
    .filter(id => !aliases.has(id))
    .sort();
  const index = new Map<string, number>(ids.map((id, i) => [id, i + 1]));
  return {
    size: ids.length,
    hash: fnv1a(ids.join('\n')),
    indexOf: definitionId =>
      definitionId === null || definitionId === undefined
        ? 0
        : index.get(aliases.get(definitionId) ?? definitionId) ?? 0,
  };
}
