/**
 * @module as-79-the-dark-power.test
 *
 * Card test: The Dark Power (as-79)
 * Type: minion-resource-event (short)
 * Effects:
 *   - play-condition player-state: player.playsAsSauron (The Lidless Eye
 *     le-203 / Sauron ba-43 marker in play)
 *   - play-target: character, filter target.isInfluencing (the character whose
 *     influence-attempt is live in the chain)
 *   - play-option "dark-power-boost": add-constraint check-modifier influence
 *     +3, scope until-cleared, onFailure shuffle-faction-into-deck
 *
 * "Playable if you are Sauron. +3 to an influence check against a faction.
 *  If the check is not successful, shuffle the faction into your play deck."
 *
 * Engine support table:
 * | # | Feature                                            | Status      | Notes                                             |
 * |---|----------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Playable only while playing as Sauron              | IMPLEMENTED | player.playsAsSauron in buildPlayerStateContext   |
 * | 2 | Played in response to an active influence check    | IMPLEMENTED | when: player.hasFactionInHand (chain-only)        |
 * | 3 | Target pinned to the influencing character         | IMPLEMENTED | target.isInfluencing in buildPlayOptionContext    |
 * | 4 | +3 one-shot influence check-modifier constraint    | IMPLEMENTED | Muster shape; consumed by the boosted roll        |
 * | 5 | Failed check shuffles faction into play deck       | IMPLEMENTED | constraint kind onFailure, resolveInfluenceAttemptRoll |
 * | 6 | Successful check puts faction into play normally   | IMPLEMENTED | success path unchanged                            |
 * | 7 | Failed check without as-79 discards faction        | IMPLEMENTED | default failure path unchanged                    |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, findHandCardId, makeSitePhase,
  firstFactionInfluenceAttempt,
  dispatch, resolveChain,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay,
  PlayShortEventAction, InfluenceAttemptAction, FactionInfluenceRollAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const DARK_POWER = 'as-79' as CardDefinitionId;     // this card
const LIDLESS_EYE = 'le-203' as CardDefinitionId;   // play-as-sauron marker
const CIRYAHER = 'le-6' as CardDefinitionId;        // dúnadan, DI 2, no effects
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, DI 0, filler
const NURNIAGS = 'le-273' as CardDefinitionId;      // minion faction, influence # 10
const NURNIAG_CAMP = 'le-396' as CardDefinitionId;  // shadow-hold (Nûrniags home site)
const CARN_DUM = 'le-359' as CardDefinitionId;      // minion haven (filler)

describe('The Dark Power (as-79)', () => {
  beforeEach(() => resetMint());

  test('offered during an active influence attempt while playing as Sauron, pinned to the influencing character', () => {
    const eyeInPlay: CardInPlay = { instanceId: 'eye-1' as CardInstanceId, definitionId: LIDLESS_EYE, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER, LAGDUF] }], hand: [DARK_POWER, NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [eyeInPlay] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, NURNIAGS);

    // Declare the influence attempt with Ciryaher; opponent passes priority.
    const attempt = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.factionInstanceId === factionId && a.influencingCharacterId === ciryaherId);
    expect(attempt).toBeDefined();
    const afterAttempt = dispatch(state, attempt!);
    const pass = computeLegalActions(afterAttempt, PLAYER_2).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    expect(pass).toBeDefined();
    const chainState = dispatch(afterAttempt, pass!.action);

    const offers = computeLegalActions(chainState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action).optionId === 'dark-power-boost')
      .map(ea => ea.action as PlayShortEventAction);

    // Only the influencing character (Ciryaher) is a legal target — never
    // Lagduf, who is not making the influence check.
    expect(offers.length).toBe(1);
    expect(offers[0].targetCharacterId).toBe(ciryaherId);
  });

  test('NOT offered when the player is not Sauron (no play-as-sauron marker in play)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [DARK_POWER, NURNIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = findHandCardId(state, RESOURCE_PLAYER, NURNIAGS);
    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    const afterAttempt = dispatch(state, attempt!);
    const pass = computeLegalActions(afterAttempt, PLAYER_2).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    const chainState = dispatch(afterAttempt, pass!.action);

    const offers = computeLegalActions(chainState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action).optionId === 'dark-power-boost');
    expect(offers).toHaveLength(0);
  });

  test('NOT offered before an influence attempt is declared (faction still in hand)', () => {
    const eyeInPlay: CardInPlay = { instanceId: 'eye-1' as CardInstanceId, definitionId: LIDLESS_EYE, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [DARK_POWER, NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [eyeInPlay] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && (ea.action).optionId === 'dark-power-boost');
    expect(offers).toHaveLength(0);
  });

  test('playing The Dark Power adds a +3 one-shot influence constraint carrying the shuffle-on-failure flag', () => {
    const eyeInPlay: CardInPlay = { instanceId: 'eye-1' as CardInstanceId, definitionId: LIDLESS_EYE, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [DARK_POWER, NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [eyeInPlay] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, NURNIAGS);
    const darkPowerId = findHandCardId(state, RESOURCE_PLAYER, DARK_POWER);

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    const afterAttempt = dispatch(state, attempt!);
    const pass = computeLegalActions(afterAttempt, PLAYER_2).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    const chainState = dispatch(afterAttempt, pass!.action);

    const after = resolveChain(dispatch(chainState, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: darkPowerId,
      targetCharacterId: ciryaherId,
      optionId: 'dark-power-boost',
    }));

    const influenceConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(influenceConstraints).toHaveLength(1);
    const constraint = influenceConstraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.value).toBe(3);
      expect(constraint.kind.onFailure).toBe('shuffle-faction-into-deck');
    }
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(ciryaherId);
    }

    // The spent event is discarded; the faction rides the chain / pending roll.
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(darkPowerId);

    // The pending faction-influence-roll shows the boosted need:
    // influence # 10 - DI 2 - Dark Power 3 = 5.
    const rollActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')
      .map(ea => ea.action as FactionInfluenceRollAction);
    expect(rollActions.length).toBeGreaterThan(0);
    expect(rollActions[0].need).toBe(5);
  });

  test('failed boosted check shuffles the faction into the play deck instead of discarding it', () => {
    const eyeInPlay: CardInPlay = { instanceId: 'eye-1' as CardInstanceId, definitionId: LIDLESS_EYE, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [DARK_POWER, NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [eyeInPlay] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, NURNIAGS);
    const darkPowerId = findHandCardId(state, RESOURCE_PLAYER, DARK_POWER);

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    const afterAttempt = dispatch(state, attempt!);
    const pass = computeLegalActions(afterAttempt, PLAYER_2).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    const chainState = dispatch(afterAttempt, pass!.action);
    const resolved = resolveChain(dispatch(chainState, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: darkPowerId,
      targetCharacterId: ciryaherId,
      optionId: 'dark-power-boost',
    }));

    // Force a low roll: 2 + DI 2 + boost 3 = 7 < influence # 10 → failure.
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    expect(rollActions.length).toBeGreaterThan(0);
    const after = dispatch({ ...resolved, cheatRollTotal: 2 }, rollActions[0].action);

    // The faction is shuffled into the play deck — not discarded, not in play.
    expect(after.players[0].playDeck.map(c => c.instanceId)).toContain(factionId);
    expect(after.players[0].discardPile.map(c => c.instanceId)).not.toContain(factionId);
    expect(after.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(factionId);

    // The one-shot constraint was consumed by the roll.
    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });

  test('successful boosted check puts the faction into play normally', () => {
    const eyeInPlay: CardInPlay = { instanceId: 'eye-1' as CardInstanceId, definitionId: LIDLESS_EYE, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [DARK_POWER, NURNIAGS], siteDeck: [CARN_DUM], cardsInPlay: [eyeInPlay] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, NURNIAGS);
    const darkPowerId = findHandCardId(state, RESOURCE_PLAYER, DARK_POWER);

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    const afterAttempt = dispatch(state, attempt!);
    const pass = computeLegalActions(afterAttempt, PLAYER_2).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    const chainState = dispatch(afterAttempt, pass!.action);
    const resolved = resolveChain(dispatch(chainState, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: darkPowerId,
      targetCharacterId: ciryaherId,
      optionId: 'dark-power-boost',
    }));

    // Force a high roll: 12 + DI 2 + boost 3 = 17 >= 10 → success.
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    const after = dispatch({ ...resolved, cheatRollTotal: 12 }, rollActions[0].action);

    expect(after.players[0].cardsInPlay.map(c => c.instanceId)).toContain(factionId);
    expect(after.players[0].playDeck.map(c => c.instanceId)).not.toContain(factionId);
    expect(after.players[0].discardPile.map(c => c.instanceId)).not.toContain(factionId);
  });

  test('failed check WITHOUT The Dark Power still discards the faction (default path unchanged)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: NURNIAG_CAMP, characters: [CIRYAHER] }], hand: [NURNIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = findHandCardId(state, RESOURCE_PLAYER, NURNIAGS);

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    const resolved = resolveChain(dispatch(state, attempt!));

    // Low roll: 2 + DI 2 = 4 < 10 → failure → faction discarded as usual.
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    expect(rollActions.length).toBeGreaterThan(0);
    const after = dispatch({ ...resolved, cheatRollTotal: 2 }, rollActions[0].action);

    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(factionId);
    expect(after.players[0].playDeck.map(c => c.instanceId)).not.toContain(factionId);
  });
});
