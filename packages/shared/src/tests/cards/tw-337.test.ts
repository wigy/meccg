/**
 * @module tw-337.test
 *
 * Card test: Tempering Friendship (tw-337)
 * Type: hero-resource-event (short)
 * Effects:
 *   - play-target: character (any)
 *   - play-option "influence-boost": when player.hasFactionInHand,
 *     add-constraint check-modifier influence, fixed value +4, scope until-cleared
 *
 * "+4 to an influence attempt against a faction."
 *
 * The card is a short event played in response to an active faction-influence
 * attempt (the influence-attempt is live in the chain, so the
 * `player.hasFactionInHand` gate is true only during that window). Playing it
 * places a one-shot `check-modifier` influence constraint (+4) on the
 * influencing character; the faction-influence-roll picks the bonus up into the
 * required `need` and the constraint is consumed once the roll resolves. This is
 * the hero counterpart of Gifts as Given of Old (le-188), which grants +3.
 *
 * Engine support table:
 * | # | Feature                                            | Status      | Notes                                                |
 * |---|----------------------------------------------------|-------------|------------------------------------------------------|
 * | 1 | Target = any character                             | IMPLEMENTED | play-target character, no filter                     |
 * | 2 | Offered only during an active influence attempt    | IMPLEMENTED | when: player.hasFactionInHand (chain-only)           |
 * | 3 | Fixed +4 constraint                                | IMPLEMENTED | add-constraint check-modifier influence value 4      |
 * | 4 | Constraint reduces influence-attempt need by 4     | IMPLEMENTED | site.ts collects check-modifier influence constraints|
 * | 5 | faction-influence-roll need reflects the +4        | IMPLEMENTED | pending.ts factionInfluenceRollActions               |
 * | 6 | Constraint consumed after the roll resolves        | IMPLEMENTED | reducer-site.ts consumes one-shot on resolution      |
 *
 * Hero fixtures (per CLAUDE.md: match the card's alignment):
 *   ELROND (tw-145)            - hero character, DI 4, elf
 *   WOOD_ELVES (tw-367)        - hero faction, influence# 9, elf +1, playable at Thranduil's Halls
 *   THRANDUILS_HALLS (tw-432)  - hero free-hold
 *   LORIEN (tw-408)            - hero haven
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  dispatch, resolveChain, makeMHState,
  buildSitePhaseState, buildInfluenceAttemptChainState,
  findCharInstanceId, findHandCardId, RESOURCE_PLAYER,
  expectInDiscardPile,
} from '../test-helpers.js';
import {
  ELROND, LEGOLAS, WOOD_ELVES, THRANDUILS_HALLS, LORIEN, MINAS_TIRITH,
} from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId,
  PlayShortEventAction, InfluenceAttemptAction, FactionInfluenceRollAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';

const TEMPERING_FRIENDSHIP = 'tw-337' as CardDefinitionId;

describe('Tempering Friendship (tw-337)', () => {
  beforeEach(() => resetMint());

  test('offered as a play-short-event with optionId influence-boost during an active influence attempt', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [TEMPERING_FRIENDSHIP, WOOD_ELVES],
      factionDefId: WOOD_ELVES,
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
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [TEMPERING_FRIENDSHIP, WOOD_ELVES],
    });
    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(actions).toHaveLength(0);
  });

  test('NOT offered when there is no faction to influence', () => {
    const state = buildSitePhaseState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [TEMPERING_FRIENDSHIP],
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
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [TEMPERING_FRIENDSHIP, WOOD_ELVES], siteDeck: [THRANDUILS_HALLS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState = { ...base, phaseState: makeMHState() };
    const actions = computeLegalActions(mhState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(actions).toHaveLength(0);
  });

  test('the boost is declared on the chain (opponent gets a response window) and the +4 constraint applies only on resolution', () => {
    // Regression (game mr9jvlnw-2ldyce, seq 267): an influence-check boost must
    // ride the chain of effects like any other short event, so the opponent can
    // respond before it — and the influence roll it feeds — resolves. Before the
    // fix the boost was applied inline: the constraint appeared immediately, the
    // card was discarded, and the opponent's response window was silently
    // skipped (they had zero legal actions after the boost was played).
    const state = buildInfluenceAttemptChainState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [TEMPERING_FRIENDSHIP, WOOD_ELVES],
      factionDefId: WOOD_ELVES,
    });
    const elrond = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, TEMPERING_FRIENDSHIP);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: elrond,
      optionId: 'influence-boost',
    });

    // The boost rode the chain: still a live chain, priority handed to the
    // opponent, and the constraint is NOT applied yet.
    expect(afterPlay.chain).not.toBeNull();
    expect(afterPlay.chain!.priority).toBe(PLAYER_2);
    expect(
      afterPlay.activeConstraints.filter(
        c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
      ),
    ).toHaveLength(0);
    // The card left the hand (it rides the chain entry) but is not discarded yet.
    expect(afterPlay.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardInstance)).toBe(false);
    expect(afterPlay.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstance)).toBe(false);

    // The opponent has a real response window (at least: pass chain priority).
    const opponentActions = computeLegalActions(afterPlay, PLAYER_2).filter(ea => ea.viable);
    expect(opponentActions.some(ea => ea.action.type === 'pass-chain-priority')).toBe(true);

    // Both players pass → the boost resolves: constraint applied on the
    // influencing character, card discarded.
    const after = resolveChain(afterPlay);
    const constraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(constraints).toHaveLength(1);
    const constraint = constraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.value).toBe(4);
    }
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(elrond);
    }
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('the active +4 constraint lowers the influence-attempt need by exactly 4', () => {
    // Elrond (DI 4, elf) at Thranduil's Halls; Wood-elves influence# 9 with the
    // elf standard modification (+1). Baseline modifier = 4 + 1 = 5 → need = 4.
    const base = buildSitePhaseState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });
    const elrond = findCharInstanceId(base, RESOURCE_PLAYER, ELROND);

    const baseAttempt = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === elrond);
    expect(baseAttempt).toBeDefined();
    const baseNeed = baseAttempt!.need;

    const boosted = addConstraint(base, {
      source: 'tempering-1' as CardInstanceId,
      sourceDefinitionId: TEMPERING_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: elrond },
      kind: { type: 'check-modifier', check: 'influence', value: 4 },
    });

    const boostedAttempt = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === elrond);
    expect(boostedAttempt).toBeDefined();
    expect(boostedAttempt!.need).toBe(baseNeed - 4);
  });

  test('faction-influence-roll need reflects the +4 constraint', () => {
    const base = buildSitePhaseState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });
    const elrond = findCharInstanceId(base, RESOURCE_PLAYER, ELROND);
    const factionInstance = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === WOOD_ELVES)!;

    const baseAttempt = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === elrond);
    const baseNeed = baseAttempt!.need;

    const boosted = addConstraint(base, {
      source: 'tempering-1' as CardInstanceId,
      sourceDefinitionId: TEMPERING_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: elrond },
      kind: { type: 'check-modifier', check: 'influence', value: 4 },
    });

    const afterAttempt = dispatch(boosted, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: elrond,
      need: 1,
      explanation: 'test',
    });
    const afterChain = resolveChain(afterAttempt);

    const rollActions = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')
      .map(ea => ea.action as FactionInfluenceRollAction);
    expect(rollActions.length).toBeGreaterThan(0);
    expect(rollActions[0].need).toBe(baseNeed - 4);
  });

  test('the constraint is consumed after the faction-influence-roll resolves', () => {
    const base = buildSitePhaseState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });
    const elrond = findCharInstanceId(base, RESOURCE_PLAYER, ELROND);
    const factionInstance = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === WOOD_ELVES)!;

    const boosted = addConstraint(base, {
      source: 'tempering-1' as CardInstanceId,
      sourceDefinitionId: TEMPERING_FRIENDSHIP,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: elrond },
      kind: { type: 'check-modifier', check: 'influence', value: 4 },
    });

    // Force a high roll so the attempt succeeds and the chain finishes cleanly.
    const withCheat = { ...boosted, cheatRollTotal: 12 };

    const afterAttempt = dispatch(withCheat, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: elrond,
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
