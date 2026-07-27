/**
 * @module wh-10.test
 *
 * Card test: Sly Southerner (wh-10)
 * Type: minion-character (Ringwraith alignment)
 *
 * "Half-orc. Discard on a body check result of 9."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race: orc, keywords: ["half-orc"], body 9, prowess 1, mind 2, skills
 *   warrior/scout, discardBodyCheck [9]. Non-unique. Homesite "Any Dark-hold".
 *
 * Engine Support:
 * | # | Rule (card text)                       | Status | Notes                                              |
 * |---|----------------------------------------|--------|----------------------------------------------------|
 * | 1 | "Half-orc." → does NOT make company    | OK     | isCovertCompany skips Half-orc (CRF-22 ruling);    |
 * |   |   overt                                |        | exercised via Not Slay Needlessly (covert cancel)  |
 * | 2 | "Half-orc." → cannot take trophies     | OK     | trophy-offer excludes Half-orc (CoE 3.IV.1.1)      |
 * | 3 | "Discard on a body check result of 9." | OK     | discardBodyCheck [9]; combat body check (rule 8.31)|
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. A company whose only character is the (Half-orc) Sly Southerner is COVERT
 *    — Not Slay Needlessly can cancel an attack against it. Control: a plain Orc
 *    (Gorbag) in the same slot makes the company overt, so NSN only gives -2
 *    prowess and cannot cancel.
 * 2. The Half-orc is NOT offered the defeated creature as a trophy — combat
 *    finalizes directly. Control: a plain Orc (Gorbag) is trophy-eligible.
 * 3. discardBodyCheck [9]: a combat body-check roll of exactly 9 sends the
 *    Half-orc to the discard pile (not eliminated); a roll of 10 eliminates it.
 *
 * Fixtures:
 *   SLY_SOUTHERNER (wh-10)     — minion Half-orc warrior/scout, body 9, discardBodyCheck [9]
 *   GORBAG (le-11)             — plain minion Orc, body 9, discardBodyCheck [9] (overt/trophy control)
 *   NSN (le-212)               — Not Slay Needlessly: cancels vs covert, -2 prowess vs overt
 *   ELF_LORD (le-69)           — "elf" creature (NSN cancel-window target)
 *   ORC_GUARD (tw-072)         — creature with killMarshallingPoints 1 (trophy source)
 *   CARN_DUM (le-359)          — minion ruins-and-lairs (company site)
 *   MINAS_MORGUL (le-390)      — minion haven (siteDeck filler / opponent site)
 *   DOL_GULDUR (le-367)        — minion haven (opponent site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  findCharInstanceId, companyIdAt, dispatch, viableActions,
  makeBodyCheckCombat, makeShadowMHState, makeMHState, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER, CardStatus,
} from '../test-helpers.js';
import { Phase, Alignment, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, CombatState, CancelAttackAction,
} from '../../index.js';

const SLY_SOUTHERNER = 'wh-10' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;      // plain Orc, body 9, discardBodyCheck [9]
const NSN = 'le-212' as CardDefinitionId;        // Not Slay Needlessly
const ELF_LORD = 'le-69' as CardDefinitionId;    // "elf" creature
const ORC_GUARD = 'tw-072' as CardDefinitionId;  // creature, killMarshallingPoints 1

const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Sly Southerner (wh-10)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: "Half-orc." — does NOT make its company overt ──────────────────
  // Not Slay Needlessly can only cancel an attack against a COVERT company.

  test('Half-orc company stays covert — Not Slay Needlessly can cancel the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped },
      ],
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeMHState(),
      combat: {
        attackSource: { type: 'creature', instanceId: creatureInstanceId },
        companyId: companyIdAt(base, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 15,
        creatureBody: null,
        creatureRace: Race.Elf,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      },
    };

    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(1);
  });

  test('Control: a plain Orc in the company makes it overt — NSN cannot cancel (only modifies)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [GORBAG] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped },
      ],
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeMHState(),
      combat: {
        attackSource: { type: 'creature', instanceId: creatureInstanceId },
        companyId: companyIdAt(base, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 15,
        creatureBody: null,
        creatureRace: Race.Elf,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      },
    };

    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(0);
    const modifyActions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(modifyActions.length).toBeGreaterThanOrEqual(1);
  });

  // ── Rule 2: "Half-orc." — may NOT take trophies (CoE 3.IV.1.1) ─────────────

  test('Half-orc that defeats a creature is NOT offered it as a trophy — combat finalizes', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const halfOrcId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const creatureInstanceId = 'creature-orcguard-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ORC_GUARD, status: CardStatus.Untapped },
      ],
    };
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: creatureInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 5,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: halfOrcId, excessStrikes: 0, resolved: true, result: 'success' }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'creature',
      detainment: false,
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeShadowMHState(),
      combat,
      cheatRollTotal: 12, // 12 > creatureBody 5 → creature defeated
    };

    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);

    // No trophy offer for a Half-orc — combat resolves straight through.
    expect(after.combat).toBeNull();
  });

  test('Control: a plain Orc that defeats the same creature IS offered the trophy', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const creatureInstanceId = 'creature-orcguard-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ORC_GUARD, status: CardStatus.Untapped },
      ],
    };
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: creatureInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 5,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: orcId, excessStrikes: 0, resolved: true, result: 'success' }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'creature',
      detainment: false,
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeShadowMHState(),
      combat,
      cheatRollTotal: 12,
    };

    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);

    expect(after.combat?.phase).toBe('trophy-offer');
    expect(after.combat?.trophyEligibleCharacters).toContain(orcId);
  });

  // ── Rule 3: "Discard on a body check result of 9." (discardBodyCheck [9]) ───

  test('Body check roll of exactly 9 discards the Half-orc (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const fellowId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, SLY_SOUTHERNER, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: fellowId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === fellowId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === fellowId)).toBe(false);
  });

  test('Body check roll above 9 eliminates the Half-orc', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const fellowId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, SLY_SOUTHERNER, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: fellowId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === fellowId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === fellowId)).toBe(false);
  });
});
