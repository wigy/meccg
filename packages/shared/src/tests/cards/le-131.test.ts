/**
 * @module le-131.test
 *
 * Card test: Rats! (le-131)
 * Type: hazard-event (short)
 *
 * "Playable on a company containing at least one minor item that is at or
 *  moving to a Ruins & Lairs [{R}], Shadow-hold [{S}], or Dark-hold [{D}].
 *  Company discards one minor item of its choice or chooses one of its
 *  unwounded characters to become wounded (no body check required)."
 *
 * Card shape:
 *   - effects[0]: play-target (company; filter target.siteType in
 *                 [ruins-and-lairs, shadow-hold, dark-hold] AND
 *                 target.itemSubtypes includes "minor")
 *
 * Bug regression (game mu70l0qs-8p1015, turn 5, stateSeq 321): before this
 * fix, le-131 carried an empty `effects` array (never certified), so the
 * company-targeting short-event fallback in movement-hazard.ts offered it
 * unconditionally — including against a company moving to a Border-hold,
 * which the card text explicitly excludes.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, HAZARD_PLAYER, P1_COMPANY,
  ARAGORN, DAGGER_OF_WESTERNESSE,
  RIVENDELL, MORIA, BREE,
  buildTestState, resetMint, makeMHState,
  findHandCardId,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction } from '../../index.js';

const RATS = 'le-131' as CardDefinitionId;

/** Viable play-hazard actions for Rats! specifically. */
function ratsActions(state: GameState): PlayHazardAction[] {
  const cardId = findHandCardId(state, HAZARD_PLAYER, RATS);
  return computeLegalActions(state, PLAYER_2)
    .filter(a => a.viable && a.action.type === 'play-hazard'
      && a.action.cardInstanceId === cardId)
    .map(a => a.action as PlayHazardAction);
}

/** Hero company moving from Rivendell to `destination`; hazard player holds le-131. */
function movingState(
  characters: (CardDefinitionId | { defId: CardDefinitionId; items?: CardDefinitionId[] })[],
  destination: CardDefinitionId,
): GameState {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, destinationSite: destination, characters }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [RATS], siteDeck: [] },
    ],
  });
  return { ...base, phaseState: makeMHState() };
}

describe('Rats! (le-131)', () => {
  beforeEach(() => resetMint());

  test('playable on a company with a minor item moving to a Shadow-hold', () => {
    const s = movingState([{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }], MORIA);
    const actions = ratsActions(s);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCompanyId).toBe(P1_COMPANY);
  });

  test('NOT playable on a company with a minor item moving to a Border-hold', () => {
    // Regression: reported bug — Rats! was offered on a company moving to
    // Bree (border-hold), which the card text excludes.
    const s = movingState([{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }], BREE);
    expect(ratsActions(s)).toHaveLength(0);
  });

  test('NOT playable on a company without a minor item, even moving to a Shadow-hold', () => {
    const s = movingState([ARAGORN], MORIA);
    expect(ratsActions(s)).toHaveLength(0);
  });
});
