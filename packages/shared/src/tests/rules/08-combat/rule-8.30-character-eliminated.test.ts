/**
 * @module rule-8.30-character-eliminated
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.30: Character Eliminated from Body Check
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a character fails a body check, the character is eliminated and any effects or passive conditions that depend on the character being eliminated are resolved immediately. For each unwounded character in the same company, an item that the eliminated character controlled may be immediately transferred to that unwounded character (up to one item per unwounded character), and all other non-follower cards that the eliminated character controlled are immediately discarded.
 * A failed body check on an unwounded character will result in the character being eliminated, but a successful body check doesn't otherwise affect the character.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DAGGER_OF_WESTERNESSE,
  buildTestState, resetMint, makeMHState, findCharInstanceId,
  dispatch, viableActions,
  Phase, companyIdAt,
} from '../../test-helpers.js';
import { RegionType, SiteType, CardStatus } from '../../../index.js';
import type { CombatState, CardInstanceId } from '../../../index.js';

describe('Rule 8.30 — Character Eliminated from Body Check', () => {
  beforeEach(() => resetMint());

  test('item-salvage phase entered when character with items is eliminated and unwounded companions exist', () => {
    // Bilbo has a Dagger, Aragorn is unwounded in the same company.
    // Bilbo fails a body check → item-salvage phase should be entered.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              ARAGORN,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, 0, BILBO);
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const companyId = companyIdAt(state, 0);

    // Wound Bilbo so body check is triggered after strike failure
    const p0 = { ...state.players[0] };
    p0.characters = {
      ...p0.characters,
      [bilboId as string]: { ...p0.characters[bilboId as string], status: CardStatus.Inverted },
    };
    const players = [p0, state.players[1]] as const;

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    // Set up combat in body-check phase for Bilbo
    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [
        { characterId: bilboId, excessStrikes: 0, resolved: true, result: 'wounded', wasAlreadyWounded: false },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      detainment: false,
    };

    // Body check roll of 12 > Bilbo's body (9) → eliminated
    const readyState = { ...state, players, phaseState: mhState, combat, cheatRollTotal: 12 };
    const nextState = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    // Should enter item-salvage phase
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.phase).toBe('item-salvage');
    expect(nextState.combat!.salvageItems).toHaveLength(1);
    expect(nextState.combat!.salvageRecipients).toContain(aragornId);

    // Bilbo should be in eliminated pile, not in characters
    expect(nextState.players[0].characters[bilboId as string]).toBeUndefined();
    expect(nextState.players[0].eliminatedPile.some(c => c.instanceId === bilboId)).toBe(true);
  });

  test('salvage-item action transfers item to unwounded companion', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              ARAGORN,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, 0, BILBO);
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const companyId = companyIdAt(state, 0);
    const daggerId = state.players[0].characters[bilboId as string].items[0].instanceId;

    // Wound Bilbo
    const p0 = { ...state.players[0] };
    p0.characters = {
      ...p0.characters,
      [bilboId as string]: { ...p0.characters[bilboId as string], status: CardStatus.Inverted },
    };
    const players = [p0, state.players[1]] as const;

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [
        { characterId: bilboId, excessStrikes: 0, resolved: true, result: 'wounded', wasAlreadyWounded: false },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      detainment: false,
    };

    // Eliminate Bilbo
    const readyState = { ...state, players, phaseState: mhState, combat, cheatRollTotal: 12 };
    const afterBodyCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });
    expect(afterBodyCheck.combat!.phase).toBe('item-salvage');

    // Salvage the Dagger to Aragorn
    const salvageActions = viableActions(afterBodyCheck, PLAYER_1, 'salvage-item');
    expect(salvageActions.length).toBe(1);
    const salvageAction = salvageActions[0].action;
    expect(salvageAction.type).toBe('salvage-item');

    const afterSalvage = dispatch(afterBodyCheck, salvageAction);

    // Combat should have finalized (all strikes resolved)
    expect(afterSalvage.combat).toBeNull();

    // Aragorn should now have the Dagger
    const aragornData = afterSalvage.players[0].characters[aragornId as string];
    expect(aragornData.items.some(i => i.instanceId === daggerId)).toBe(true);
  });

  test('pass during item-salvage discards remaining items', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              ARAGORN,
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, 0, BILBO);
    const companyId = companyIdAt(state, 0);
    const daggerId = state.players[0].characters[bilboId as string].items[0].instanceId;

    // Wound Bilbo
    const p0 = { ...state.players[0] };
    p0.characters = {
      ...p0.characters,
      [bilboId as string]: { ...p0.characters[bilboId as string], status: CardStatus.Inverted },
    };
    const players = [p0, state.players[1]] as const;

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [
        { characterId: bilboId, excessStrikes: 0, resolved: true, result: 'wounded', wasAlreadyWounded: false },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      detainment: false,
    };

    // Eliminate Bilbo
    const readyState = { ...state, players, phaseState: mhState, combat, cheatRollTotal: 12 };
    const afterBodyCheck = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });
    expect(afterBodyCheck.combat!.phase).toBe('item-salvage');

    // Pass — decline salvage
    const afterPass = dispatch(afterBodyCheck, { type: 'pass', player: PLAYER_1 });

    // Combat should have finalized
    expect(afterPass.combat).toBeNull();

    // Dagger should be in discard pile, not on any character
    expect(afterPass.players[0].discardPile.some(c => c.instanceId === daggerId)).toBe(true);
  });

  test('no item-salvage when eliminated character has no items', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [BILBO, ARAGORN],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, 0, BILBO);
    const companyId = companyIdAt(state, 0);

    // Wound Bilbo
    const p0 = { ...state.players[0] };
    p0.characters = {
      ...p0.characters,
      [bilboId as string]: { ...p0.characters[bilboId as string], status: CardStatus.Inverted },
    };
    const players = [p0, state.players[1]] as const;

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [
        { characterId: bilboId, excessStrikes: 0, resolved: true, result: 'wounded', wasAlreadyWounded: false },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      detainment: false,
    };

    // Eliminate Bilbo (no items) — body check roll 12 > body 9
    const readyState = { ...state, players, phaseState: mhState, combat, cheatRollTotal: 12 };
    const nextState = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    // Should skip item-salvage and finalize combat directly
    expect(nextState.combat).toBeNull();
  });

  test('no item-salvage when no unwounded companions in company', () => {
    // Bilbo has a Dagger, but Aragorn (only companion) is wounded
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [
              { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] },
              { defId: ARAGORN, status: CardStatus.Inverted },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const bilboId = findCharInstanceId(state, 0, BILBO);
    const companyId = companyIdAt(state, 0);
    const daggerId = state.players[0].characters[bilboId as string].items[0].instanceId;

    // Wound Bilbo
    const p0 = { ...state.players[0] };
    p0.characters = {
      ...p0.characters,
      [bilboId as string]: { ...p0.characters[bilboId as string], status: CardStatus.Inverted },
    };
    const players = [p0, state.players[1]] as const;

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [
        { characterId: bilboId, excessStrikes: 0, resolved: true, result: 'wounded', wasAlreadyWounded: false },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      detainment: false,
    };

    // Eliminate Bilbo — no unwounded companions → skip salvage
    const readyState = { ...state, players, phaseState: mhState, combat, cheatRollTotal: 12 };
    const nextState = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 10, explanation: 'test' });

    // Should skip item-salvage and finalize combat directly
    expect(nextState.combat).toBeNull();

    // Dagger should be in discard pile
    expect(nextState.players[0].discardPile.some(c => c.instanceId === daggerId)).toBe(true);
  });
});
