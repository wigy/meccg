/**
 * @module tw-267-lordly-presence.test
 *
 * Card test: Lordly Presence (tw-267)
 * Type: hero-resource-event (short)
 * Effects:
 *   - play-target: character, filter target.skills $includes diplomat
 *   - play-option "lordly-presence-boost": add-constraint check-modifier
 *     influence +5, scope until-cleared, onSuccess draw-card
 *
 * "Diplomat only. +5 to an influence check against a faction. If the
 *  influence check is successful, draw a card."
 *
 * Engine support table:
 * | # | Feature                                          | Status      | Notes                                                       |
 * |---|---------------------------------------------------|-------------|--------------------------------------------------------------|
 * | 1 | Target = diplomat (DSL filter)                     | IMPLEMENTED | play-target filter target.skills diplomat                    |
 * | 2 | Flat +5 influence check-modifier constraint        | IMPLEMENTED | add-constraint check-modifier influence, value 5              |
 * | 3 | Constraint modifies influence-attempt need         | IMPLEMENTED | site.ts collects check-modifier constraints                   |
 * | 4 | Constraint consumed after influence check          | IMPLEMENTED | reducer-site.ts consumes on resolution                        |
 * | 5 | Successful boosted check draws a card              | IMPLEMENTED | constraint kind onSuccess draw-card, resolveInfluenceAttemptRoll / drawCardsExhausting |
 * | 6 | Failed boosted check does not draw a card          | IMPLEMENTED | onSuccess only honoured on the success branch                 |
 * | 7 | Not playable when no diplomat present              | IMPLEMENTED | no eligible play-target -> not-playable                       |
 * | 8 | Not playable before influence attempt is declared  | IMPLEMENTED | when: player.hasFactionInHand (chain-only)                    |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint,
  PLAYER_1, PLAYER_2,
  ARAGORN, PEATH,
  BREE, RANGERS_OF_THE_NORTH, MORIA,
  dispatch, resolveChain,
  buildSitePhaseState, buildInfluenceAttemptChainState, firstFactionInfluenceAttempt,
  findCharInstanceId, findHandCardId, RESOURCE_PLAYER,
  addCardToPlayDeck,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  PlayShortEventAction,
  FactionInfluenceRollAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const LORDLY_PRESENCE = 'tw-267' as CardDefinitionId;

describe('Lordly Presence (tw-267)', () => {
  beforeEach(() => resetMint());

  test('offered as viable play-short-event during an active influence attempt by a diplomat', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [PEATH],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
      factionDefId: RANGERS_OF_THE_NORTH,
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions.some(a => a.optionId === 'lordly-presence-boost')).toBe(true);
  });

  test('NOT offered before influence attempt is declared (faction still in hand)', () => {
    const state = buildSitePhaseState({
      characters: [PEATH],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'lordly-presence-boost');
    expect(playActions).toHaveLength(0);
  });

  test('not offered when no diplomat is in the company', () => {
    // Aragorn is warrior/scout/ranger, not diplomat
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing Lordly Presence adds a +5 one-shot influence constraint carrying onSuccess draw-card', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [PEATH],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
      factionDefId: RANGERS_OF_THE_NORTH,
    });

    const peathId = findCharInstanceId(state, RESOURCE_PLAYER, PEATH);
    const lordlyPresenceId = findHandCardId(state, RESOURCE_PLAYER, LORDLY_PRESENCE);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: lordlyPresenceId,
      targetCharacterId: peathId,
      optionId: 'lordly-presence-boost',
    }));

    const influenceConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(influenceConstraints).toHaveLength(1);
    const constraint = influenceConstraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.value).toBe(5);
      expect(constraint.kind.onSuccess).toBe('draw-card');
    }
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(peathId);
    }

    // Spent event discarded; faction rides the chain / pending roll.
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(lordlyPresenceId);

    // Rangers of the North: influence # 10 - Peath DI 1 - Lordly Presence 5 = 4.
    const rollActions = computeLegalActions(after, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')
      .map(ea => ea.action as FactionInfluenceRollAction);
    expect(rollActions.length).toBeGreaterThan(0);
    expect(rollActions[0].need).toBe(4);
  });

  test('successful boosted check draws a card and puts the faction into play', () => {
    const withDeck = addCardToPlayDeck(buildSitePhaseState({
      characters: [PEATH],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
    }), 0, MORIA);

    const peathId = findCharInstanceId(withDeck, RESOURCE_PLAYER, PEATH);
    const lordlyPresenceId = findHandCardId(withDeck, RESOURCE_PLAYER, LORDLY_PRESENCE);
    const factionId = findHandCardId(withDeck, RESOURCE_PLAYER, RANGERS_OF_THE_NORTH);

    const attempt = firstFactionInfluenceAttempt(withDeck, factionId);
    expect(attempt).toBeDefined();
    const afterAttempt = dispatch(withDeck, attempt!);
    const pass = computeLegalActions(afterAttempt, PLAYER_2).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    expect(pass).toBeDefined();
    const state = dispatch(afterAttempt, pass!.action);

    const resolved = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: lordlyPresenceId,
      targetCharacterId: peathId,
      optionId: 'lordly-presence-boost',
    }));

    const handSizeBeforeRoll = resolved.players[0].hand.length;
    const deckSizeBeforeRoll = resolved.players[0].playDeck.length;
    expect(deckSizeBeforeRoll).toBeGreaterThan(0);

    // Force a high roll: 12 + DI 1 + boost 5 = 18 >= 10 -> success.
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    expect(rollActions.length).toBeGreaterThan(0);
    const after = dispatch({ ...resolved, cheatRollTotal: 12 }, rollActions[0].action);

    // The faction is now in play.
    expect(after.players[0].cardsInPlay.map(c => c.instanceId)).toContain(factionId);
    expect(after.players[0].discardPile.map(c => c.instanceId)).not.toContain(factionId);

    // A card was drawn: hand grew by one, play deck shrank by one.
    expect(after.players[0].hand.length).toBe(handSizeBeforeRoll + 1);
    expect(after.players[0].playDeck.length).toBe(deckSizeBeforeRoll - 1);

    // The one-shot constraint was consumed by the roll.
    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });

  test('failed boosted check does NOT draw a card; faction discarded as usual', () => {
    const base = buildSitePhaseState({
      characters: [PEATH],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
    });

    const peathId = findCharInstanceId(base, RESOURCE_PLAYER, PEATH);
    const lordlyPresenceId = findHandCardId(base, RESOURCE_PLAYER, LORDLY_PRESENCE);
    const factionId = findHandCardId(base, RESOURCE_PLAYER, RANGERS_OF_THE_NORTH);

    const attempt = firstFactionInfluenceAttempt(base, factionId);
    expect(attempt).toBeDefined();
    const afterAttempt = dispatch(base, attempt!);
    const pass = computeLegalActions(afterAttempt, PLAYER_2).find(
      ea => ea.viable && ea.action.type === 'pass-chain-priority',
    );
    expect(pass).toBeDefined();
    const state = dispatch(afterAttempt, pass!.action);

    const resolved = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: lordlyPresenceId,
      targetCharacterId: peathId,
      optionId: 'lordly-presence-boost',
    }));

    const handSizeBeforeRoll = resolved.players[0].hand.length;

    // Force a low roll: 2 + DI 1 + boost 5 = 8 < 10 -> failure.
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    expect(rollActions.length).toBeGreaterThan(0);
    const after = dispatch({ ...resolved, cheatRollTotal: 2 }, rollActions[0].action);

    // Faction discarded as usual; not in play.
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(factionId);
    expect(after.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(factionId);

    // No card was drawn on a failed check.
    expect(after.players[0].hand.length).toBe(handSizeBeforeRoll);

    // The one-shot constraint was consumed by the roll regardless of outcome.
    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });
});
