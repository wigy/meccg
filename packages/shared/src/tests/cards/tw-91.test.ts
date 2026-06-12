/**
 * @module tw-91.test
 *
 * Card test: Snowstorm (tw-91)
 * Type: hazard-event (Long-event, Environment)
 * Unique: no
 *
 * Card text:
 *   "Environment. Playable if Doors of Night is in play. Each moving company
 *    with a Wilderness [{w}] in its site path must return to its site of
 *    origin. Cannot be duplicated."
 *
 * Effects (data):
 *   - play-condition, requires card-in-play "Doors of Night"
 *   - force-return-to-origin, condition { sitePath.wildernessCount: { $gte: 1 } }
 *   - duplication-limit, scope game, max 1
 *
 * Engine Support:
 * | # | Rule                                                  | Status      | Notes                                                       |
 * |---|-------------------------------------------------------|-------------|-------------------------------------------------------------|
 * | 1 | Environment / long-event enters play on resolution    | IMPLEMENTED | resolveLongEvent adds card to cardsInPlay                   |
 * | 2 | force-return-to-origin tag recognised by chain engine | IMPLEMENTED | chain.ts cancelReturnToOriginChainActions keys off the tag  |
 * | 3 | Moving company with a Wilderness returns to origin     | IMPLEMENTED | rule 5.31 enforcement in endCompanyMH (reducer-movement-hazard.ts) |
 * | 4 | Playable only if Doors of Night is in play            | IMPLEMENTED | play-condition `card-in-play` gate in legal-actions/movement-hazard.ts |
 * | 5 | Cannot be duplicated                                   | IMPLEMENTED | duplication-limit scope game, max 1                         |
 *
 * Playable: FULLY — CERTIFIED (2026-06-12).
 *
 * Every printed rule is enforced: the rule-5.31 force-return (foundation), the
 * Doors-of-Night `card-in-play` play gate, and the game-scope duplication
 * limit. The `force-return-to-origin` cancellation-target slice (Goldberry,
 * tw-245) is exercised here and from Goldberry's perspective in tw-245.test.ts.
 * Generic rule-5.31 coverage lives in rule-5.31-returned-to-origin.test.ts.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState,
  resetMint,
  dispatch,
  Phase,
  attachAllyToChar,
  findCharInstanceId,
  makeMHState,
  addCardInPlay,
  buildForceReturnMHState,
  mint,
  PLAYER_1,
  PLAYER_2,
  ARAGORN,
  LEGOLAS,
  RIVENDELL,
  LORIEN,
  MORIA,
  MINAS_TIRITH,
  RESOURCE_PLAYER,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, CancelReturnToOriginAction, PlayHazardAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const SNOWSTORM = 'tw-91' as CardDefinitionId;
const GOLDBERRY = 'tw-245' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

describe('Snowstorm (tw-91)', () => {
  beforeEach(() => {
    resetMint();
  });

  // ─── Implemented: force-return-to-origin tag is recognised on the chain ───

  test('Snowstorm on the M/H chain is recognised as a return-to-origin source (cancelable by Goldberry)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGoldberry = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);

    // The active company is moving through a Wilderness — Snowstorm's condition.
    const mhState = makeMHState({ resolvedSitePath: [RegionType.Wilderness] });

    const snowstormCard = { instanceId: mint(), definitionId: SNOWSTORM };
    const withChain = initiateChain(
      { ...withGoldberry, phaseState: mhState },
      PLAYER_2,
      snowstormCard,
      { type: 'long-event' },
    );

    const aragornId = findCharInstanceId(withChain, RESOURCE_PLAYER, ARAGORN);
    const goldberryInstanceId =
      withChain.players[RESOURCE_PLAYER].characters[aragornId as string]?.allies[0]?.instanceId;
    expect(goldberryInstanceId).toBeDefined();

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin')
      .map(ea => ea.action as CancelReturnToOriginAction);

    // The chain engine consults Snowstorm's force-return-to-origin effect, so
    // the targeted cancellation is offered against the Snowstorm chain entry.
    expect(
      cancelActions.some(
        a => a.allyInstanceId === goldberryInstanceId
          && a.targetInstanceId === snowstormCard.instanceId,
      ),
    ).toBe(true);
  });

  test('without a force-return ally, no cancel-return-to-origin action is offered for Snowstorm', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const snowstormCard = { instanceId: mint(), definitionId: SNOWSTORM };
    const withChain = initiateChain(
      { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) },
      PLAYER_2,
      snowstormCard,
      { type: 'long-event' },
    );

    const cancelActions = computeLegalActions(withChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-return-to-origin');

    expect(cancelActions).toHaveLength(0);
  });

  // ─── Rule 5.31: a moving company with a Wilderness returns to origin ──────

  test('a moving company with a Wilderness in its site path returns to its site of origin', () => {
    // Snowstorm in play; the active company moves through a Wilderness.
    const { state, originInstanceId } = buildForceReturnMHState(
      [ARAGORN], [RegionType.Wilderness], SNOWSTORM,
    );

    const afterPass1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const after = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    const company = after.players[RESOURCE_PLAYER].companies[0];
    // The company did not move — it stays at its site of origin (MINAS_TIRITH).
    expect(company.currentSite?.instanceId).toBe(originInstanceId);
    expect(company.currentSite?.definitionId).toBe(MINAS_TIRITH);
    expect(company.moved).toBe(false);
  });

  // ─── Playable only if Doors of Night is in play ──────────────────────────

  test('Snowstorm is only playable while Doors of Night is in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SNOWSTORM], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...built, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const snowstormHandId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === SNOWSTORM)!.instanceId;
    const isSnowstormPlay = (ea: { action: { type: string } }) =>
      ea.action.type === 'play-hazard'
      && (ea.action as PlayHazardAction).cardInstanceId === snowstormHandId;

    // Without Doors of Night in play, Snowstorm is offered but not viable.
    const withoutDon = computeLegalActions(state, PLAYER_2).find(isSnowstormPlay);
    expect(withoutDon?.viable).toBe(false);
    expect(withoutDon?.reason).toMatch(/Doors of Night/);

    // With Doors of Night in play, Snowstorm becomes playable.
    const withDon = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(computeLegalActions(withDon, PLAYER_2).find(isSnowstormPlay)?.viable).toBe(true);
  });

  // ─── Cannot be duplicated ────────────────────────────────────────────────

  test('a second Snowstorm cannot be played while one is in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SNOWSTORM], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const base = { ...built, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
    const snowstormHandId = base.players[HAZARD_PLAYER].hand.find(c => c.definitionId === SNOWSTORM)!.instanceId;

    // Doors of Night satisfied AND a Snowstorm already in play → the second copy
    // is blocked by the duplication limit (not by the Doors-of-Night gate).
    const withCopy = addCardInPlay(
      addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT),
      HAZARD_PLAYER, SNOWSTORM,
    );
    const dup = computeLegalActions(withCopy, PLAYER_2).find(
      ea => ea.action.type === 'play-hazard'
        && ea.action.cardInstanceId === snowstormHandId,
    );
    expect(dup?.viable).toBe(false);
    expect(dup?.reason).toMatch(/duplicat/i);
  });
});
