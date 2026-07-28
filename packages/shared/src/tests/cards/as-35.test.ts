/**
 * @module as-35.test
 *
 * Card test: Returned Beyond All Hope (as-35)
 * Type: hazard-event (short) — three mutually-exclusive modes
 *
 * Text: "As a short-event, bring one hazard creature of the following type from
 * your discard pile to your hand: Maia, Elf, Dwarf, or Dúnedain. Alternatively,
 * as a short-event, bring a Maia permanent-event from active play to your hand.
 * Alternatively, as a permanent-event, make a roll—if the result is greater than
 * 8, bring an eliminated Elf or Maia hazard creature to its owner's discard pile
 * and place this card in your opponent's marshalling point pile, otherwise,
 * discard this card."
 *
 * CRF 22 rulings honoured here:
 *   - "Returned Beyond All Hope «un-eliminates» a hazard creature, allowing any
 *     manifestation of that character to be played" — the recovered creature
 *     leaves the terminal pile, so `isManifestationDefeated` goes back to false.
 *   - "This card may target creatures still in play as trophies" — mode 3 may
 *     take a creature out of the opponent's marshalling-point pile, not only out
 *     of an out-of-play pile.
 *
 * Card shape (effects):
 *   - play-option `recover-creature-from-discard` (untargeted, candidates
 *     `own-discard`): `move` select target, discard → hand, filtered to hazard
 *     creatures of race maia / elf / dwarf / dunadan.
 *   - play-option `return-maia-permanent-event` (untargeted, candidates
 *     `own-in-play`): `move` select target, in-play → hand, filtered to Maia
 *     hazard creatures — i.e. one in play in its permanent-event mode.
 *   - play-option `un-eliminate-creature` (untargeted, candidates `eliminated`,
 *     eventMode `permanent-event`): `un-eliminate-creature` with threshold 9
 *     ("greater than 8") and `selfTo: opponent-mp-pile`.
 *   - mp-in-pile: 2 kill marshalling points while in a marshalling-point pile
 *     (matching the card's printed 2 kill MP).
 *
 * Every mode declares its target when the card is played (one `play-hazard`
 * action per mode × candidate, carrying `optionId` + `optionTargetInstanceId`),
 * so the opponent's response window sees what is at stake. Mode 3 additionally
 * carries `altEventMode: "permanent-event"`, which routes the play down the
 * permanent-event chain path — the card rides the chain and is placed by its own
 * apply (opponent's marshalling-point pile on success, its own player's discard
 * pile on failure); it never enters `cardsInPlay`.
 *
 * "to your hand" is read as the playing player's own cards: modes 1 and 2 draw
 * only from that player's discard pile / cards in play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN,
  buildTestState, resetMint, makeMHState,
  addToPile, addCardInPlay, mint, viableActions, dispatch, resolveChain, recomputeDerived,
} from '../test-helpers.js';
import { isManifestationDefeated } from '../../engine/manifestations.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, CardInstance, MovementHazardPhaseState, PlayHazardAction, ManifestId } from '../../index.js';

const RETURNED_BEYOND_ALL_HOPE = 'as-35' as CardDefinitionId;
const ELF_LORD = 'le-69' as CardDefinitionId;          // hazard-creature, race elf
const DURINS_FOLK = 'as-8' as CardDefinitionId;        // hazard-creature, race dwarf
const KNIGHTS_OF_THE_PRINCE = 'as-12' as CardDefinitionId; // hazard-creature, race dunadan
const ORC_PATROL = 'tw-074' as CardDefinitionId;       // hazard-creature, race orc — never eligible
const GANDALF_WHITE_RIDER = 'as-11' as CardDefinitionId; // hazard-creature, race maia (manifestation of Gandalf)
const GANDALF_MANIFEST = 'tw-156' as ManifestId;       // as-11's manifestId

const MODE_DISCARD = 'recover-creature-from-discard';
const MODE_IN_PLAY = 'return-maia-permanent-event';
const MODE_ELIMINATED = 'un-eliminate-creature';

describe('Returned Beyond All Hope (as-35)', () => {
  beforeEach(() => resetMint());

  /**
   * PLAYER_1 (active/resource) is being hazarded; PLAYER_2 (hazard) holds as-35.
   * `hazardDiscard` seeds PLAYER_2's discard pile; the M/H play-hazards step is
   * processing PLAYER_1's company.
   */
  function baseState(hazardDiscard: CardDefinitionId[] = []): GameState {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [RETURNED_BEYOND_ALL_HOPE],
          discardPile: hazardDiscard,
          siteDeck: [LORIEN],
        },
      ],
    });
    return recomputeDerived({ ...state, phaseState: makeMHState() });
  }

  /** Push a freshly minted creature instance into a terminal pile. */
  function withEliminated(
    state: GameState,
    holder: 0 | 1,
    pile: 'killPile' | 'outOfPlayPile',
    defId: CardDefinitionId,
  ): { state: GameState; creature: CardInstance } {
    const creature: CardInstance = { instanceId: mint(), definitionId: defId };
    return { state: recomputeDerived(addToPile(state, holder, pile, creature)), creature };
  }

  /** The viable as-35 plays for a given mode. */
  function modePlays(state: GameState, optionId: string): PlayHazardAction[] {
    return viableActions(state, PLAYER_2, 'play-hazard')
      .map(a => a.action as PlayHazardAction)
      .filter(a => a.optionId === optionId);
  }

  // ── Mode 1: bring a Maia/Elf/Dwarf/Dúnedain creature from your discard ──────

  test('mode 1 is offered once per eligible creature in the hazard player own discard pile', () => {
    const state = baseState([ELF_LORD, DURINS_FOLK, KNIGHTS_OF_THE_PRINCE, ORC_PATROL]);
    const discard = state.players[HAZARD_PLAYER].discardPile;
    const plays = modePlays(state, MODE_DISCARD);

    const offered = new Set(plays.map(a => a.optionTargetInstanceId as string));
    for (const defId of [ELF_LORD, DURINS_FOLK, KNIGHTS_OF_THE_PRINCE]) {
      const inst = discard.find(c => c.definitionId === defId)!;
      expect(offered.has(inst.instanceId as string)).toBe(true);
    }
    // The Orc creature is not one of the four listed types.
    const orc = discard.find(c => c.definitionId === ORC_PATROL)!;
    expect(offered.has(orc.instanceId as string)).toBe(false);
    expect(plays).toHaveLength(3);
  });

  test('mode 1 does not reach into the opponent discard pile', () => {
    let state = baseState();
    // Give the RESOURCE player an eligible creature in their discard pile.
    const foreign: CardInstance = { instanceId: mint(), definitionId: ELF_LORD };
    state = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], discardPile: [foreign] },
        state.players[HAZARD_PLAYER],
      ] as unknown as GameState['players'],
    };
    expect(modePlays(state, MODE_DISCARD)).toHaveLength(0);
  });

  test('mode 1 brings the chosen creature from discard to the hazard player hand', () => {
    const state = baseState([ELF_LORD, ORC_PATROL]);
    const elf = state.players[HAZARD_PLAYER].discardPile.find(c => c.definitionId === ELF_LORD)!;
    const play = modePlays(state, MODE_DISCARD)
      .find(a => a.optionTargetInstanceId === elf.instanceId)!;

    const after = resolveChain(dispatch(state, play));
    const hazard = after.players[HAZARD_PLAYER];

    expect(after.chain).toBeNull();
    expect(hazard.hand.some(c => c.instanceId === elf.instanceId)).toBe(true);
    expect(hazard.discardPile.some(c => c.instanceId === elf.instanceId)).toBe(false);
    // The Orc creature was untouched, and the spent event is in the discard pile.
    expect(hazard.discardPile.some(c => c.definitionId === ORC_PATROL)).toBe(true);
    expect(hazard.discardPile.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(true);
    expect(hazard.hand.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(false);
  });

  test('mode 1 counts one against the hazard limit', () => {
    const state = baseState([ELF_LORD]);
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const after = dispatch(state, modePlays(state, MODE_DISCARD)[0]);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });

  // ── Mode 2: bring a Maia permanent-event from active play to your hand ──────

  test('mode 2 is offered for a Maia permanent-event in play but not for a non-Maia one', () => {
    let state = baseState();
    state = addCardInPlay(state, HAZARD_PLAYER, GANDALF_WHITE_RIDER);
    state = recomputeDerived(addCardInPlay(state, HAZARD_PLAYER, ELF_LORD));

    const plays = modePlays(state, MODE_IN_PLAY);
    const maia = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === GANDALF_WHITE_RIDER)!;
    expect(plays).toHaveLength(1);
    expect(plays[0].optionTargetInstanceId).toBe(maia.instanceId);
  });

  test('mode 2 is not offered for the opponent Maia permanent-event', () => {
    const state = recomputeDerived(addCardInPlay(baseState(), RESOURCE_PLAYER, GANDALF_WHITE_RIDER));
    expect(modePlays(state, MODE_IN_PLAY)).toHaveLength(0);
  });

  test('mode 2 returns the Maia permanent-event from play to the hazard player hand', () => {
    const state = recomputeDerived(addCardInPlay(baseState(), HAZARD_PLAYER, GANDALF_WHITE_RIDER));
    const maiaId = state.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === GANDALF_WHITE_RIDER)!.instanceId;

    const after = resolveChain(dispatch(state, modePlays(state, MODE_IN_PLAY)[0]));
    const hazard = after.players[HAZARD_PLAYER];

    expect(hazard.cardsInPlay.some(c => c.instanceId === maiaId)).toBe(false);
    expect(hazard.hand.some(c => c.instanceId === maiaId)).toBe(true);
    expect(hazard.discardPile.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(true);
  });

  // ── Mode 3: roll to un-eliminate an Elf or Maia creature ────────────────────

  test('mode 3 is offered as a permanent-event for a trophy in the opponent marshalling-point pile', () => {
    const { state, creature } = withEliminated(baseState(), RESOURCE_PLAYER, 'killPile', GANDALF_WHITE_RIDER);
    const plays = modePlays(state, MODE_ELIMINATED);
    expect(plays).toHaveLength(1);
    expect(plays[0].optionTargetInstanceId).toBe(creature.instanceId);
    expect(plays[0].altEventMode).toBe('permanent-event');
  });

  test('mode 3 is offered for a creature in an out-of-play pile but not for a non-Elf/Maia one', () => {
    let built = withEliminated(baseState(), RESOURCE_PLAYER, 'outOfPlayPile', ELF_LORD);
    const elf = built.creature;
    built = withEliminated(built.state, RESOURCE_PLAYER, 'outOfPlayPile', DURINS_FOLK);

    const plays = modePlays(built.state, MODE_ELIMINATED);
    expect(plays).toHaveLength(1);
    expect(plays[0].optionTargetInstanceId).toBe(elf.instanceId);
  });

  test('mode 3 on a roll greater than 8 recovers the creature to its owner discard pile', () => {
    const { state, creature } = withEliminated(baseState(), RESOURCE_PLAYER, 'killPile', GANDALF_WHITE_RIDER);
    const play = modePlays(state, MODE_ELIMINATED)[0];

    const after = resolveChain(dispatch({ ...state, cheatRollTotal: 9 }, play));

    // Gone from the opponent's marshalling-point pile...
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creature.instanceId)).toBe(false);
    // ...and back in its owner's (the hazard player's) discard pile.
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === creature.instanceId)).toBe(true);
  });

  test('mode 3 on success places the card in the opponent marshalling-point pile, worth 2 kill MP', () => {
    const { state } = withEliminated(baseState(), RESOURCE_PLAYER, 'outOfPlayPile', GANDALF_WHITE_RIDER);
    const killMpBefore = state.players[RESOURCE_PLAYER].marshallingPoints.kill;
    const play = modePlays(state, MODE_ELIMINATED)[0];

    const after = resolveChain(dispatch({ ...state, cheatRollTotal: 9 }, play));

    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(killMpBefore + 2);
    // It never enters play, and never lands in the hazard player's own piles.
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(false);
  });

  test('mode 3 on a roll of 8 or less discards the card and leaves the creature eliminated', () => {
    const { state, creature } = withEliminated(baseState(), RESOURCE_PLAYER, 'killPile', GANDALF_WHITE_RIDER);
    const play = modePlays(state, MODE_ELIMINATED)[0];

    const after = resolveChain(dispatch({ ...state, cheatRollTotal: 8 }, play));

    // Creature stays where it was; the card goes to its own player's discard.
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === creature.instanceId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === RETURNED_BEYOND_ALL_HOPE)).toBe(false);
  });

  test('mode 3 un-eliminates the creature, so its manifestation may be played again (CRF 22)', () => {
    const { state } = withEliminated(baseState(), RESOURCE_PLAYER, 'killPile', GANDALF_WHITE_RIDER);
    expect(isManifestationDefeated(state, GANDALF_MANIFEST)).toBe(true);

    const play = modePlays(state, MODE_ELIMINATED)[0];
    const after = resolveChain(dispatch({ ...state, cheatRollTotal: 9 }, play));

    expect(isManifestationDefeated(after, GANDALF_MANIFEST)).toBe(false);
  });

  test('a failed mode 3 roll leaves the manifestation defeated', () => {
    const { state } = withEliminated(baseState(), RESOURCE_PLAYER, 'killPile', GANDALF_WHITE_RIDER);
    const play = modePlays(state, MODE_ELIMINATED)[0];
    const after = resolveChain(dispatch({ ...state, cheatRollTotal: 8 }, play));

    expect(isManifestationDefeated(after, GANDALF_MANIFEST)).toBe(true);
  });

  test('mode 3 counts one against the hazard limit', () => {
    const { state } = withEliminated(baseState(), RESOURCE_PLAYER, 'killPile', GANDALF_WHITE_RIDER);
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const after = dispatch({ ...state, cheatRollTotal: 9 }, modePlays(state, MODE_ELIMINATED)[0]);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });

  // ── No mode has a legal target ──────────────────────────────────────────────

  test('not playable at all when no mode has a candidate card', () => {
    const state = baseState([ORC_PATROL]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('all three modes are offered together when each has a candidate', () => {
    let state = baseState([ELF_LORD]);
    state = recomputeDerived(addCardInPlay(state, HAZARD_PLAYER, GANDALF_WHITE_RIDER));
    const { state: withTrophy } = withEliminated(state, RESOURCE_PLAYER, 'killPile', ELF_LORD);

    expect(modePlays(withTrophy, MODE_DISCARD)).toHaveLength(1);
    expect(modePlays(withTrophy, MODE_IN_PLAY)).toHaveLength(1);
    expect(modePlays(withTrophy, MODE_ELIMINATED)).toHaveLength(1);
  });
});
