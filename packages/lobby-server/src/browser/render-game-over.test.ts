/**
 * @module render-game-over.test
 *
 * Regression test for bug report e266e75aeb194e54 (game msp2hpsg-r85hrs, seq
 * 1165): a player stored The Arkenstone [M] (le-418), Vile Fumes (wh-54) and
 * Blasting Fire (wh-51) at a site during Organization. The marshalling-point
 * totals were correct (16 item MP, including the 5 from these three stored
 * items), but the Game Over view's card-thumbnail row for the "item" category
 * did not display them.
 *
 * Root cause: `collectMPCards`'s killPile loop only attributed a card to a
 * category when it had an explicit `storable-at` effect or a
 * `killMarshallingPoints` field (defeated creatures). Regular items — storable
 * at any Haven without a `storable-at` effect, per CoE rule 2.II.4 — fell
 * through both branches and were silently dropped from the display, even
 * though `recompute-derived.ts`'s `addItemMP` fallback already counted their
 * MP toward the authoritative total.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardDefinitionId, CharacterInPlay } from '@meccg/shared';
import { collectMPCards } from './render-game-over.js';

const ARKENSTONE_M = 'le-418' as CardDefinitionId;
const VILE_FUMES = 'wh-54' as CardDefinitionId;
const BLASTING_FIRE = 'wh-51' as CardDefinitionId;

const cardPool = {
  [ARKENSTONE_M]: {
    id: ARKENSTONE_M,
    name: 'The Arkenstone',
    cardType: 'minion-resource-item',
    marshallingPoints: 3,
    marshallingCategory: 'item',
  },
  [VILE_FUMES]: {
    id: VILE_FUMES,
    name: 'Vile Fumes',
    cardType: 'minion-resource-item',
    marshallingPoints: 1,
    marshallingCategory: 'item',
  },
  [BLASTING_FIRE]: {
    id: BLASTING_FIRE,
    name: 'Blasting Fire',
    cardType: 'minion-resource-item',
    marshallingPoints: 1,
    marshallingCategory: 'item',
  },
} as unknown as Readonly<Record<string, CardDefinition>>;

describe('collectMPCards includes regular stored items without a storable-at effect', () => {
  test('stored items with no storable-at effect appear in the item category', () => {
    const killPile = [
      { instanceId: 'p1-28', definitionId: ARKENSTONE_M, storedAtSite: 'le-367' as CardDefinitionId },
      { instanceId: 'p1-30', definitionId: VILE_FUMES, storedAtSite: 'le-367' as CardDefinitionId },
      { instanceId: 'p1-11', definitionId: BLASTING_FIRE, storedAtSite: 'le-367' as CardDefinitionId },
    ];

    const result = collectMPCards({} as Readonly<Record<string, CharacterInPlay>>, [], killPile, cardPool);

    expect(result.item).toEqual([
      { defId: ARKENSTONE_M, mp: 3 },
      { defId: VILE_FUMES, mp: 1 },
      { defId: BLASTING_FIRE, mp: 1 },
    ]);
  });
});
