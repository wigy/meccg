/**
 * @module td-7.test
 *
 * Card test: Carrion Birds (td-7)
 * Type: hazard-creature (Animals), non-unique
 *
 * Text:
 *   "Animals. May be played keyed to wilderness [{w}] after any Orc, Troll,
 *    or Man attack keyed to wilderness and against the same company. Each
 *    character in the company faces one strike. Any character wounded by
 *    Carrion Birds makes two body checks instead of one, both checks
 *    modified by -1."
 *
 * Effects:
 * | # | Rule (card text)                                        | Encoding                                     |
 * |---|----------------------------------------------------------|-----------------------------------------------|
 * | 1 | "May be played keyed to wilderness after any Orc, Troll, | keyedTo: [{ followsAttackKeyedTo: {          |
 * |   |  or Man attack keyed to wilderness ... same company."    |   races: [orc,troll,man], regionTypes: [w] }}]|
 * | 2 | "Each character in the company faces one strike."        | combat-one-strike-per-character              |
 * | 3 | "... makes two body checks instead of one, both checks    | combat-body-check-modifier { value: -1 }      |
 * |   |  modified by -1."                                         | + wound-additional-body-check { modifier: 0 } |
 *
 * Rule 1 has no independent region-type/site-type requirement of its own:
 * Carrion Birds' printed "keyed to wilderness" *is* the follow-up clause,
 * since a company's resolved M/H path cannot change mid-sub-phase (if the
 * earlier attack was keyed to wilderness, wilderness is in the path now
 * too). Rule 3's two checks are both modified by -1 because the attack-wide
 * `combat-body-check-modifier` (-1) applies to every body check this attack
 * produces, including the additional one queued by `wound-additional-body-check`
 * (whose own `modifier: 0` adds nothing on top).
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  resolveChain, findCharInstanceId,
  handCardId, companyIdAt, charIdAt, dispatch,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, Race } from '../../index.js';
import type {
  CardDefinitionId, CombatState, GameState, MovementHazardPhaseState, PlayHazardAction,
} from '../../index.js';

const CARRION_BIRDS = 'td-7' as CardDefinitionId;

function twoPlayerMHState(hazardHand: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: hazardHand,
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Carrion Birds (td-7)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: follows-attack-keyed-to keying ───────────────────────────

  test('NOT playable when the company has faced no attack this sub-phase', () => {
    const state = twoPlayerMHState([CARRION_BIRDS]);
    const gameState = { ...state, phaseState: makeMHState() };

    const cbId = handCardId(gameState, HAZARD_PLAYER, 0);
    const offered = viableActions(gameState, PLAYER_2, 'play-hazard').filter(
      a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === cbId,
    );
    expect(offered).toHaveLength(0);
  });

  test('NOT playable when the earlier Orc attack was kept but keyed to a site, not to wilderness', () => {
    const state = twoPlayerMHState([CARRION_BIRDS]);
    const gameState = {
      ...state,
      phaseState: makeMHState({
        hazardsEncountered: ['Orc-lieutenant'],
        hazardsEncounteredKeying: [
          { name: 'Orc-lieutenant', regionTypes: [], siteTypes: [SiteType.RuinsAndLairs] },
        ],
      }),
    };

    const cbId = handCardId(gameState, HAZARD_PLAYER, 0);
    const offered = viableActions(gameState, PLAYER_2, 'play-hazard').filter(
      a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === cbId,
    );
    expect(offered).toHaveLength(0);
  });

  test('NOT playable when the only attack faced was a Wolf (not Orc/Troll/Man), even keyed to wilderness', () => {
    const state = twoPlayerMHState([CARRION_BIRDS]);
    const gameState = {
      ...state,
      phaseState: makeMHState({
        hazardsEncountered: ['Wolves'],
        hazardsEncounteredKeying: [
          { name: 'Wolves', regionTypes: [RegionType.Wilderness], siteTypes: [] },
        ],
      }),
    };

    const cbId = handCardId(gameState, HAZARD_PLAYER, 0);
    const offered = viableActions(gameState, PLAYER_2, 'play-hazard').filter(
      a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === cbId,
    );
    expect(offered).toHaveLength(0);
  });

  test('playable as a follow-up once a real Orc attack keyed to wilderness has resolved against the same company', () => {
    const state = twoPlayerMHState([ORC_LIEUTENANT, CARRION_BIRDS]);
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Some Lair',
    });
    let s: GameState = { ...state, phaseState: mhState };

    const companyId = companyIdAt(s, RESOURCE_PLAYER);
    const ltId = handCardId(s, HAZARD_PLAYER, 0);
    const afterPlay = dispatch(s, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: RegionType.Wilderness },
    });
    s = resolveChain(afterPlay);
    expect(s.combat).not.toBeNull();
    expect(s.combat!.creatureRace).toBe('orc');

    // Resolve the Orc-lieutenant's single strike cleanly (no wound).
    const aragornId = charIdAt(s, RESOURCE_PLAYER);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    s = { ...s, cheatRollTotal: 12 };
    const resolveAction = computeLegalActions(s, PLAYER_1).find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    s = dispatch(s, resolveAction!.action);
    expect(s.combat).toBeNull();

    const ps = s.phaseState as MovementHazardPhaseState;
    expect(ps.hazardsEncountered).toContain('Orc-lieutenant');
    expect(ps.hazardsEncounteredKeying).toEqual([
      { name: 'Orc-lieutenant', regionTypes: [RegionType.Wilderness], siteTypes: [] },
    ]);

    // Carrion Birds is now offered as a follow-up, keyed by the new method.
    const cbId = handCardId(s, HAZARD_PLAYER, 0);
    const offered = viableActions(s, PLAYER_2, 'play-hazard').filter(
      a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === cbId,
    );
    const followUp = offered.find(a => (a.action as PlayHazardAction).keyedBy?.method === 'follows-attack-keyed-to');
    expect(followUp).toBeDefined();
    expect((followUp!.action as PlayHazardAction).keyedBy).toEqual({
      method: 'follows-attack-keyed-to', value: 'Orc-lieutenant',
    });

    // ─── Rule 2: one strike per character; base prowess 6 ───────────────
    const afterCbPlay = dispatch(s, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cbId,
      targetCompanyId: companyId,
      keyedBy: { method: 'follows-attack-keyed-to' as const, value: 'Orc-lieutenant' },
    });
    const afterCbChain = resolveChain(afterCbPlay);
    expect(afterCbChain.combat).not.toBeNull();
    expect(afterCbChain.combat!.creatureRace).toBe('animal');
    expect(afterCbChain.combat!.strikeProwess).toBe(6);
    // Two characters (Aragorn, Gimli) in the company → two strikes, one each.
    expect(afterCbChain.combat!.strikesTotal).toBe(2);
    expect(afterCbChain.combat!.attackSource.type).toBe('creature');

    // ─── Rule 3: attack-wide -1 body-check modifier ──────────────────────
    expect(afterCbChain.combat!.bodyCheckModifier).toBe(-1);
  });

  // ─── Rule 3: two body checks on a wound, both modified by -1 ─────────

  function combatBaseState(): GameState {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [CARRION_BIRDS], siteDeck: [] },
      ],
    });
    return { ...state, phaseState: makeMHState() };
  }

  /** A pending character-target body check: Aragorn (body 9) struck by Carrion Birds itself. */
  function carrionBirdsBodyCheckCombat(state: GameState): CombatState {
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const cbInstanceId = handCardId(state, HAZARD_PLAYER, 0);
    return {
      attackSource: { type: 'creature', instanceId: cbInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 6,
      creatureBody: null,
      creatureRace: Race.Animal,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false, wasAlreadyWounded: false }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      isCvCC: false,
      detainment: false,
      // What chain-reducer's combat-body-check-modifier handling would have
      // threaded onto CombatState from Carrion Birds' own printed effects.
      bodyCheckModifier: -1,
    };
  }

  test('a wound queues a second body check; both checks carry the same -1 total modifier', () => {
    const state = combatBaseState();
    const combat = carrionBirdsBodyCheckCombat(state);
    // Aragorn body 9: effective roll = 9 + (-1 attack) = 8 <= 9 → survives (wounded).
    const ready = { ...state, combat, cheatRollTotal: 9 };
    const [firstCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
    expect(firstCheck.action.type).toBe('body-check-roll');
    if (firstCheck.action.type === 'body-check-roll') {
      // need = body(9) + 1 - woundedBonus(0) - attackMod(-1) - additionalMod(0) = 11
      expect(firstCheck.action.need).toBe(11);
    }
    const afterFirst = dispatch(ready, firstCheck.action);

    expect(afterFirst.combat).not.toBeNull();
    // Carrion Birds' own wound-additional-body-check (modifier 0) queues a
    // second, independent check — "two body checks instead of one".
    expect(afterFirst.combat!.pendingAdditionalBodyChecks).toEqual([0]);

    const [secondCheck] = viableActions(afterFirst, PLAYER_2, 'body-check-roll');
    if (secondCheck.action.type === 'body-check-roll') {
      // The attack-wide -1 still applies on the second check too — same need.
      expect(secondCheck.action.need).toBe(11);
    }

    // A roll of 10 would eliminate at 0 total modifier (10 > body 9), but the
    // attack-wide -1 drops the effective roll to 9 — survives, queue drains.
    const finalState = dispatch({ ...afterFirst, cheatRollTotal: 10 }, secondCheck.action);
    expect(finalState.combat).toBeNull();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(finalState.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);
  });

  test('the second body check is a genuine elimination chance despite the -1', () => {
    const state = combatBaseState();
    const combat = carrionBirdsBodyCheckCombat(state);
    const ready = { ...state, combat, cheatRollTotal: 9 };
    const [firstCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const afterFirst = dispatch(ready, firstCheck.action);
    expect(afterFirst.combat!.pendingAdditionalBodyChecks).toEqual([0]);

    // A roll of 11: effective roll 11 - 1 = 10 > body 9 → eliminated.
    const [secondCheck] = viableActions(afterFirst, PLAYER_2, 'body-check-roll');
    const finalState = dispatch({ ...afterFirst, cheatRollTotal: 11 }, secondCheck.action);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(finalState.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(true);
  });
});
