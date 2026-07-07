/**
 * @module tw-288.test
 *
 * Card test: Muster (tw-288)
 * Type: hero-resource-event (short)
 * Effects:
 *   - play-target: character, filter warrior
 *   - play-option "influence-boost": add-constraint check-modifier influence,
 *     value = min(warrior.baseProwess, 5), scope until-cleared
 *
 * "Warrior only. An influence check against a faction by a warrior is modified
 *  by adding the warrior's prowess to a maximum modifier of +5."
 *
 * Engine support table:
 * | # | Feature                                          | Status      | Notes                                                      |
 * |---|--------------------------------------------------|-------------|------------------------------------------------------------|
 * | 1 | Target = warrior (DSL filter)                    | IMPLEMENTED | play-target filter target.skills warrior                   |
 * | 2 | Prowess bonus capped at +5                       | IMPLEMENTED | valueExpr min(target.baseProwess, 5)                       |
 * | 3 | Constraint added with computed value              | IMPLEMENTED | add-constraint check-modifier influence                    |
 * | 4 | Constraint modifies influence-attempt need        | IMPLEMENTED | site.ts collects check-modifier constraints                |
 * | 5 | Constraint consumed after influence check         | IMPLEMENTED | reducer-site.ts consumes on resolution                     |
 * | 6 | Not playable when no warrior present              | IMPLEMENTED | no eligible play-target → not-playable                     |
 * | 7 | Not playable when no active influence attempt     | IMPLEMENTED | when: player.hasFactionInHand (chain-only)                 |
 * | 8 | Not playable during movement-hazard phase         | IMPLEMENTED | hasFactionInHand restricted to active chain only           |
 * | 9 | Not playable before influence attempt is declared | IMPLEMENTED | hasFactionInHand false when faction only in hand, not chain|
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, FARAMIR, BEREGOND, GIMLI,
  PELARGIR, MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  MEN_OF_LEBENNIN,
  dispatch, resolveChain,
  buildSitePhaseState, buildTestState, buildInfluenceAttemptChainState,
  findCharInstanceId, findHandCardId, RESOURCE_PLAYER, makeMHState,
  Phase,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
  InfluenceAttemptAction,
  FactionInfluenceRollAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint } from '../../engine/pending.js';

const MUSTER = 'tw-288' as CardDefinitionId;

describe('Muster (tw-288)', () => {
  beforeEach(() => resetMint());

  test('offered as viable play-short-event during an active influence attempt', () => {
    // Muster must be played in response to an active influence check — not
    // speculatively before the influence attempt is declared. Set up the chain
    // by dispatching the influence-attempt first; Muster should then be offered.
    const state = buildInfluenceAttemptChainState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions.some(a => a.optionId === 'influence-boost')).toBe(true);
  });

  test('NOT offered before influence attempt is declared (faction still in hand)', () => {
    // Regression: hasFactionInHand was true during the site phase whenever the
    // player had a faction card in hand, causing Muster to appear playable before
    // any influence check was in progress (game ID mpo1cqve-ltys6m, seq 103).
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(playActions).toHaveLength(0);
  });

  test('not offered when warrior is present but no faction in hand', () => {
    // Muster boosts an influence check — if there is no faction to influence, it is unplayable
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [MUSTER],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not offered when no warrior is in the company', () => {
    // Bilbo is a hobbit, not a warrior; Muster requires warrior
    const state = buildSitePhaseState({
      characters: [BILBO],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
    });

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing Muster on Aragorn (prowess 6) adds influence check-modifier constraint capped at 5', () => {
    // Set up an active influence attempt chain so Muster is playable
    const state = buildInfluenceAttemptChainState({
      characters: [ARAGORN],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const musterInstance = findHandCardId(state, RESOURCE_PLAYER, MUSTER);

    // The boost rides the chain of effects; resolve it (both players pass) so
    // the constraint is applied on resolution — see tw-337 for the regression.
    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: musterInstance,
      targetCharacterId: aragornId,
      optionId: 'influence-boost',
    }));

    // Constraint added with value capped at 5 (Aragorn prowess 6 → min(6,5) = 5)
    const influenceConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(influenceConstraints).toHaveLength(1);
    const constraint = influenceConstraints[0];
    expect(constraint.kind.type).toBe('check-modifier');
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.check).toBe('influence');
      expect(constraint.kind.value).toBe(5);
    }
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(aragornId);
    }

    // Muster consumed from hand and discarded; faction card is in the chain
    expect(after.players[0].hand).toHaveLength(0);
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain(musterInstance);
  });

  test('playing Muster on Faramir (prowess 5) adds influence check-modifier of 5 (at cap)', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [FARAMIR],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const musterInstance = findHandCardId(state, RESOURCE_PLAYER, MUSTER);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: musterInstance,
      targetCharacterId: faramirId,
      optionId: 'influence-boost',
    }));

    const influenceConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(influenceConstraints).toHaveLength(1);
    if (influenceConstraints[0].kind.type === 'check-modifier') {
      expect(influenceConstraints[0].kind.value).toBe(5);
    }
  });

  test('playing Muster on Beregond (prowess 4) adds influence check-modifier of 4 (below cap)', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [BEREGOND],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const beregondId = findCharInstanceId(state, RESOURCE_PLAYER, BEREGOND);
    const musterInstance = findHandCardId(state, RESOURCE_PLAYER, MUSTER);

    const after = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: musterInstance,
      targetCharacterId: beregondId,
      optionId: 'influence-boost',
    }));

    // Beregond prowess 4 → min(4,5) = 4; full prowess used, not capped
    const influenceConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(influenceConstraints).toHaveLength(1);
    if (influenceConstraints[0].kind.type === 'check-modifier') {
      expect(influenceConstraints[0].kind.value).toBe(4);
    }
  });

  test('active Muster constraint reduces influence-attempt need by warrior prowess (capped at 5)', () => {
    // Faramir (warrior, Dúnedain, DI 1) at Pelargir, Men of Lebennin in hand (influence 8).
    // Men of Lebennin has Dúnedain +1 modifier; Faramir is Dúnedain.
    // Baseline modifier = DI 1 + check bonus 1 = 2 → need = 8 - 2 = 6.
    // With Muster +5: modifier = 2 + 5 = 7 → need = 8 - 7 = 1.
    const base = buildSitePhaseState({
      characters: [FARAMIR],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const faramirId = findCharInstanceId(base, RESOURCE_PLAYER, FARAMIR);

    // Verify baseline need without Muster
    const baseActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);
    const baseAttempt = baseActions.find(a => a.influencingCharacterId === faramirId);
    expect(baseAttempt).toBeDefined();
    expect(baseAttempt!.need).toBe(6); // 8 - 1 (DI) - 1 (Dúnedain bonus)

    // Add Muster constraint manually (prowess 5, capped at 5)
    const boosted = addConstraint(base, {
      source: 'muster-1' as CardInstanceId,
      sourceDefinitionId: MUSTER,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: faramirId },
      kind: { type: 'check-modifier', check: 'influence', value: 5 },
    });

    const boostedActions = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction);
    const boostedAttempt = boostedActions.find(a => a.influencingCharacterId === faramirId);
    expect(boostedAttempt).toBeDefined();
    expect(boostedAttempt!.need).toBe(1); // 8 - 2 - 5
  });

  test('Muster constraint is consumed after influence attempt resolves', () => {
    const base = buildSitePhaseState({
      characters: [FARAMIR],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const faramirId = findCharInstanceId(base, RESOURCE_PLAYER, FARAMIR);
    const factionInstance = base.players[0].hand.find(
      c => c.definitionId === MEN_OF_LEBENNIN,
    )!;

    const boosted = addConstraint(base, {
      source: 'muster-1' as CardInstanceId,
      sourceDefinitionId: MUSTER,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: faramirId },
      kind: { type: 'check-modifier', check: 'influence', value: 5 },
    });

    // Force a high roll so the attempt succeeds
    const withCheat = { ...boosted, cheatRollTotal: 12 };

    // Dispatch the influence attempt; both players pass chain priority → enqueues faction-influence-roll
    const afterAttempt = dispatch(withCheat, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: faramirId,
      need: 1,
      explanation: 'test',
    });
    const afterChain = resolveChain(afterAttempt);

    // Dispatch the faction-influence-roll pending resolution
    const rollActions = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll');
    expect(rollActions.length).toBeGreaterThan(0);
    const after = dispatch(afterChain, rollActions[0].action);

    // Constraint consumed after the influence roll resolves
    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });

  test('faction-influence-roll need reflects active Muster constraint (game mpo1cqve-ltys6m seq 107)', () => {
    // Regression: factionInfluenceRollActions used raw DI and ignored activeConstraints,
    // so the displayed need was computed without the Muster +prowess bonus.
    const base = buildSitePhaseState({
      characters: [FARAMIR],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN],
    });

    const faramirId = findCharInstanceId(base, RESOURCE_PLAYER, FARAMIR);
    const factionInstance = base.players[0].hand.find(
      c => c.definitionId === MEN_OF_LEBENNIN,
    )!;

    // Baseline need without Muster (DI 1 + Dúnedain check bonus 1 = 2; 8 - 2 = 6)
    const boosted = addConstraint(base, {
      source: 'muster-1' as CardInstanceId,
      sourceDefinitionId: MUSTER,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: faramirId },
      kind: { type: 'check-modifier', check: 'influence', value: 5 },
    });

    // Dispatch influence-attempt and resolve chain to reach pending faction-influence-roll
    const afterAttempt = dispatch(boosted, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: faramirId,
      need: 1,
      explanation: 'test',
    });
    const afterChain = resolveChain(afterAttempt);

    // The faction-influence-roll legal action must show the Muster-adjusted need (8 - 2 - 5 = 1)
    const rollActions = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')
      .map(ea => ea.action as FactionInfluenceRollAction);
    expect(rollActions.length).toBeGreaterThan(0);
    expect(rollActions[0].need).toBe(1);
  });

  test('influence-boost: NOT offered during movement-hazard phase even with warrior and faction in hand', () => {
    // Regression: hasFactionInHand was true any time the player held a faction
    // card, so Muster appeared playable during the movement-hazard phase even
    // though no influence check was in progress (game ID mpk6t3id-kalubb, seq 218).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [MUSTER, MEN_OF_LEBENNIN],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = { ...state, phaseState: makeMHState() };

    const viableActions = computeLegalActions(mhState, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event'
        && ea.action.optionId === 'influence-boost');
    expect(viableActions).toHaveLength(0);
  });
});
