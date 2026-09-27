/**
 * @module le-133.test
 *
 * Card test: The Ring Will Have But One Master (le-133)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 4 (play-target character bearing The One Ring,
 *             duplication-limit scope:character max:1,
 *             on-event organization-phase-start → enqueue-discard-company-character,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:9)
 *
 * "Playable on the bearer of The One Ring. During each of his organization
 *  phases, one character (other than the bearer) in bearer's company is
 *  discarded (of bearer's player's choice) along with all non-follower cards
 *  played with him. During his organization phase, the target character may
 *  tap to attempt to remove this card. Make a roll—if the result is greater
 *  than 8, discard this card. Cannot be duplicated on a given character."
 *
 * | # | Rule                                                      | Status | Notes                                              |
 * |---|-----------------------------------------------------------|--------|----------------------------------------------------|
 * | 1 | Playable only on the bearer of The One Ring               | OK     | play-target filter target.possessions              |
 * | 2 | Org phase: one other company character must be discarded  | OK     | discard-company-character pending resolution       |
 * | 3 | Bearer's player chooses; bearer never a candidate         | OK     | one discard-character action per other member      |
 * | 4 | Non-follower cards discarded with him; followers stay     | OK     | ordinary character-discard path                    |
 * | 5 | Bearer alone → nothing discarded                          | OK     | no resolution enqueued                             |
 * | 6 | Tap to roll; > 8 discards this card                       | OK     | grant-action remove-self-on-roll threshold 9       |
 * | 7 | Cannot be duplicated on a given character                 | OK     | duplication-limit scope:character                  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  makeMHState, attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO, BILBO, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DAGGER_OF_WESTERNESSE,
  viableActions, CardStatus, runActions,
  findCharInstanceId, getCharacter, dispatch,
  expectCharStatus, expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { reduce } from '../../index.js';
import type { PlayHazardAction, ActivateGrantedAction, CardDefinitionId, GameState, DiscardCharacterOrgAction } from '../../index.js';

const ONE_MASTER = 'le-133' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;

/**
 * Untap-phase state for PLAYER_1 whose first company is Frodo (bearing The
 * One Ring and this hazard) plus `companions`; a second company at Lorien
 * holds Gimli. Advances into the organization phase.
 */
function advanceToOrg(companions: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters']): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Untap,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [
          { site: RIVENDELL, characters: [{ defId: FRODO, items: [THE_ONE_RING] }, ...companions] },
          { site: LORIEN, characters: [GIMLI] },
        ],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const withHazard = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, ONE_MASTER, HAZARD_PLAYER);
  return runActions(withHazard, [
    { type: 'untap', player: PLAYER_1 },
    { type: 'pass', player: PLAYER_2 },
  ]);
}

describe('The Ring Will Have But One Master (le-133)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1 & 7: play target and duplication ──────────────────────────────

  test('is playable only on the bearer of The One Ring', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [THE_ONE_RING] }, BILBO, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ONE_MASTER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = { ...state, phaseState: makeMHState() };
    const targets = viableActions(mhState, PLAYER_2, 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);
    expect(targets).toEqual([findCharInstanceId(mhState, RESOURCE_PLAYER, FRODO)]);
  });

  test('cannot be duplicated on the Ring-bearer', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [THE_ONE_RING] }, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ONE_MASTER], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHazard = attachHazardToChar(state, RESOURCE_PLAYER, FRODO, ONE_MASTER, HAZARD_PLAYER);
    const mhState = { ...withHazard, phaseState: makeMHState() };
    expect(viableActions(mhState, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ── Rules 2–5: organization-phase discard ─────────────────────────────────

  test('at the start of the organization phase the player must discard another character from the bearer\'s company', () => {
    const inOrg = advanceToOrg([ARAGORN, LEGOLAS]);
    expect(inOrg.phaseState.phase).toBe(Phase.Organization);

    const pending = inOrg.pendingResolutions.filter(r => r.kind.type === 'discard-company-character');
    expect(pending).toHaveLength(1);
    expect(pending[0].actor).toBe(PLAYER_1);

    // Only Aragorn and Legolas are offered — not the bearer (Frodo), not Gimli
    // in the other company — and the discard cannot be declined.
    const discards = viableActions(inOrg, PLAYER_1, 'discard-character')
      .map(ea => (ea.action as DiscardCharacterOrgAction).characterInstanceId);
    expect(new Set(discards)).toEqual(new Set([
      findCharInstanceId(inOrg, RESOURCE_PLAYER, ARAGORN),
      findCharInstanceId(inOrg, RESOURCE_PLAYER, LEGOLAS),
    ]));
    expect(viableActions(inOrg, PLAYER_1, 'pass')).toHaveLength(0);
    // No other organization action can be taken before the discard.
    expect(viableActions(inOrg, PLAYER_1, 'plan-movement')).toHaveLength(0);

    // The bearer cannot be named.
    const frodoId = findCharInstanceId(inOrg, RESOURCE_PLAYER, FRODO);
    const rejected = reduce(inOrg, { type: 'discard-character', player: PLAYER_1, characterInstanceId: frodoId });
    expect(rejected.error).toBeDefined();
  });

  test('the chosen character is discarded with his non-follower cards; the bearer and the rest stay', () => {
    const inOrg = advanceToOrg([{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }, LEGOLAS]);
    const aragornId = findCharInstanceId(inOrg, RESOURCE_PLAYER, ARAGORN);
    const daggerId = getCharacter(inOrg, RESOURCE_PLAYER, ARAGORN).items[0].instanceId;

    const after = dispatch(inOrg, { type: 'discard-character', player: PLAYER_1, characterInstanceId: aragornId });

    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    expectInDiscardPile(after, RESOURCE_PLAYER, aragornId);
    expectInDiscardPile(after, RESOURCE_PLAYER, daggerId);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toEqual([
      findCharInstanceId(after, RESOURCE_PLAYER, FRODO),
      findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS),
    ]);
    // The hazard stays on the bearer; the resolution is spent for this phase.
    expect(getCharacter(after, RESOURCE_PLAYER, FRODO).hazards.map(h => h.definitionId)).toEqual([ONE_MASTER]);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'discard-company-character')).toHaveLength(0);
    expect(viableActions(after, PLAYER_1, 'pass').length).toBeGreaterThan(0);
  });

  test('a follower of the discarded character is not discarded with him', () => {
    const inOrg = advanceToOrg([ARAGORN, { defId: FARAMIR, followerOf: 1 }]);
    const aragornId = findCharInstanceId(inOrg, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(inOrg, RESOURCE_PLAYER, FARAMIR);
    expect(inOrg.players[RESOURCE_PLAYER].characters[faramirId].controlledBy).toBe(aragornId);

    const after = dispatch(inOrg, { type: 'discard-character', player: PLAYER_1, characterInstanceId: aragornId });

    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].characters[faramirId]).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === faramirId)).toBe(false);
  });

  test('nothing is discarded when the bearer is alone in his company', () => {
    const inOrg = advanceToOrg([]);
    expect(inOrg.phaseState.phase).toBe(Phase.Organization);
    expect(inOrg.pendingResolutions.filter(r => r.kind.type === 'discard-company-character')).toHaveLength(0);
    // Gimli (another company) is untouched.
    expect(getCharacter(inOrg, RESOURCE_PLAYER, GIMLI)).toBeDefined();
  });

  // ── Rule 6: tap to attempt removal ────────────────────────────────────────

  test('the bearer may tap to roll for removal during the organization phase (threshold > 8)', () => {
    const inOrg = advanceToOrg([ARAGORN]);
    const afterDiscard = dispatch(inOrg, {
      type: 'discard-character', player: PLAYER_1, characterInstanceId: findCharInstanceId(inOrg, RESOURCE_PLAYER, ARAGORN),
    });

    const actions = viableActions(afterDiscard, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'remove-self-on-roll');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ActivateGrantedAction).rollThreshold).toBe(9);
  });

  test('a roll of 9 discards this card and taps the bearer', () => {
    const inOrg = advanceToOrg([]);
    const action = viableActions(inOrg, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'remove-self-on-roll')!;
    const after = dispatch({ ...inOrg, cheatRollTotal: 9 }, action.action);

    expectCharStatus(after, RESOURCE_PLAYER, FRODO, CardStatus.Tapped);
    expect(getCharacter(after, RESOURCE_PLAYER, FRODO).hazards).toHaveLength(0);
    expectInDiscardPile(after, HAZARD_PLAYER, ONE_MASTER);
  });

  test('a roll of 8 leaves this card attached and taps the bearer', () => {
    const inOrg = advanceToOrg([]);
    const action = viableActions(inOrg, PLAYER_1, 'activate-granted-action')
      .find(ea => (ea.action as ActivateGrantedAction).actionId === 'remove-self-on-roll')!;
    const after = dispatch({ ...inOrg, cheatRollTotal: 8 }, action.action);

    expectCharStatus(after, RESOURCE_PLAYER, FRODO, CardStatus.Tapped);
    expect(getCharacter(after, RESOURCE_PLAYER, FRODO).hazards.map(h => h.definitionId)).toEqual([ONE_MASTER]);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ONE_MASTER)).toBe(false);
  });
});
