/**
 * @module wh-17.test
 *
 * Card test: Echoes of the Song (wh-17)
 * Type: hazard-event (short) — no Corruption keyword in `data/cards.json`
 * Effects: 4
 *   1. play-flag remove-from-game
 *   2. play-target character
 *   3. play-option "discard-stage-card" (untargeted) — force-discard-stage-card,
 *      gated on `opponent.stageCardCount > 1` and `opponent.stagePoints >= 4`
 *   4. play-option "corruption-check" — force-check corruption
 *
 * Card text: "If your opponent has more than one stage card and 4 or more stage
 *  points, he must discard one stage card of his choice. Alternatively, force a
 *  target character to make a corruption check. Remove this card from the game."
 *
 * Two mutually-exclusive modes. Mode A is untargeted and only offered while the
 * opponent clears both halves of the gate; it raises a `force-discard-card`
 * pending resolution actored by the *opponent*, whose candidates are every
 * Stage card (`alignment: "stage"`) they control — in `cardsInPlay` or attached
 * to a bearer — so the choice is theirs, and the discard re-derives their
 * stage-point total. Mode B is the certified Weariness of the Heart (le-149)
 * shape: a corruption check on one character of the active company. Whichever
 * mode resolves, `play-flag: remove-from-game` sends the spent card on from the
 * hazard player's discard pile to their out-of-play pile.
 *
 * Because wh-17 carries no Corruption keyword, CoE 7.2.1's "one corruption card
 * per character per turn" lock does not apply to it.
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                          |
 * |---|------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Untargeted play-option mode alongside a target | IMPLEMENTED | `play-option.untargeted`                        |
 * | 2 | Gate: >1 stage card and >=4 stage points       | IMPLEMENTED | `opponent.stageCardCount` / `opponent.stagePoints` |
 * | 3 | Opponent discards one stage card of his choice | IMPLEMENTED | `force-discard-stage-card` → force-discard-card |
 * | 4 | Alternatively: corruption check on a character | IMPLEMENTED | force-check corruption on chain resolution      |
 * | 5 | Remove this card from the game                 | IMPLEMENTED | `play-flag: remove-from-game` → out-of-play pile |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  resetMint,
  viableActions,
  dispatch,
  resolveChain,
  handCardId,
  findCharInstanceId,
  companyIdAt,
  buildFwStageCardsMHState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHazardAction } from '../../index.js';

const ECHOES_OF_THE_SONG = 'wh-17' as CardDefinitionId;

// Stage permanent-events used as the opponent's stage cards.
const A_MERRIER_WORLD = 'wh-59' as CardDefinitionId;    // 2 stage points
const BLIND_TO_ALL_ELSE = 'wh-64' as CardDefinitionId;  // 2 stage points
const GNAWED_WAYS = 'wh-71' as CardDefinitionId;        // 1 stage point
const GREAT_RUSE = 'wh-73' as CardDefinitionId;         // 1 stage point
const SHAMEFUL_DEEDS = 'wh-80' as CardDefinitionId;     // 4 stage points
const WIZARDS_MYRMIDON = 'wh-84' as CardDefinitionId;   // 1 stage point, played on a character

/** Every viable Echoes play-hazard action, as typed actions. */
function echoesActions(state: GameState): PlayHazardAction[] {
  return viableActions(state, PLAYER_2, 'play-hazard')
    .map(a => a.action as unknown as PlayHazardAction);
}

describe('Echoes of the Song (wh-17)', () => {
  beforeEach(() => resetMint());

  test('offers the stage-discard mode only when the opponent has >1 stage card AND 4+ stage points', () => {
    // 2 cards / 4 points — gate met.
    const met = buildFwStageCardsMHState({
      stageCardsInPlay: [A_MERRIER_WORLD, BLIND_TO_ALL_ELSE],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    expect(met.players[RESOURCE_PLAYER].stagePoints).toBe(4);
    const stageMode = echoesActions(met).filter(a => a.optionId === 'discard-stage-card');
    expect(stageMode).toHaveLength(1);
    // The untargeted mode carries no target character.
    expect(stageMode[0].targetCharacterId).toBeUndefined();
  });

  test('stage-discard mode is not offered with only one stage card, even at 4 stage points', () => {
    const onePile = buildFwStageCardsMHState({
      stageCardsInPlay: [SHAMEFUL_DEEDS],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    expect(onePile.players[RESOURCE_PLAYER].stagePoints).toBe(4);
    expect(echoesActions(onePile).some(a => a.optionId === 'discard-stage-card')).toBe(false);
  });

  test('stage-discard mode is not offered with two stage cards below 4 stage points', () => {
    const lowPoints = buildFwStageCardsMHState({
      stageCardsInPlay: [GNAWED_WAYS, GREAT_RUSE],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    expect(lowPoints.players[RESOURCE_PLAYER].stagePoints).toBe(2);
    expect(echoesActions(lowPoints).some(a => a.optionId === 'discard-stage-card')).toBe(false);
  });

  test('the corruption-check mode is offered on every character of the active company, gate or no gate', () => {
    const withStage = buildFwStageCardsMHState({
      stageCardsInPlay: [A_MERRIER_WORLD, BLIND_TO_ALL_ELSE],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    const aragornId = findCharInstanceId(withStage, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(withStage, RESOURCE_PLAYER, LEGOLAS);
    const corruptionTargets = echoesActions(withStage)
      .filter(a => a.optionId === 'corruption-check')
      .map(a => a.targetCharacterId);
    expect(corruptionTargets).toEqual(expect.arrayContaining([aragornId, legolasId]));

    // With no stage card in play at all, only the corruption mode remains.
    const noStage = buildFwStageCardsMHState({ stageCardsInPlay: [], hazardHand: [ECHOES_OF_THE_SONG] });
    const modes = new Set(echoesActions(noStage).map(a => a.optionId));
    expect(modes).toEqual(new Set(['corruption-check']));
  });

  test('stage-discard mode makes the opponent choose one of his stage cards; discarding it drops his stage points', () => {
    const state = buildFwStageCardsMHState({
      stageCardsInPlay: [A_MERRIER_WORLD, BLIND_TO_ALL_ELSE],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    const stageInstanceIds = state.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.instanceId);

    const resolved = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      optionId: 'discard-stage-card',
    }));

    // The *opponent* (the Fallen-wizard) is the actor and every stage card he
    // has in play is a candidate.
    const pending = resolved.pendingResolutions.find(r => r.kind.type === 'force-discard-card');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);
    expect(
      [...(pending!.kind as { candidateInstanceIds: readonly CardInstanceId[] }).candidateInstanceIds].sort(),
    ).toEqual([...stageInstanceIds].sort());

    // The Fallen-wizard picks — both stage cards are offered as choices.
    const choices = viableActions(resolved, PLAYER_1, 'force-discard-card')
      .map(a => (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect([...choices].sort()).toEqual([...stageInstanceIds].sort());

    const chosen = stageInstanceIds[1];
    const after = dispatch(resolved, { type: 'force-discard-card', player: PLAYER_1, cardInstanceId: chosen });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.instanceId)).not.toContain(chosen);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(chosen);
    // 4 stage points → 2 once Blind to All Else leaves play.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
    expect(after.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
  });

  test('a stage card played on a character counts toward the gate and can be the one discarded', () => {
    const state = buildFwStageCardsMHState({
      stageCardsInPlay: [SHAMEFUL_DEEDS],
      stageCardsOnLeader: [WIZARDS_MYRMIDON],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    // 4 (Shameful Deeds, in play) + 1 (Wizard's Myrmidon, on the bearer) = 5.
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(5);
    expect(echoesActions(state).some(a => a.optionId === 'discard-stage-card')).toBe(true);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const myrmidonId = state.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === WIZARDS_MYRMIDON)!.instanceId;

    const resolved = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      optionId: 'discard-stage-card',
    }));
    const pending = resolved.pendingResolutions.find(r => r.kind.type === 'force-discard-card')!;
    expect(
      (pending.kind as { candidateInstanceIds: readonly CardInstanceId[] }).candidateInstanceIds,
    ).toContain(myrmidonId);

    const after = dispatch(resolved, { type: 'force-discard-card', player: PLAYER_1, cardInstanceId: myrmidonId });
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].items.map(i => i.instanceId))
      .not.toContain(myrmidonId);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(myrmidonId);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });

  test('corruption-check mode enqueues a corruption check on the target and discards no stage card', () => {
    const state = buildFwStageCardsMHState({
      stageCardsInPlay: [A_MERRIER_WORLD, BLIND_TO_ALL_ELSE],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const resolved = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(state, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
      targetCharacterId: aragornId,
      optionId: 'corruption-check',
    }));

    const check = resolved.pendingResolutions.find(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId?: CardInstanceId }).characterId === aragornId,
    );
    expect(check).toBeDefined();

    // The alternative mode did not also fire: no stage card left play.
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'force-discard-card')).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(2);
    expect(resolved.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });

  test('the card is removed from the game after either mode resolves', () => {
    const base = buildFwStageCardsMHState({
      stageCardsInPlay: [A_MERRIER_WORLD, BLIND_TO_ALL_ELSE],
      hazardHand: [ECHOES_OF_THE_SONG],
    });
    const echoesId = handCardId(base, HAZARD_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterStageMode = resolveChain(dispatch(base, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: echoesId,
      targetCompanyId: companyId,
      optionId: 'discard-stage-card',
    }));
    expect(afterStageMode.players[HAZARD_PLAYER].outOfPlayPile.map(c => c.instanceId)).toContain(echoesId);
    expect(afterStageMode.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).not.toContain(echoesId);

    const afterCorruptionMode = resolveChain(dispatch(base, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: echoesId,
      targetCompanyId: companyId,
      targetCharacterId: findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN),
      optionId: 'corruption-check',
    }));
    expect(afterCorruptionMode.players[HAZARD_PLAYER].outOfPlayPile.map(c => c.instanceId)).toContain(echoesId);
    expect(afterCorruptionMode.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).not.toContain(echoesId);
  });
});
