/**
 * @module tw-265.test
 *
 * Card test: Leaflock (tw-265)
 * Type: hero-resource-ally (unique, prowess 5 / body 8, 2 MP)
 * Effects: 3
 *   1. grant-action cancel-chain-entry — tap Leaflock (self) to cancel a
 *      hazard being played against his company, unconditionally (no
 *      destination-region gate, unlike Tom Bombadil tw-350).
 *   2. play-flag no-attack-site-keyed — immune to automatic-attacks and
 *      hazards keyed to his site.
 *   3. on-event company-arrives-at-site → discard-self when the arrival
 *      site's region is NOT one of Leaflock's home regions.
 *
 * Card text:
 *   "Unique. Playable at Wellinghall. Tap to cancel a hazard that targets
 *    (as an active condition of playing the card itself) Leaflock's company
 *    or an entity associated with his company. May not be attacked by
 *    automatic-attacks or hazards keyed to his site. Discard Leaflock if his
 *    company moves to a site that is not in: Fangorn, Rohan, Gap of Isen,
 *    Wold & Foothills, Enedhwaith, Old Pûkel-land, Brown Lands, Anduin
 *    Vales, or Redhorn Gate."
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                             |
 * |---|---------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Tap-to-cancel offered whenever a hazard is unresolved | IMPLEMENTED | emitAllyCancelChainActions, no `when` gate     |
 * | 2 | Not offered when no hazard is on the chain         | IMPLEMENTED | hazardCount gate                                  |
 * | 3 | Not offered when Leaflock is already tapped        | IMPLEMENTED | untapped-ally gate                                |
 * | 4 | Activating taps Leaflock and negates the chain hazard | IMPLEMENTED | handleGrantActionApply cancel-chain-entry     |
 * | 5 | Immunity to automatic-attacks/site-keyed hazards   | IMPLEMENTED | play-flag: no-attack-site-keyed (as on Treebeard) |
 * | 6 | Discard on move to a disallowed region             | IMPLEMENTED | on-event discard-self in fireAllyArrivalEffects   |
 * | 7 | Stays on move to an allowed region                 | IMPLEMENTED | when condition filters by site.region             |
 *
 * Certified: 2026-08-18
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, CardInstanceId, ActivateGrantedAction, AssignStrikeAction } from '../../index.js';
import {
  buildTestState, resetMint, Phase, CardStatus,
  attachAllyToChar,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE,
  MINAS_TIRITH, MOUNT_DOOM, RIVENDELL, LORIEN, EDORAS, MORIA, WELLINGHALL,
  makeMHState, dispatch, RESOURCE_PLAYER,
  findCharInstanceId, mint,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const LEAFLOCK = 'tw-265' as CardDefinitionId;

/** Instance ID of the Leaflock ally attached to Aragorn. */
function leaflockInstanceId(state: ReturnType<typeof buildTestState>): CardInstanceId {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
  const ally = state.players[RESOURCE_PLAYER].characters[charId].allies.find(
    a => a.definitionId === LEAFLOCK,
  );
  if (!ally) throw new Error('Leaflock not attached');
  return ally.instanceId;
}

/** All viable Leaflock cancel-chain-entry activations for PLAYER_1. */
function leaflockCancelActions(state: ReturnType<typeof buildTestState>): ActivateGrantedAction[] {
  return computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === 'cancel-chain-entry' && a.sourceCardDefinitionId === LEAFLOCK);
}

/**
 * Build a movement/hazard `play-hazards` state where P1's company (with
 * Leaflock attached to Aragorn) is moving to `destination`, and P2 has just
 * played a Cave-drake onto the chain.
 */
function buildMovingWithChain(destination: CardDefinitionId) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN], destinationSite: destination }], hand: [], siteDeck: [destination] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [MORIA] },
    ],
  });
  const withLeaflock = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LEAFLOCK);
  const mhState = makeMHState({ activeCompanyIndex: 0 });
  const caveDrakeCard = { instanceId: mint(), definitionId: CAVE_DRAKE };
  const withChain = initiateChain(
    { ...withLeaflock, phaseState: mhState },
    PLAYER_2,
    caveDrakeCard,
    { type: 'creature' },
  );
  return withChain;
}

describe('Leaflock (tw-265)', () => {
  beforeEach(() => resetMint());

  // ─── Tap-to-cancel ability ───────────────────────────────────────────────

  test('offers tap-to-cancel while a hazard is unresolved, regardless of destination region', () => {
    // Minas Tirith is in Anórien — outside Leaflock's home regions, but his
    // cancel ability carries no destination-region gate (unlike Tom Bombadil).
    const state = buildMovingWithChain(MINAS_TIRITH);
    const actions = leaflockCancelActions(state);
    expect(actions.length).toBe(1);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(actions[0].sourceCardId).toBe(leaflockInstanceId(state));
    expect(actions[0].characterId).toBe(aragornId);
  });

  test('does NOT offer tap-to-cancel when no hazard is on the chain', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN], destinationSite: EDORAS }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withLeaflock = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LEAFLOCK);
    const state = { ...withLeaflock, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(leaflockCancelActions(state).length).toBe(0);
  });

  test('does NOT offer tap-to-cancel when Leaflock is already tapped', () => {
    const state = buildMovingWithChain(EDORAS);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const leaflockId = leaflockInstanceId(state);
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
                a => a.instanceId === leaflockId ? { ...a, status: CardStatus.Tapped } : a,
              ),
            },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };
    expect(leaflockCancelActions(tapped).length).toBe(0);
  });

  test('activating the ability taps Leaflock and negates the chain hazard', () => {
    const state = buildMovingWithChain(EDORAS);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const leaflockId = leaflockInstanceId(state);

    const result = dispatch(state, {
      type: 'activate-granted-action',
      player: PLAYER_1,
      characterId: aragornId,
      sourceCardId: leaflockId,
      sourceCardDefinitionId: LEAFLOCK,
      actionId: 'cancel-chain-entry',
      rollThreshold: 0,
    });

    expect(result.chain!.entries[0].negated).toBe(true);
    const leaflock = result.players[0].characters[aragornId].allies.find(a => a.instanceId === leaflockId);
    expect(leaflock?.status).toBe(CardStatus.Tapped);
    expect(result.players[0].characters[aragornId].status).toBe(CardStatus.Untapped);
  });

  // ─── Immunity to automatic-attacks / site-keyed hazards ──────────────────

  test('Leaflock is NOT offered as a defender strike target against an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withLeaflock = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LEAFLOCK);
    const withCombat = makeCancelWindowCombat(withLeaflock, {
      attackSourceType: 'automatic-attack',
      strikesTotal: 2,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const leaflockInstId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(leaflockInstId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === leaflockInstId)).toBe(false);
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
    const withLeaflock = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LEAFLOCK);
    const leaflockId = leaflockInstanceId(withLeaflock);
    const state = { ...withLeaflock, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterPass.players[0].discardPile.some(c => c.instanceId === leaflockId)).toBe(true);
    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    expect(afterPass.players[0].characters[aragornId].allies.some(a => a.instanceId === leaflockId)).toBe(false);
  });

  test('is discarded when his company moves to Mount Doom (Gorgoroth — disallowed)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN], destinationSite: MOUNT_DOOM }], hand: [], siteDeck: [MOUNT_DOOM] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withLeaflock = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LEAFLOCK);
    const leaflockId = leaflockInstanceId(withLeaflock);
    const state = { ...withLeaflock, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterPass.players[0].discardPile.some(c => c.instanceId === leaflockId)).toBe(true);
  });

  test('stays when his company moves to a site in an allowed region (Edoras — Rohan)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN], destinationSite: EDORAS }], hand: [], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withLeaflock = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LEAFLOCK);
    const leaflockId = leaflockInstanceId(withLeaflock);
    const state = { ...withLeaflock, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterPass.players[0].discardPile.some(c => c.instanceId === leaflockId)).toBe(false);
    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    expect(afterPass.players[0].characters[aragornId].allies.some(a => a.instanceId === leaflockId)).toBe(true);
  });

  test('stays when his company moves to Moria (Redhorn Gate — allowed)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: WELLINGHALL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withLeaflock = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, LEAFLOCK);
    const leaflockId = leaflockInstanceId(withLeaflock);
    const state = { ...withLeaflock, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterPass.players[0].discardPile.some(c => c.instanceId === leaflockId)).toBe(false);
    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    expect(afterPass.players[0].characters[aragornId].allies.some(a => a.instanceId === leaflockId)).toBe(true);
  });
});
