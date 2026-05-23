/**
 * @module tw-266.test
 *
 * Card test: Lesser Ring (tw-266)
 * Type: hero-resource-item (special), non-unique
 *
 * Text: "Lesser Ring. Playable only with a gold ring and after a test indicates
 *   Lesser Ring. +2 to direct influence."
 *
 * Effects:
 * | # | Effect Type      | Status          | Notes                                           |
 * |---|------------------|-----------------|-------------------------------------------------|
 * | 1 | play-restriction | NOT IMPLEMENTED | Gold ring test replacement (Rule 9.21) not done  |
 * | 2 | stat-modifier    | OK              | +2 direct-influence, unconditional              |
 *
 * NOT CERTIFIED — the gold ring test replacement step (Rule 9.21) is not yet
 * implemented in the engine. Once the ring-play-offer mechanic is added, this
 * card's play restriction must also be covered by a test.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';

const LESSER_RING = 'tw-266' as CardDefinitionId;

describe('Lesser Ring (tw-266)', () => {
  beforeEach(() => resetMint());

  // ── Effect 2: +2 direct-influence (unconditional) ─────────────────────────

  test('+2 DI applied to bearer — effectiveStats.directInfluence increases by 2', () => {
    // The Lesser Ring's stat-modifier is unconditional: it is applied during
    // recompute-derived and reflected in effectiveStats.directInfluence.
    // Aragorn base DI = 3; with Lesser Ring attached: expected 3 + 2 = 5.
    const stateWith = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [LESSER_RING] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stateWithout = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDI = (pool[ARAGORN as string] as CharacterCard).directInfluence;
    const diWithRing = getCharacter(stateWith, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence;
    const diWithout = getCharacter(stateWithout, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence;

    expect(diWithout).toBe(baseDI);
    expect(diWithRing).toBe(baseDI + 2);
  });
});
