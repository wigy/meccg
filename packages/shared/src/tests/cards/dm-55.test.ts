/**
 * @module dm-55.test
 *
 * Card test: Exhalation of Decay (dm-55)
 * Type: hazard-event (short)
 * Effects: 1 (play-creature-from-discard — engine mechanic)
 *
 * Card text:
 *   "Playable on an Undead hazard creature in your discard pile. If target
 *    Undead can attack, bring it into play as a creature that attacks
 *    immediately (not counting against the hazard limit). The attack's
 *    prowess is modified by -1."
 *
 * Mechanic (play-creature-from-discard effect):
 *   The hazard player plays this short event from hand to bring an Undead
 *   hazard-creature out of their own discard pile as an immediate attack
 *   against the active company. The creature must satisfy normal creature
 *   keying ("if target Undead can attack"). The play does NOT count against
 *   the hazard limit. The attack's prowess is modified by -1. The event card
 *   is discarded on play; the spawned creature is disposed by the normal
 *   combat-finalization rules afterward.
 *
 * Engine Support:
 * | # | Rule                                            | Status |
 * |---|-------------------------------------------------|--------|
 * | 1 | Offered for an Undead creature in the discard   | IMPL   |
 * | 2 | Only Undead creatures eligible (filter)         | IMPL   |
 * | 3 | Only when target Undead can attack (keying)     | IMPL   |
 * | 4 | Brings creature into play as an immediate attack| IMPL   |
 * | 5 | Does not count against the hazard limit         | IMPL   |
 * | 6 | Attack's prowess modified by -1                 | IMPL   |
 * | 7 | Event card discarded, creature leaves discard   | IMPL   |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  BARROW_WIGHT, ORC_PATROL,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions,
  dispatch,
  resolveChain,
  makeShadowMHState,
  makeWildernessMHState,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const EXHALATION_OF_DECAY = 'dm-55' as CardDefinitionId;

/** Active (resource) company at MORIA; hazard player holds dm-55, discard seeded. */
function setup(opts: {
  hazardDiscard: CardDefinitionId[];
  mh: MovementHazardPhaseState;
}) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [EXHALATION_OF_DECAY],
        discardPile: opts.hazardDiscard,
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...base, phaseState: opts.mh };
}

describe('Exhalation of Decay (dm-55)', () => {
  beforeEach(() => resetMint());

  test('offered for an Undead creature in the discard pile when it can be keyed', () => {
    const state = setup({ hazardDiscard: [BARROW_WIGHT], mh: makeShadowMHState() });
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not offered when the target Undead cannot be keyed (wrong region)', () => {
    // Barrow-wight keys to shadow/dark regions or shadow-hold/dark-hold sites.
    // A wilderness-only path cannot key it → "target Undead cannot attack".
    const state = setup({ hazardDiscard: [BARROW_WIGHT], mh: makeWildernessMHState() });
    expect(viableActions(state, PLAYER_2, 'play-creature-from-discard')).toHaveLength(0);
  });

  test('not offered for a non-Undead creature in the discard pile', () => {
    // Orc-patrol is in the discard pile but the effect filter is race=undead.
    const state = setup({ hazardDiscard: [ORC_PATROL], mh: makeShadowMHState() });
    expect(viableActions(state, PLAYER_2, 'play-creature-from-discard')).toHaveLength(0);
  });

  test('only the Undead creature is offered when discard mixes races', () => {
    const state = setup({ hazardDiscard: [ORC_PATROL, BARROW_WIGHT], mh: makeShadowMHState() });
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    // One action (Barrow-wight), keyed by the single shadow region in the path.
    expect(actions.length).toBeGreaterThan(0);
    const wightId = state.players[HAZARD_PLAYER].discardPile.find(
      c => c.definitionId === BARROW_WIGHT,
    )!.instanceId;
    for (const { action } of actions) {
      expect((action as { creatureInstanceId: string }).creatureInstanceId).toBe(wightId);
    }
  });

  test('playing brings the creature into combat with prowess modified by -1', () => {
    const state = setup({ hazardDiscard: [BARROW_WIGHT], mh: makeShadowMHState() });
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    expect(actions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(state, actions[0].action);
    const afterChain = resolveChain(afterPlay);

    // Combat initiated; Barrow-wight base prowess 12 → 11 with the -1 modifier.
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(11);
  });

  test('does not count against the hazard limit (offered when limit reached; counter unchanged)', () => {
    const mh = makeShadowMHState({ hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4 });
    const state = setup({ hazardDiscard: [BARROW_WIGHT], mh });

    // Even at the hazard limit, the play is still offered.
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    expect(actions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(state, actions[0].action);
    // The hazard-played counter is NOT incremented.
    expect((afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(4);
  });

  test('event card is discarded and the creature leaves the discard pile on play', () => {
    const state = setup({ hazardDiscard: [BARROW_WIGHT], mh: makeShadowMHState() });
    const eventId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const wightId = state.players[HAZARD_PLAYER].discardPile[0].instanceId;

    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    const afterPlay = dispatch(state, actions[0].action);

    const p2 = afterPlay.players[HAZARD_PLAYER];
    // dm-55 left the hand.
    expect(p2.hand.some(c => c.instanceId === eventId)).toBe(false);
    // dm-55 short event was discarded.
    expect(p2.discardPile.some(c => c.instanceId === eventId)).toBe(true);
    // The creature left the discard pile (it now resides on the chain entry).
    expect(p2.discardPile.some(c => c.instanceId === wightId)).toBe(false);
    // The creature instance is preserved on the chain.
    expect(afterPlay.chain).not.toBeNull();
  });
});
