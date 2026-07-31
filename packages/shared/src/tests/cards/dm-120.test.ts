/**
 * @module dm-120.test
 *
 * Card test: Choice of Lúthien (dm-120)
 * Type: hero-resource-event (permanent)
 * Effects: play-target (character: Arwen only),
 *          play-target (site: Minas Tirith only),
 *          stat-modifier (+2 direct-influence),
 *          stat-modifier (+2 mind)
 *
 * "Unique. Playable on Arwen in Minas Tirith. She receives +2 direct
 *  influence and her mind increases by 2. Discard if Arwen moves to a site
 *  not in Anórien, Lebennin, Lamedon, Belfalas, or Anfalas. Tap Arwen to
 *  take one item, ally, or faction playable at her current site from your
 *  play deck or discard pile into your hand (reshuffle play deck if
 *  searched)."
 *
 * Bug report: with Choice of Lúthien attached, Arwen's own "+7 direct
 * influence only usable against Aragorn II" (tw-122) plus the card's +2
 * direct influence must total 9 — exactly matching Aragorn II's mind (9)
 * — so she can take control of him as a follower (CoE 2.II.3.2). Before
 * this card's effects were implemented (effects: []), Arwen's available DI
 * against Aragorn topped out at 7, one short of his mind, so the engine
 * never offered the move.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, LORIEN,
  RESOURCE_PLAYER,
  attachItemToChar,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId } from '../../index.js';
import type { MoveToInfluenceAction } from '../../types/actions-organization.js';

const ARWEN = 'tw-122' as CardDefinitionId;
const CHOICE_OF_LUTHIEN = 'dm-120' as CardDefinitionId;

describe('Choice of Lúthien (dm-120)', () => {
  beforeEach(() => resetMint());

  function buildCompany() {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, ARWEN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });
  }

  test('Arwen cannot control Aragorn II without Choice of Lúthien (available DI 7 < his mind 9)', () => {
    const state = buildCompany();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const arwenId = findCharInstanceId(state, RESOURCE_PLAYER, ARWEN);
    const moves = viableActions(state, PLAYER_1, 'move-to-influence') as { action: MoveToInfluenceAction }[];

    expect(moves.some(a =>
      a.action.characterInstanceId === aragornId &&
      a.action.controlledBy === arwenId,
    )).toBe(false);
  });

  test('Arwen CAN control Aragorn II with Choice of Lúthien attached (available DI 2+7=9 meets his mind 9)', () => {
    const withCard = attachItemToChar(buildCompany(), RESOURCE_PLAYER, ARWEN, CHOICE_OF_LUTHIEN);
    const state = recomputeDerived(withCard);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const arwenId = findCharInstanceId(state, RESOURCE_PLAYER, ARWEN);
    const moves = viableActions(state, PLAYER_1, 'move-to-influence') as { action: MoveToInfluenceAction }[];

    expect(moves.some(a =>
      a.action.characterInstanceId === aragornId &&
      a.action.controlledBy === arwenId,
    )).toBe(true);
  });
});
