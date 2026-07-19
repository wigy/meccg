/**
 * @module tw-350.test
 *
 * Card test: Tom Bombadil (tw-350)
 * Type: hero-resource-ally (unique, prowess 12 / body 11, 3 MP)
 * Effects: 2
 *   1. grant-action cancel-chain-entry — tap Tom (self) to cancel a hazard
 *      being played while his company is moving to a site in Arthedain,
 *      Cardolan, Rhudaur, or The Shire.
 *   2. on-event company-arrives-at-site → discard-self when the arrival site's
 *      region is NOT one of those four.
 *
 * Card text (CRF 22 erratum):
 *   "Unique. Playable at Old Forest. Tap to cancel a hazard that targets (as an
 *    active condition of playing the card itself) a company, or an entity
 *    associated with a company, moving to a site in: Arthedain, Cardolan,
 *    Rhudaur, or The Shire. Discard Tom Bombadil if his company moves to a
 *    site that is not in: Arthedain, Cardolan, Rhudaur, or The Shire."
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                            |
 * |---|--------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | Tap-to-cancel offered when moving to home region  | IMPLEMENTED | emitAllyCancelChainActions in movement-hazard.ts |
 * | 2 | Not offered when destination region disallowed    | IMPLEMENTED | grant-action `when` on destinationRegion         |
 * | 3 | Not offered when no hazard is on the chain        | IMPLEMENTED | countUnresolvedChainHazards gate                 |
 * | 4 | Not offered when Tom is already tapped            | IMPLEMENTED | untapped-ally gate                               |
 * | 5 | Activating taps Tom and negates the chain hazard  | IMPLEMENTED | handleGrantActionApply cancel-chain-entry        |
 * | 6 | Discard on move to a disallowed region            | IMPLEMENTED | on-event discard-self in fireAllyArrivalEffects  |
 * | 7 | Stays on move to an allowed region                | IMPLEMENTED | when condition filters by site.region            |
 *
 * Certified: 2026-07-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, CardInstanceId, ActivateGrantedAction } from '../../index.js';
import {
  buildTestState, resetMint, Phase, CardStatus,
  attachAllyToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE,
  BREE, MINAS_TIRITH, MORIA, RIVENDELL, LORIEN,
  makeMHState, dispatch, RESOURCE_PLAYER,
  findCharInstanceId, mint,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const TOM_BOMBADIL = 'tw-350' as CardDefinitionId;

/** Instance ID of the Tom Bombadil ally attached to Aragorn. */
function tomInstanceId(state: ReturnType<typeof buildTestState>): CardInstanceId {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
  const ally = state.players[RESOURCE_PLAYER].characters[charId].allies.find(
    a => a.definitionId === TOM_BOMBADIL,
  );
  if (!ally) throw new Error('Tom Bombadil not attached');
  return ally.instanceId;
}

/** All viable Tom Bombadil cancel-chain-entry activations for PLAYER_1. */
function tomCancelActions(state: ReturnType<typeof buildTestState>): ActivateGrantedAction[] {
  return computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === 'cancel-chain-entry' && a.sourceCardDefinitionId === TOM_BOMBADIL);
}

/**
 * Build a movement/hazard `play-hazards` state where P1's company (with Tom
 * attached to Aragorn) is moving to `destination`, and P2 has just played a
 * Cave-drake onto the chain.
 */
function buildMovingWithChain(destination: CardDefinitionId) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: destination }], hand: [], siteDeck: [destination] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [MORIA] },
    ],
  });
  const withTom = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, TOM_BOMBADIL);
  const mhState = makeMHState({ activeCompanyIndex: 0 });
  const caveDrakeCard = { instanceId: mint(), definitionId: CAVE_DRAKE };
  const withChain = initiateChain(
    { ...withTom, phaseState: mhState },
    PLAYER_2,
    caveDrakeCard,
    { type: 'creature' },
  );
  return withChain;
}

describe('Tom Bombadil (tw-350)', () => {
  beforeEach(() => resetMint());

  // ─── Tap-to-cancel ability ───────────────────────────────────────────────

  test('offers tap-to-cancel when company is moving to a site in an allowed region (Bree — Arthedain)', () => {
    const state = buildMovingWithChain(BREE);
    const actions = tomCancelActions(state);
    expect(actions.length).toBe(1);
    // Tom taps himself: the action carries Tom as the source and Aragorn (his
    // bearer) as the character whose grant is exercised.
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(actions[0].sourceCardId).toBe(tomInstanceId(state));
    expect(actions[0].characterId).toBe(aragornId);
  });

  test('does NOT offer tap-to-cancel when moving to a disallowed region (Minas Tirith — Anórien)', () => {
    const state = buildMovingWithChain(MINAS_TIRITH);
    expect(tomCancelActions(state).length).toBe(0);
  });

  test('does NOT offer tap-to-cancel when no hazard is on the chain', () => {
    // Same allowed destination, but no chain initiated.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }], hand: [], siteDeck: [BREE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withTom = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, TOM_BOMBADIL);
    const state = { ...withTom, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(tomCancelActions(state).length).toBe(0);
  });

  test('does NOT offer tap-to-cancel when Tom is already tapped', () => {
    const state = buildMovingWithChain(BREE);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const tomId = tomInstanceId(state);
    // Tap Tom in place.
    const tapped = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [aragornId as string]: {
              ...state.players[0].characters[aragornId],
              allies: state.players[0].characters[aragornId].allies.map(
                a => a.instanceId === tomId ? { ...a, status: CardStatus.Tapped } : a,
              ),
            },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    expect(tomCancelActions(tapped).length).toBe(0);
  });

  test('activating the ability taps Tom and negates the chain hazard', () => {
    const state = buildMovingWithChain(BREE);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const tomId = tomInstanceId(state);

    const result = dispatch(state, {
      type: 'activate-granted-action',
      player: PLAYER_1,
      characterId: aragornId,
      sourceCardId: tomId,
      sourceCardDefinitionId: TOM_BOMBADIL,
      actionId: 'cancel-chain-entry',
      rollThreshold: 0,
    });

    // The Cave-drake entry is negated.
    expect(result.chain!.entries[0].negated).toBe(true);
    // Tom is tapped (the cost); Aragorn is NOT tapped (Tom taps himself).
    const tom = result.players[0].characters[aragornId].allies.find(a => a.instanceId === tomId);
    expect(tom?.status).toBe(CardStatus.Tapped);
    expect(result.players[0].characters[aragornId].status).toBe(CardStatus.Untapped);
  });

  // ─── Discard on move to a disallowed region ──────────────────────────────

  test('is discarded when his company moves to a site outside the allowed regions (Minas Tirith)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withTom = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, TOM_BOMBADIL);
    const tomId = tomInstanceId(withTom);
    const state = { ...withTom, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterPass.players[0].discardPile.some(c => c.instanceId === tomId)).toBe(true);
    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    expect(afterPass.players[0].characters[aragornId].allies.some(a => a.instanceId === tomId)).toBe(false);
  });

  test('stays when his company moves to a site in an allowed region (Bree — Arthedain)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }], hand: [], siteDeck: [BREE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withTom = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, TOM_BOMBADIL);
    const tomId = tomInstanceId(withTom);
    const state = { ...withTom, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterPass.players[0].discardPile.some(c => c.instanceId === tomId)).toBe(false);
    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    expect(afterPass.players[0].characters[aragornId].allies.some(a => a.instanceId === tomId)).toBe(true);
  });
});
