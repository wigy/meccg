/**
 * @module tw-420.test
 *
 * Card test: Rhosgobel (tw-420)
 * Type: hero-site (free-hold)
 * Effects: 1 (site-rule: healing-affects-all)
 *
 * "Nearest Haven: Lórien. Playable: Items (minor).
 *  Special: Healing effects affect all characters at the site."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                            |
 * | 2 | sitePath          | OK     | wilderness, border, dark — matches card        |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool            |
 * | 4 | playableResources | OK     | minor items                                    |
 * | 5 | automaticAttacks  | OK     | Empty                                          |
 * | 6 | resourceDraws     | OK     | 2                                              |
 * | 7 | hazardDraws       | OK     | 3                                              |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                                       |
 * |---|-------------------------|-------------|---------------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc.         |
 * | 2 | Haven path movement     | IMPLEMENTED | movement-map.ts                             |
 * | 3 | site-rule healing-all   | IMPLEMENTED | reducer-events.ts, site variant spread      |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used              |
 * | 5 | Item (minor) playability| IMPLEMENTED | playableResources filter                    |
 *
 * Playable: YES
 * Certified: 2026-04-22
 */

import { describe, test, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LORIEN, MORIA, MINAS_TIRITH,
  ARAGORN, BILBO, LEGOLAS, IORETH, HALFLING_STRENGTH,
  resetMint, buildTestState, Phase, CardStatus,
  findCharInstanceId, handCardId, dispatch,
  expectCharStatus, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const RHOSGOBEL = 'tw-420' as CardDefinitionId;

describe('Rhosgobel (tw-420)', () => {
  beforeEach(() => resetMint());

  // ─── Healing-affects-all site rule ─────────────────────────────────────────

  test('Halfling Strength heal at Rhosgobel extends to another wounded character in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RHOSGOBEL,
            characters: [
              { defId: BILBO, status: CardStatus.Inverted },
              { defId: ARAGORN, status: CardStatus.Inverted },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'heal',
    });

    // Both wounded characters in the company heal because the company's
    // site (Rhosgobel) carries site-rule healing-affects-all.
    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('healing at Rhosgobel extends to all wounded characters (three-character company)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RHOSGOBEL,
            characters: [
              { defId: BILBO, status: CardStatus.Inverted },
              { defId: ARAGORN, status: CardStatus.Inverted },
              { defId: IORETH, status: CardStatus.Inverted },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'heal',
    });

    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, IORETH, CardStatus.Untapped);
  });

  test('healing at a non-Rhosgobel site (Moria, no healing rule) does NOT spread', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, status: CardStatus.Inverted },
              { defId: ARAGORN, status: CardStatus.Inverted },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'heal',
    });

    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    // Aragorn remains wounded — the site at Moria has no healing rule.
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('untap option (not a heal) at Rhosgobel does NOT trigger the spread', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RHOSGOBEL,
            characters: [
              { defId: BILBO, status: CardStatus.Tapped },
              { defId: ARAGORN, status: CardStatus.Inverted },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'untap',
    });

    expectCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    // Aragorn is still wounded — untapping a tapped character is not healing.
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });
});
