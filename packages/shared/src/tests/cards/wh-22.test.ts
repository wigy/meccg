/**
 * @module wh-22.test
 *
 * Card test: In the Grip of Ambition (wh-22)
 * Type: hazard-event (permanent, character-targeting corruption hazard)
 *
 * Printed text:
 *   "Corruption. Playable on a Fallen-wizard or a Wizard. He receives 1
 *    corruption point (CP). If he is a Fallen-wizard, he receives 2 stage
 *    points. If he has more than 7 stage points, he receives an additional
 *    stage point. Cannot be duplicated on a given character. During his
 *    organization phase, target may tap to attempt to remove this card. Make
 *    a roll—if this result is greater than 8, discard this card."
 *
 * Card shape (data): 6 effects —
 *   1. play-target character, filter `target.race $in [wizard, fallen-wizard]`
 *   2. duplication-limit scope character, max 1
 *   3. stat-modifier corruption-points +1
 *   4. stage-points 2, when `bearer.race = fallen-wizard`
 *   5. stage-points 1, when fallen-wizard bearer with `bearer.stagePoints > 7`
 *   6. grant-action remove-self-on-roll, cost tap bearer, threshold 9
 *
 * Regression (game mvhos0dd-hlrnjk): the card had no effects, so the engine
 * played it as a general permanent event into the hazard player's
 * `cardsInPlay` instead of attaching it to Alatar, and it did nothing.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, addCardInPlay, recomputeDerived,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  makeMHState, findCharInstanceId, charIdAt, handCardId,
  viableActions, viableHazardPlays, dispatch, resolveChain,
  CardStatus, expectCharStatus, expectInDiscardPile, getHazardsOn,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const IN_THE_GRIP_OF_AMBITION = 'wh-22' as CardDefinitionId;
/** Alatar the Fallen-wizard (race fallen-wizard). */
const ALATAR_FW = 'wh-1' as CardDefinitionId;
/** Isengard, a Fallen-wizard Wizardhaven. */
const ISENGARD_WH = 'wh-56' as CardDefinitionId;
const SHAMEFUL_DEEDS = 'wh-80' as CardDefinitionId;  // 4 SP
const GNAWED_WAYS = 'wh-71' as CardDefinitionId;     // 1 SP
const PLOTTING_RUIN = 'wh-79' as CardDefinitionId;   // 3 SP

describe('In the Grip of Ambition (wh-22)', () => {
  beforeEach(() => resetMint());

  test('played on Alatar it attaches to him, not to the general cards in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ALATAR_FW, ARAGORN] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IN_THE_GRIP_OF_AMBITION], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const cardId = handCardId(state, HAZARD_PLAYER);

    const plays = viableHazardPlays(state, PLAYER_2, cardId);
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR_FW);
    expect(plays.map(p => p.targetCharacterId)).toEqual([alatarId]);

    const after = resolveChain(dispatch(state, plays[0]));
    expect(getHazardsOn(after, RESOURCE_PLAYER, ALATAR_FW).map(c => c.definitionId)).toEqual([IN_THE_GRIP_OF_AMBITION]);
    expect(after.players[1].cardsInPlay.map(c => c.definitionId)).not.toContain(IN_THE_GRIP_OF_AMBITION);
    expect(after.players[0].characters[alatarId].effectiveStats.corruptionPoints).toBe(1);
    expect(after.players[0].stagePoints).toBe(2);
  });

  test('cannot be duplicated on a given character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ALATAR_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [IN_THE_GRIP_OF_AMBITION], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, ALATAR_FW, IN_THE_GRIP_OF_AMBITION);
    const state = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(viableHazardPlays(state, PLAYER_2, handCardId(state, HAZARD_PLAYER))).toHaveLength(0);
  });

  test.each([
    { extras: [SHAMEFUL_DEEDS],              total: 6 },
    { extras: [SHAMEFUL_DEEDS, GNAWED_WAYS], total: 7 },
    { extras: [SHAMEFUL_DEEDS, PLOTTING_RUIN], total: 10 },
  ])('Fallen-wizard bearer: $extras.length stage card(s) → $total stage points', ({ extras, total }) => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [ALATAR_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    for (const extra of extras) state = addCardInPlay(state, RESOURCE_PLAYER, extra);
    state = recomputeDerived(attachHazardToChar(state, RESOURCE_PLAYER, ALATAR_FW, IN_THE_GRIP_OF_AMBITION));
    // 4+2 = 6 and 4+1+2 = 7 do not exceed 7; 4+3+2 = 9 does, adding 1 more.
    expect(state.players[0].stagePoints).toBe(total);
  });

  test('removal roll above 8 discards the card; 8 keeps it', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [ALATAR_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ALATAR_FW, IN_THE_GRIP_OF_AMBITION);
    const alatarId = charIdAt(withCard, RESOURCE_PLAYER);

    const action = viableActions(withCard, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'remove-self-on-roll' && !a.noTap)!;
    expect(action.rollThreshold).toBe(9);

    const failed = dispatch({ ...withCard, cheatRollTotal: 8 }, action);
    expectCharStatus(failed, RESOURCE_PLAYER, ALATAR_FW, CardStatus.Tapped);
    expect(failed.players[0].characters[alatarId].hazards).toHaveLength(1);

    const succeeded = dispatch({ ...withCard, cheatRollTotal: 9 }, action);
    expect(succeeded.players[0].characters[alatarId].hazards).toHaveLength(0);
    expectInDiscardPile(succeeded, HAZARD_PLAYER, IN_THE_GRIP_OF_AMBITION);
  });
});
