/**
 * @module le-244.test
 *
 * Card test: Threats (le-244)
 * Type: minion-resource-event (short), alignment ringwraith
 *
 * Text:
 *   "Warrior only. Playable on a warrior attempting to influence a faction.
 *    Warrior does not use his unused direct influence for the attempt.
 *    Instead he uses his prowess, to a maximum modifier of +6."
 *
 * CRF 22: "For this card, your prowess is calculated when it resolves." —
 * hence the constraint carries a `prowessSubstitution: { max: 6 }` payload
 * (no baked value); the influence check reads the warrior's *effective*
 * prowess at resolution time and swaps it in for his whole unused-DI
 * contribution (free DI plus conditional direct-influence bonuses).
 *
 * Effects:
 *   1. play-target: character, filter $and [warrior skill, target.isInfluencing]
 *   2. play-option "influence-boost": when player.hasFactionInHand,
 *      add-constraint check-modifier influence until-cleared,
 *      prowessSubstitution { max: 6 }
 *
 * Engine support table:
 * | # | Rule                                                    | Status      |
 * |---|---------------------------------------------------------|-------------|
 * | 1 | Playable only on a warrior                              | IMPLEMENTED |
 * | 2 | Playable only on the character attempting the influence | IMPLEMENTED |
 * | 3 | Unused DI (incl. conditional bonuses) not used          | IMPLEMENTED |
 * | 4 | Prowess used instead, read at resolution time           | IMPLEMENTED |
 * | 5 | Maximum modifier of +6                                  | IMPLEMENTED |
 * | 6 | One-shot: consumed by the boosted influence check       | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures (all minion):
 *   ASTERNAK (le-1)          - warrior+diplomat, prowess 5, DI 2 (+2 vs Variag Camp factions)
 *   LUITPRAND (le-23)        - scout (no warrior), prowess 3, DI 0
 *   LIEUTENANT_MORGUL (le-22)- warrior+ranger troll, prowess 8, DI 2
 *   SAW_TOOTHED_BLADE (le-342) - minor item, +1 prowess (max 8)
 *   VARIAG_CAMP (le-411)     - minion border-hold
 *   VARIAGS (le-292)         - minion faction, influence# 9, playable at Variag Camp
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint,
  PLAYER_1, PLAYER_2,
  dispatch, resolveChain,
  buildSitePhaseState, buildInfluenceAttemptChainState,
  findCharInstanceId, findHandCardId, RESOURCE_PLAYER,
  expectInDiscardPile, attachItemToChar, recomputeDerived,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
  InfluenceAttemptAction,
  FactionInfluenceRollAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';

const THREATS = 'le-244' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const LIEUTENANT_MORGUL = 'le-22' as CardDefinitionId;
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;

describe('Threats (le-244)', () => {
  beforeEach(() => resetMint());

  test('offered targeting the influencing warrior during an active influence attempt', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [THREATS, VARIAGS],
      factionDefId: VARIAGS,
    });
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);

    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'influence-boost');
    expect(offers).toHaveLength(1);
    expect(offers[0].targetCharacterId).toBe(asternak);
  });

  test('NOT offered before the influence attempt is declared (faction still in hand)', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [THREATS, VARIAGS],
    });
    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(offers).toHaveLength(0);
  });

  test('NOT offered when the influencing character is not a warrior', () => {
    // Luitprand is a scout — the "Warrior only" gate must reject him even
    // while his influence attempt is live.
    const state = buildInfluenceAttemptChainState({
      characters: [LUITPRAND],
      site: VARIAG_CAMP,
      hand: [THREATS, VARIAGS],
      factionDefId: VARIAGS,
    });
    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(offers).toHaveLength(0);
  });

  test('NOT offered on a bystander warrior when a non-warrior is the one influencing', () => {
    // Asternak (warrior) stands by while Luitprand (scout) makes the attempt.
    // Threats is "playable on a warrior attempting to influence a faction" —
    // the warrior filter and the isInfluencing pin must both hold on the SAME
    // character, so no offer exists at all.
    const base = buildSitePhaseState({
      characters: [ASTERNAK, LUITPRAND],
      site: VARIAG_CAMP,
      hand: [THREATS, VARIAGS],
    });
    const luitprand = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const attempt = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === luitprand);
    expect(attempt).toBeDefined();
    const afterAttempt = dispatch(base, attempt!);
    const passPriority = computeLegalActions(afterAttempt, PLAYER_2)
      .find(ea => ea.viable && ea.action.type === 'pass-chain-priority');
    expect(passPriority).toBeDefined();
    const inChain = dispatch(afterAttempt, passPriority!.action);

    const offers = computeLegalActions(inChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(offers).toHaveLength(0);
  });

  test('playing Threats adds a prowess-substitution constraint on the warrior and discards the card', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [THREATS, VARIAGS],
      factionDefId: VARIAGS,
    });
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const threatsInstance = findHandCardId(state, RESOURCE_PLAYER, THREATS);

    // The boost rides the chain of effects (CoE 9.4/9.5); resolving the chain
    // applies the constraint and then resolves the influence attempt itself.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: threatsInstance,
      targetCharacterId: asternak,
      optionId: 'influence-boost',
    }));

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    const kind = constraints[0].kind;
    if (kind.type === 'check-modifier') {
      // No baked value — the prowess is read when the check resolves (CRF 22).
      expect(kind.value).toBe(0);
      expect(kind.prowessSubstitution).toEqual({ max: 6 });
    }
    expect(constraints[0].target.kind).toBe('character');
    if (constraints[0].target.kind === 'character') {
      expect(constraints[0].target.characterId).toBe(asternak);
    }
    expectInDiscardPile(after, RESOURCE_PLAYER, threatsInstance);
  });

  test('substitution replaces the whole unused-DI contribution, including conditional bonuses', () => {
    // Asternak: free DI 2 + conditional +2 vs Variag Camp factions = 4 against
    // Variags (influence # 9) → baseline need 5. With Threats the whole DI
    // contribution is dropped and min(prowess 5, 6) = 5 is used → need 4.
    const base = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);

    const baseAttempt = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === asternak);
    expect(baseAttempt).toBeDefined();
    expect(baseAttempt!.need).toBe(5); // 9 - 2 (DI) - 2 (Variag Camp bonus)

    const boosted = addConstraint(base, {
      source: 'threats-1' as CardInstanceId,
      sourceDefinitionId: THREATS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: asternak },
      kind: { type: 'check-modifier', check: 'influence', value: 0, prowessSubstitution: { max: 6 } },
    });
    const boostedAttempt = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === asternak);
    expect(boostedAttempt).toBeDefined();
    expect(boostedAttempt!.need).toBe(4); // 9 - min(5, 6)
  });

  test('prowess contribution is capped at +6', () => {
    // Lieutenant of Morgul: prowess 8, DI 2 (his conditional DI bonuses only
    // fire vs Orc/Troll factions, not the Variags). Baseline need 9 - 2 = 7;
    // with Threats: 9 - min(8, 6) = 3.
    const base = buildSitePhaseState({
      characters: [LIEUTENANT_MORGUL],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const lieutenant = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_MORGUL);

    const baseAttempt = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === lieutenant);
    expect(baseAttempt).toBeDefined();
    expect(baseAttempt!.need).toBe(7); // 9 - 2 (DI)

    const boosted = addConstraint(base, {
      source: 'threats-1' as CardInstanceId,
      sourceDefinitionId: THREATS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: lieutenant },
      kind: { type: 'check-modifier', check: 'influence', value: 0, prowessSubstitution: { max: 6 } },
    });
    const boostedAttempt = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === lieutenant);
    expect(boostedAttempt).toBeDefined();
    expect(boostedAttempt!.need).toBe(3); // 9 - min(8, 6)
  });

  test('effective prowess at resolution counts item bonuses (CRF: calculated when it resolves)', () => {
    // Asternak (prowess 5) bearing Saw-toothed Blade (+1 prowess, max 8) has
    // effective prowess 6 → substituted contribution min(6, 6) = 6 → need 3.
    // With base prowess alone it would be 5 → need 4 (previous test).
    const built = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    // A minion item contributes no bonus on a Wizard player's character
    // (rule 9.20) — the builder defaults to hero alignment, so flip the
    // resource player to Ringwraith before recomputing effective stats.
    const minion = {
      ...built,
      players: [{ ...built.players[0], alignment: Alignment.Ringwraith }, built.players[1]] as const,
    };
    const base = recomputeDerived(attachItemToChar(minion, RESOURCE_PLAYER, ASTERNAK, SAW_TOOTHED_BLADE));
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    expect(base.players[0].characters[asternak].effectiveStats.prowess).toBe(6);
    const boosted = addConstraint(base, {
      source: 'threats-1' as CardInstanceId,
      sourceDefinitionId: THREATS,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: asternak },
      kind: { type: 'check-modifier', check: 'influence', value: 0, prowessSubstitution: { max: 6 } },
    });
    const boostedAttempt = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === asternak);
    expect(boostedAttempt).toBeDefined();
    expect(boostedAttempt!.need).toBe(3); // 9 - min(5 + 1, 6)
  });

  test('end-to-end: substituted prowess decides the roll and the constraint is consumed', () => {
    // Lieutenant of Morgul influences Variags (influence # 9). Play Threats in
    // the boost window, resolve the chain, then roll exactly 3: with the
    // substitution 3 + 6 = 9 >= 9 → success (unboosted, 3 + DI 2 = 5 would
    // have failed). The faction enters play and the one-shot is consumed.
    const state = buildInfluenceAttemptChainState({
      characters: [LIEUTENANT_MORGUL],
      site: VARIAG_CAMP,
      hand: [THREATS, VARIAGS],
      factionDefId: VARIAGS,
    });
    const lieutenant = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const threatsInstance = findHandCardId(state, RESOURCE_PLAYER, THREATS);
    const factionInstance = state.chain!.entries
      .find(e => e.payload.type === 'influence-attempt')!.card!.instanceId;

    const resolved = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: threatsInstance,
      targetCharacterId: lieutenant,
      optionId: 'influence-boost',
    }));

    // The pending faction-influence-roll shows the substituted need:
    // influence # 9 - min(prowess 8, 6) = 3 (unused DI 2 not used).
    const rollActions = computeLegalActions(resolved, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')
      .map(ea => ea.action as FactionInfluenceRollAction);
    expect(rollActions.length).toBeGreaterThan(0);
    expect(rollActions[0].need).toBe(3);

    const after = dispatch({ ...resolved, cheatRollTotal: 3 }, rollActions[0]);

    // Success: faction in play, Threats spent, constraint consumed.
    expect(after.players[0].cardsInPlay.map(c => c.instanceId)).toContain(factionInstance);
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(threatsInstance);
    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });
});
