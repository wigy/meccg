/**
 * @module dm-66.test
 *
 * Card test: In Great Wrath (dm-66)
 * Type: hazard-event (short)
 * Effects: 1 (play-creature-from-discard — engine mechanic, shared with dm-55)
 *
 * Card text:
 *   "Playable on a Nazgûl in your discard pile that could immediately attack.
 *    The Nazgûl attacks immediately (not counting against the hazard limit)
 *    with +2 prowess and -1 body."
 *
 * Mechanic (play-creature-from-discard effect, filter race=ringwraith):
 *   The hazard player plays this short event from hand to bring a Nazgûl
 *   hazard-creature out of their own discard pile as an immediate attack
 *   against the active company. The creature must satisfy normal creature
 *   keying ("that could immediately attack"). The play does NOT count against
 *   the hazard limit. The attack's prowess is modified by +2 and its body by
 *   -1. The event card is discarded on play; the spawned creature is disposed
 *   by the normal combat-finalization rules afterward.
 *
 * Engine Support:
 * | # | Rule                                              | Status |
 * |---|----------------------------------------------------|--------|
 * | 1 | Offered for a Nazgûl creature in the discard        | IMPL   |
 * | 2 | Only Ringwraith-race creatures eligible (filter)    | IMPL   |
 * | 3 | Only when target Nazgûl can attack (keying)         | IMPL   |
 * | 4 | Brings creature into play as an immediate attack    | IMPL   |
 * | 5 | Does not count against the hazard limit             | IMPL   |
 * | 6 | Attack's prowess modified by +2                     | IMPL   |
 * | 7 | Attack's body modified by -1                        | IMPL   |
 * | 8 | Event card discarded, creature leaves discard       | IMPL   |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  ORC_PATROL,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions,
  dispatch,
  resolveChain,
  makeMHState,
  makeWildernessMHState,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState } from '../../index.js';

const IN_GREAT_WRATH = 'dm-66' as CardDefinitionId;
/** Witch-king of Angmar — Nazgûl (ringwraith), 17 prowess, 12 body, keyed to Dark [{d}]/Dark-hold [{D}] or named Angmar/Gundabad/Gorgoroth/Imlad Morgul. */
const WITCH_KING = 'tw-113' as CardDefinitionId;

/** MH state describing arrival at a Dark-hold via a Dark-domain region — keys Nazgûl like Witch-king. */
function makeDarkMHState(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Dark],
    resolvedSitePathNames: ['Udûn'],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Barad-dûr',
    ...overrides,
  });
}

/** Active (resource) company at MORIA; hazard player holds dm-66, discard seeded. */
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
        hand: [IN_GREAT_WRATH],
        discardPile: opts.hazardDiscard,
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...base, phaseState: opts.mh };
}

describe('In Great Wrath (dm-66)', () => {
  beforeEach(() => resetMint());

  test('offered for a Nazgûl in the discard pile when it can be keyed', () => {
    const state = setup({ hazardDiscard: [WITCH_KING], mh: makeDarkMHState() });
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not offered when the target Nazgûl cannot be keyed (wrong region)', () => {
    // Witch-king keys to Dark-domain [{d}]/Dark-hold [{D}] or named regions
    // (Angmar, Gundabad, Gorgoroth, Imlad Morgul). A wilderness-only path via
    // Rhudaur cannot key it → "cannot immediately attack".
    const state = setup({ hazardDiscard: [WITCH_KING], mh: makeWildernessMHState() });
    expect(viableActions(state, PLAYER_2, 'play-creature-from-discard')).toHaveLength(0);
  });

  test('not offered for a non-Ringwraith creature in the discard pile', () => {
    // Orc-patrol is in the discard pile but the effect filter is race=ringwraith.
    const state = setup({ hazardDiscard: [ORC_PATROL], mh: makeDarkMHState() });
    expect(viableActions(state, PLAYER_2, 'play-creature-from-discard')).toHaveLength(0);
  });

  test('only the Nazgûl is offered when discard mixes races', () => {
    const state = setup({ hazardDiscard: [ORC_PATROL, WITCH_KING], mh: makeDarkMHState() });
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    expect(actions.length).toBeGreaterThan(0);
    const witchKingId = state.players[HAZARD_PLAYER].discardPile.find(
      c => c.definitionId === WITCH_KING,
    )!.instanceId;
    for (const { action } of actions) {
      expect((action as { creatureInstanceId: string }).creatureInstanceId).toBe(witchKingId);
    }
  });

  test('playing brings the creature into combat with prowess +2 and body -1', () => {
    const state = setup({ hazardDiscard: [WITCH_KING], mh: makeDarkMHState() });
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    expect(actions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(state, actions[0].action);
    const afterChain = resolveChain(afterPlay);

    // Witch-king: base prowess 17 → 19 with +2, base body 12 → 11 with -1.
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(19);
    expect(afterChain.combat!.creatureBody).toBe(11);
  });

  test('does not count against the hazard limit (offered when limit reached; counter unchanged)', () => {
    const mh = makeDarkMHState({ hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4 });
    const state = setup({ hazardDiscard: [WITCH_KING], mh });

    // Even at the hazard limit, the play is still offered.
    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    expect(actions.length).toBeGreaterThan(0);

    const afterPlay = dispatch(state, actions[0].action);
    // The hazard-played counter is NOT incremented.
    expect((afterPlay.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(4);
  });

  test('event card is discarded and the creature leaves the discard pile on play', () => {
    const state = setup({ hazardDiscard: [WITCH_KING], mh: makeDarkMHState() });
    const eventId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const witchKingId = state.players[HAZARD_PLAYER].discardPile[0].instanceId;

    const actions = viableActions(state, PLAYER_2, 'play-creature-from-discard');
    const afterPlay = dispatch(state, actions[0].action);

    const p2 = afterPlay.players[HAZARD_PLAYER];
    // dm-66 left the hand.
    expect(p2.hand.some(c => c.instanceId === eventId)).toBe(false);
    // dm-66 short event was discarded.
    expect(p2.discardPile.some(c => c.instanceId === eventId)).toBe(true);
    // The creature left the discard pile (it now resides on the chain entry).
    expect(p2.discardPile.some(c => c.instanceId === witchKingId)).toBe(false);
    // The creature instance is preserved on the chain.
    expect(afterPlay.chain).not.toBeNull();
  });
});
