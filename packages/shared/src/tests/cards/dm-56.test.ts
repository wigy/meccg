/**
 * @module dm-56.test
 *
 * Card test: Eyes of the Shadow (dm-56)
 * Type: hazard-event (permanent, Environment)
 *
 * Card text:
 *   "Environment. May only be played if Gates of Morning is not in play. The
 *    hazard limit is increased by two for each moving company with a size of
 *    less than four that also contains a Wizard or a non-ranger character with
 *    a mind of 6 or more. Cannot be duplicated. Discard when any play deck is
 *    exhausted."
 *
 * Effects:
 *   1. hazard-limit-environment value:2 — +2 to a moving company's hazard limit
 *      when company.size < 4 AND (company.hasWizard OR company.maxNonRangerMind >= 6)
 *   2. play-condition card-not-in-play "Gates of Morning" — only playable while
 *      Gates of Morning is not in play
 *   3. on-event: play-deck-exhausted → discard-self
 *   4. duplication-limit scope:game max:1 — cannot be duplicated
 *
 * | # | Effect                                            | Status | Notes                                  |
 * |---|---------------------------------------------------|--------|----------------------------------------|
 * | 1 | hazard-limit-environment (+2)                     | OK     | snapshotHazardLimit (reducer-mh.ts)    |
 * | 2 | play-condition card-not-in-play (Gates of Morning)| OK     | legal-actions/movement-hazard.ts        |
 * | 3 | on-event: play-deck-exhausted, discard-self       | OK     | completeDeckExhaust in reducer-utils    |
 * | 4 | duplication-limit (game, max 1)                   | OK     | movement-hazard.ts duplication check    |
 *
 * Character stats used (mind / skills):
 *   GANDALF       — Wizard, mind null
 *   ARAGORN       — Dúnadan, mind 9, RANGER (excluded from the mind clause)
 *   LEGOLAS       — Elf, mind 6, non-ranger
 *   GIMLI         — Dwarf, mind 6, non-ranger
 *   GLORFINDEL_II — Elf, mind 8, non-ranger
 *   BILBO         — Hobbit, mind 5, non-ranger (below the threshold; counts ½ size)
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  GANDALF, ARAGORN, LEGOLAS, GIMLI, GLORFINDEL_II, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GATES_OF_MORNING, SAPLING_OF_THE_WHITE_TREE,
  buildTestState, resetMint, dispatch,
  addCardInPlay, makeMHState, snapshotHazardLimitFor,
  expectInDiscardPile,
  Phase,
} from '../test-helpers.js';
import { CardStatus, computeLegalActions } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, EndOfTurnPhaseState } from '../../index.js';

const EYES_OF_THE_SHADOW = 'dm-56' as CardDefinitionId;

const eyesInPlay: CardInPlay = {
  instanceId: 'eyes-1' as CardInstanceId,
  definitionId: EYES_OF_THE_SHADOW,
  status: CardStatus.Untapped,
};

describe('Eyes of the Shadow (dm-56)', () => {
  beforeEach(() => resetMint());

  // ---- Rule 1: +2 hazard limit for a small moving company with a Wizard ----

  test('a moving company with a Wizard and size < 4 gets +2 hazard limit', () => {
    // [GANDALF, GIMLI]: size 2 < 4, contains a Wizard.
    const base = snapshotHazardLimitFor([GANDALF, GIMLI]);
    const withEyes = snapshotHazardLimitFor([GANDALF, GIMLI], { envInPlay: [EYES_OF_THE_SHADOW] });
    expect(base).toBe(2);       // max(size 2, 2)
    expect(withEyes).toBe(4);   // +2 from Eyes of the Shadow
  });

  // ---- Rule 1: +2 for a small moving company with a non-ranger mind >= 6 ----

  test('a moving company with a non-ranger character of mind >= 6 gets +2', () => {
    // [LEGOLAS]: elf, mind 6, non-ranger.
    const base = snapshotHazardLimitFor([LEGOLAS]);
    const withEyes = snapshotHazardLimitFor([LEGOLAS], { envInPlay: [EYES_OF_THE_SHADOW] });
    expect(base).toBe(2);       // max(size 1, 2)
    expect(withEyes).toBe(4);
  });

  // ---- Rule 1: a high-mind RANGER does not satisfy the mind clause ----

  test('a high-mind ranger (Aragorn, mind 9) does not trigger the bonus', () => {
    // [ARAGORN]: Dúnadan, mind 9, but a Ranger → excluded from the mind clause,
    // and not a Wizard → no bonus.
    const withEyes = snapshotHazardLimitFor([ARAGORN], { envInPlay: [EYES_OF_THE_SHADOW] });
    expect(withEyes).toBe(2);   // unchanged base, no +2
  });

  // ---- Rule 1: a non-ranger below mind 6 does not satisfy the clause ----

  test('a non-ranger below mind 6 (Bilbo, mind 5) does not trigger the bonus', () => {
    const withEyes = snapshotHazardLimitFor([BILBO], { envInPlay: [EYES_OF_THE_SHADOW] });
    expect(withEyes).toBe(2);   // no Wizard, max non-ranger mind 5 < 6 → no bonus
  });

  // ---- Rule 1: the size gate — bonus applies at size 3 but not at size 4 ----

  test('the size gate flips between 3 (bonus) and 4 (no bonus)', () => {
    // [GANDALF, LEGOLAS, GIMLI]: size 3 < 4, qualifies → +2.
    const sizeThree = snapshotHazardLimitFor([GANDALF, LEGOLAS, GIMLI], { envInPlay: [EYES_OF_THE_SHADOW] });
    expect(sizeThree).toBe(5);  // max(3, 2) = 3, +2

    // [GANDALF, LEGOLAS, GIMLI, GLORFINDEL_II]: size 4, NOT < 4 → no bonus,
    // even though it has a Wizard and several high-mind non-rangers.
    const sizeFour = snapshotHazardLimitFor([GANDALF, LEGOLAS, GIMLI, GLORFINDEL_II], { envInPlay: [EYES_OF_THE_SHADOW] });
    expect(sizeFour).toBe(4);   // max(4, 2) = 4, no +2
  });

  // ---- Rule 1: only MOVING companies count ----

  test('a stationary (non-moving) qualifying company gets no bonus', () => {
    const moving = snapshotHazardLimitFor([GANDALF], { envInPlay: [EYES_OF_THE_SHADOW], moving: true });
    const stationary = snapshotHazardLimitFor([GANDALF], { envInPlay: [EYES_OF_THE_SHADOW], moving: false });
    expect(moving).toBe(4);      // moving Wizard company → +2
    expect(stationary).toBe(2);  // stationary → no bonus
  });

  // ---- Rule 2: play-condition — not playable while Gates of Morning is in play ----

  const playHazardState = (extraInPlay: CardDefinitionId[]): ReturnType<typeof buildTestState> => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYES_OF_THE_SHADOW], siteDeck: [MINAS_TIRITH] },
      ],
    });
    let withInPlay = state;
    for (const def of extraInPlay) {
      withInPlay = addCardInPlay(withInPlay, def === GATES_OF_MORNING ? 0 : HAZARD_PLAYER, def);
    }
    return { ...withInPlay, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
  };

  const eyesPlayActions = (state: ReturnType<typeof buildTestState>) =>
    computeLegalActions(state, PLAYER_2).filter(ea =>
      ea.viable
      && ea.action.type === 'play-hazard'
      && resolveInstanceId(state, ea.action.cardInstanceId) === EYES_OF_THE_SHADOW);

  test('is playable while Gates of Morning is not in play', () => {
    expect(eyesPlayActions(playHazardState([])).length).toBeGreaterThan(0);
  });

  test('is not playable while Gates of Morning is in play', () => {
    expect(eyesPlayActions(playHazardState([GATES_OF_MORNING]))).toHaveLength(0);
  });

  // ---- Rule 4: cannot be duplicated ----

  test('cannot be duplicated — not playable while a copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [EYES_OF_THE_SHADOW],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [eyesInPlay],
        },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    expect(eyesPlayActions(ready)).toHaveLength(0);
  });

  // ---- Rule 3: discard when any play deck is exhausted ----

  test('discards when a play deck exhausts during End of Turn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, EYES_OF_THE_SHADOW);

    // Before the deck-exhaust completes, the environment is still in play.
    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === EYES_OF_THE_SHADOW)).toBe(true);

    // Completing the exhaust fires play-deck-exhausted → discard-self.
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expectInDiscardPile(afterPass, HAZARD_PLAYER, EYES_OF_THE_SHADOW);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === EYES_OF_THE_SHADOW)).toBe(false);
  });
});
