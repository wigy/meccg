/**
 * @module rule-8.16-ss-step5-defender-actions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.16: Strike Step 5: Defending Player Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 5 (Defending Player Actions) - A defending resource player may play resources, and/or may take resource/character actions on the character facing the strike and the non-follower cards it controls, if doing so would affect the resolution of the strike. This does not include actions that would tap the character facing the strike but that wouldn't otherwise affect the strike. Only one resource that requires a skill may be played during this step (but multiple resources that require skill may be played outside of this step).
 * A strike may be canceled up until the strike roll has been made, even if the attack could not be canceled.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND,
  MORIA,
  buildSitePhaseState, resetMint,
  findCharInstanceId, companyIdAt,
  viableActions, dispatchResult,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../../index.js';
import type { CombatState } from '../../../index.js';
import { Race } from '../../../index.js';

const VILYA = 'tw-358' as CardDefinitionId;

describe('Rule 8.16 — Strike Step 5: Defending Player Actions', () => {
  beforeEach(() => resetMint());

  test('Resource short-event boosting prowess on strike character is playable during resolve-strike (step 5)', () => {
    // Vilya gives Elrond +4 prowess / +2 body until end of turn. When Elrond
    // faces a strike, Vilya targets him and has prowess/body stat-modifier
    // effects, so it should be offered as play-short-event during step 5
    // (rule 3.iv.5: "play resources...if doing so would affect the strike").
    const base = buildSitePhaseState({ site: MORIA, characters: [ELROND], hand: [VILYA] });

    const elrondId = findCharInstanceId(base, RESOURCE_PLAYER, ELROND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Inject a resolve-strike combat state with Elrond facing the strike.
    // attackerStep1Done=true so the defender is not blocked waiting for the attacker.
    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as never, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 7,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: elrondId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
      attackerStep1Done: true,
    };

    const state = { ...base, combat } as typeof base;

    // Vilya should be offered as play-short-event during step 5
    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    const vilyaAction = shortEventActions.find(
      ea => (ea.action as PlayShortEventAction).targetCharacterId === elrondId,
    );
    expect(vilyaAction).toBeDefined();
  });

  test('Resource short-event targeting strike character is playable between strike sequences (choose-strike-order)', () => {
    // Between strike sequences, rule 3.iv allows the resource player to take
    // any action otherwise legal during the current phase. Vilya is a resource
    // short-event playable on Elrond during the site phase, so it should be
    // offered during choose-strike-order.
    const base = buildSitePhaseState({ site: MORIA, characters: [ELROND], hand: [VILYA] });

    const elrondId = findCharInstanceId(base, RESOURCE_PLAYER, ELROND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Inject a choose-strike-order combat state (between strike sequences)
    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as never, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 7,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: elrondId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'choose-strike-order',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };

    const state = { ...base, combat } as typeof base;

    // Vilya should be offered as play-short-event in the between-strikes window
    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(shortEventActions.length).toBeGreaterThan(0);
  });

  test('Playing Vilya on Elrond during resolve-strike resolves without error and adds prowess constraint', () => {
    // Playing Vilya during combat must succeed end-to-end: the reducer must
    // accept the play-short-event action, apply Elrond's prowess/body boost,
    // and leave the combat state intact for subsequent strike resolution.
    const base = buildSitePhaseState({ site: MORIA, characters: [ELROND], hand: [VILYA] });

    const elrondId = findCharInstanceId(base, RESOURCE_PLAYER, ELROND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as never, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 7,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: elrondId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
      attackerStep1Done: true,
    };

    const state = { ...base, combat } as typeof base;

    const shortEventActions = viableActions(state, PLAYER_1, 'play-short-event');
    const vilyaAction = shortEventActions.find(
      ea => (ea.action as PlayShortEventAction).targetCharacterId === elrondId,
    );
    expect(vilyaAction).toBeDefined();

    // Play Vilya — reducer must not return an error
    const result = dispatchResult(state, vilyaAction!.action);
    expect(result.error).toBeUndefined();

    // Combat must still be active after playing Vilya
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.phase).toBe('resolve-strike');

    // A prowess constraint for Elrond must now be active (Vilya's +4 prowess)
    const elrondProwessConstraint = result.state.activeConstraints.find(
      c => c.kind.type === 'character-stat-modifier'
        && c.kind.characterId === elrondId
        && c.kind.stat === 'prowess'
        && c.kind.value === 4,
    );
    expect(elrondProwessConstraint).toBeDefined();
  });
});
