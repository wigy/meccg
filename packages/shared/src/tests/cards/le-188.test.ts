/**
 * @module le-188.test
 *
 * Card test: Gifts as Given of Old (le-188)
 * Type: minion-resource-event (short)
 * Effects:
 *   - play-target: character (any)
 *   - play-option "influence-boost": when player.hasFactionInHand,
 *     add-constraint check-modifier influence, fixed value +3, scope until-cleared
 *
 * "Provides +3 to an influence attempt against a faction."
 *
 * The card is a short event played in response to an active faction-influence
 * attempt (the faction has already left the player's hand into the chain, so the
 * `player.hasFactionInHand` gate is true only during that window). Playing it
 * places a one-shot `check-modifier` influence constraint (+3) on the
 * influencing character; the faction-influence-roll picks the bonus up into the
 * required `need` and the constraint is consumed once the roll resolves.
 *
 * Engine support table:
 * | # | Feature                                            | Status      | Notes                                                |
 * |---|----------------------------------------------------|-------------|------------------------------------------------------|
 * | 1 | Target = any character                             | IMPLEMENTED | play-target character, no filter                     |
 * | 2 | Offered only during an active influence attempt    | IMPLEMENTED | when: player.hasFactionInHand (chain-only)           |
 * | 3 | Fixed +3 constraint                                | IMPLEMENTED | add-constraint check-modifier influence value 3      |
 * | 4 | Constraint reduces influence-attempt need by 3     | IMPLEMENTED | site.ts collects check-modifier influence constraints|
 * | 5 | faction-influence-roll need reflects the +3        | IMPLEMENTED | pending.ts factionInfluenceRollActions               |
 * | 6 | Constraint consumed after the roll resolves        | IMPLEMENTED | reducer-site.ts consumes one-shot on resolution      |
 *
 * Minion fixtures (per CLAUDE.md: match the card's alignment):
 *   ASTERNAK (le-1)       - minion character, DI 2
 *   LUITPRAND (le-23)     - minion character, DI 0
 *   VARIAGS (le-292)      - minion faction, influence# 8, playable at Variag Camp
 *   VARIAG_CAMP (le-411)  - minion border-hold
 *   MINAS_MORGUL (le-390) - minion haven
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  LORIEN, MINAS_TIRITH,
  dispatch, resolveChain, makeMHState,
  buildSitePhaseState, buildInfluenceAttemptChainState,
  findCharInstanceId, findHandCardId, RESOURCE_PLAYER,
  expectInDiscardPile,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId,
  PlayShortEventAction, InfluenceAttemptAction, FactionInfluenceRollAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';

const GIFTS_AS_GIVEN_OF_OLD = 'le-188' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

describe('Gifts as Given of Old (le-188)', () => {
  beforeEach(() => resetMint());

  test('offered as a play-short-event with optionId influence-boost during an active influence attempt', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [GIFTS_AS_GIVEN_OF_OLD, VARIAGS],
      factionDefId: VARIAGS,
    });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'influence-boost')).toBe(true);
  });

  test('NOT offered before the influence attempt is declared (faction still in hand)', () => {
    // The hasFactionInHand gate is chain-scoped: holding a faction during the
    // ordinary site phase must not make the boost playable speculatively.
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [GIFTS_AS_GIVEN_OF_OLD, VARIAGS],
    });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(actions).toHaveLength(0);
  });

  test('NOT offered when there is no faction to influence', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [GIFTS_AS_GIVEN_OF_OLD],
    });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('NOT offered during the movement-hazard phase even with a faction in hand', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [GIFTS_AS_GIVEN_OF_OLD, VARIAGS], siteDeck: [VARIAG_CAMP] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LUITPRAND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = { ...base, phaseState: makeMHState() };
    const actions = computeLegalActions(mhState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(actions).toHaveLength(0);
  });

  test('playing it adds a +3 influence check-modifier constraint on the influencing character and is discarded', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [GIFTS_AS_GIVEN_OF_OLD, VARIAGS],
      factionDefId: VARIAGS,
    });
    const asternak = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, GIFTS_AS_GIVEN_OF_OLD);

    // The boost rides the chain of effects; resolve it (both players pass) so
    // the constraint is applied on resolution — see tw-337 for the regression.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: asternak,
      optionId: 'influence-boost',
    }));

    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    const constraint = constraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.value).toBe(3);
    }
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(asternak);
    }

    // Card consumed from hand into the discard pile; faction is in the chain.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardInstance)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('the active +3 constraint lowers the influence-attempt need by exactly 3', () => {
    // Asternak (DI 2, +2 more vs Variag Camp factions) at Variag Camp; Variags
    // influence# 9. Baseline modifier = 2 + 2 = 4 → need = 9 - 4 = 5.
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
    expect(baseAttempt!.need).toBe(5);

    const boosted = addConstraint(base, {
      source: 'gifts-1' as CardInstanceId,
      sourceDefinitionId: GIFTS_AS_GIVEN_OF_OLD,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: asternak },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });

    const boostedAttempt = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === asternak);
    expect(boostedAttempt).toBeDefined();
    expect(boostedAttempt!.need).toBe(2); // 9 - 4 - 3
  });

  test('faction-influence-roll need reflects the +3 constraint', () => {
    const base = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const factionInstance = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === VARIAGS)!;

    const boosted = addConstraint(base, {
      source: 'gifts-1' as CardInstanceId,
      sourceDefinitionId: GIFTS_AS_GIVEN_OF_OLD,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: asternak },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });

    const afterAttempt = dispatch(boosted, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: asternak,
      need: 1,
      explanation: 'test',
    });
    const afterChain = resolveChain(afterAttempt);

    const rollActions = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')
      .map(ea => ea.action as FactionInfluenceRollAction);
    expect(rollActions.length).toBeGreaterThan(0);
    expect(rollActions[0].need).toBe(2); // 9 - 4 - 3
  });

  test('the constraint is consumed after the faction-influence-roll resolves', () => {
    const base = buildSitePhaseState({
      characters: [ASTERNAK],
      site: VARIAG_CAMP,
      hand: [VARIAGS],
    });
    const asternak = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const factionInstance = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === VARIAGS)!;

    const boosted = addConstraint(base, {
      source: 'gifts-1' as CardInstanceId,
      sourceDefinitionId: GIFTS_AS_GIVEN_OF_OLD,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: asternak },
      kind: { type: 'check-modifier', check: 'influence', value: 3 },
    });

    // Force a high roll so the attempt succeeds and the chain finishes cleanly.
    const withCheat = { ...boosted, cheatRollTotal: 12 };

    const afterAttempt = dispatch(withCheat, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: asternak,
      need: 1,
      explanation: 'test',
    });
    const afterChain = resolveChain(afterAttempt);

    const rollActions = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    expect(rollActions.length).toBeGreaterThan(0);
    const after = dispatch(afterChain, rollActions[0].action);

    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });
});
