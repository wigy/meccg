/**
 * @module le-117.test
 *
 * Card test: Long Winter (le-117)
 * Type: hazard-event (long / environment), non-unique
 *
 * Card text:
 *   "Environment. Each moving company that has at least two Wildernesses [{w}]
 *    in its site path must return to its site of origin unless it contains a
 *    ranger. Additionally, if Doors of Night is in play, each non-Haven/
 *    non-Darkhaven site in play with at least two Wildernesses [{w}] in its
 *    site path is tapped. Cannot be duplicated."
 *
 * Engine Support:
 * | # | Rule                                                  | Status          | Notes                                                           |
 * |---|-------------------------------------------------------|-----------------|-----------------------------------------------------------------|
 * | 1 | Force moving company (≥2 Wilderness, no ranger) home  | PARTIAL         | force-return-to-origin tag exists & is consumed by Goldberry's  |
 * |   |                                                       |                 | cancel, but the ACTUAL return is rule 5.31 — unimplemented      |
 * |   |                                                       |                 | (rule-5.31-returned-to-origin.test.ts is test.todo)             |
 * | 2 | Doors of Night: tap each non-Haven/non-Darkhaven site | NOT IMPLEMENTED | no DSL effect / no multi-company site-tap subsystem             |
 * |   | in play with ≥2 Wilderness in its site path           |                 |                                                                 |
 * | 3 | Cannot be duplicated                                  | IMPLEMENTED     | duplication-limit scope game max 1                              |
 *
 * Playable: PARTIALLY — NOT CERTIFIED.
 * Rules 1 (actual return enforcement, rule 5.31) and 2 (Doors-of-Night site
 * tap) are not implemented in the engine. This test covers the implemented
 * pieces with real assertions and marks the rest test.todo as a living spec.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState,
  attachAllyToChar, findCharInstanceId, viableActions,
  mint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay,
  CancelReturnToOriginAction, MovementHazardPhaseState,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const LONG_WINTER = 'le-117' as CardDefinitionId;
const GOLDBERRY = 'tw-245' as CardDefinitionId;

describe('Long Winter (le-117)', () => {
  beforeEach(() => resetMint());

  const longWinterInPlay: CardInPlay = {
    instanceId: 'long-winter-1' as CardInstanceId,
    definitionId: LONG_WINTER,
    status: CardStatus.Untapped,
  };

  // ─── Rule 3: Cannot be duplicated (duplication-limit scope game max 1) ─────

  test('Long Winter IS playable as a hazard long-event when no copy is in play', () => {
    // Positive control: with the hazard limit available and nothing in play,
    // the hazard player may play Long Winter against the active company.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LONG_WINTER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: MovementHazardPhaseState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
    });
    const readyState = { ...state, phaseState: mhState };
    const longWinterInstanceId = readyState.players[1].hand[0].instanceId;

    const playActions = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === longWinterInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('a second Long Winter is NOT playable while one is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LONG_WINTER], siteDeck: [MINAS_TIRITH], cardsInPlay: [longWinterInPlay] },
      ],
    });
    const mhState: MovementHazardPhaseState = makeMHState({
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
    });
    const readyState = { ...state, phaseState: mhState };
    const longWinterInstanceId = readyState.players[1].hand[0].instanceId;

    // No viable play-hazard action for the duplicate copy.
    const viablePlays = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === longWinterInstanceId);
    expect(viablePlays).toHaveLength(0);

    // It is explicitly offered as a non-viable play whose reason cites duplication.
    const blocked = computeLegalActions(readyState, PLAYER_2)
      .filter(ea => !ea.viable
        && ea.action.type === 'play-hazard'
        && (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === longWinterInstanceId);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].reason ?? '').toMatch(/duplicat/i);
  });

  // ─── Rule 1: force-return-to-origin TAG is consumed by Goldberry's cancel ──
  // (The actual return — rule 5.31 — is not enforced; see test.todo below.)

  test('Goldberry can cancel a Long Winter return-to-origin chain entry', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    const longWinterCard = { instanceId: mint(), definitionId: LONG_WINTER };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: makeMHState() },
      PLAYER_2,
      longWinterCard,
      { type: 'long-event' },
    );

    // Resource player gets priority to respond.
    expect(withChain.chain!.priority).toBe(PLAYER_1);

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId = withChain.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    expect(cancelActions.some(a => a.allyInstanceId === goldberryInstanceId
      && a.targetInstanceId === longWinterCard.instanceId)).toBe(true);
  });

  // ─── Unimplemented engine rules (NOT CERTIFIED) ───────────────────────────
  // These rules are described by the card text but have no engine enforcement
  // yet. Documented here as a living spec so the gap is explicit.

  // Rule 1 enforcement (CoE 2.IV.4 / rule 5.31): a moving company with ≥2
  // Wildernesses in its site path and no ranger must actually return to its
  // site of origin (M/H phase ends, no site path, no site-phase actions).
  // The force-return-to-origin effect is only consumed as a Goldberry-cancel
  // tag today; the return itself is unimplemented.
  test.todo('moving company with ≥2 Wildernesses and no ranger is returned to its site of origin');
  test.todo('moving company containing a ranger is NOT returned to its site of origin');

  // Rule 2: while Doors of Night is in play, each non-Haven/non-Darkhaven site
  // in play whose site path has ≥2 Wildernesses is tapped. No DSL effect and
  // no multi-company site-tapping subsystem exists for this.
  test.todo('Doors of Night in play: non-Haven sites with ≥2 Wildernesses in their site path are tapped');
});
