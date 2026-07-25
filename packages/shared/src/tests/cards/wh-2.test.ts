/**
 * @module wh-2.test
 *
 * Card test: Doeth (Durthak) (wh-2)
 * Type: minion-character (Ringwraith alignment)
 *
 * "Unique. Half-orc. Discard on a body check result of 9."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race: orc, keywords: ["half-orc"], body 9, prowess 4, mind 4, skills
 *   warrior/sage, discardBodyCheck [9]. Unique. Homesite "Any Dark-hold".
 *
 * Engine Support:
 * | # | Rule (card text)                       | Status | Notes                                              |
 * |---|----------------------------------------|--------|----------------------------------------------------|
 * | 1 | "Unique."                              | OK     | play-character gate: uniqueAlreadyInPlay           |
 * | 2 | "Half-orc." → does NOT make company    | OK     | isCovertCompany skips Half-orc (CRF-22 ruling);    |
 * |   |   overt                                |        | exercised via Not Slay Needlessly (covert cancel)  |
 * | 3 | "Half-orc." → cannot take trophies     | OK     | trophy-offer excludes Half-orc (CoE 3.IV.1.1)      |
 * | 4 | "Discard on a body check result of 9." | OK     | discardBodyCheck [9]; combat body check (rule 8.31)|
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. A second copy of the unique Doeth cannot be organised into play while
 *    one is already in play — the play-character action is offered but blocked
 *    with a uniqueness reason.
 * 2. A company whose only character is the (Half-orc) Doeth is COVERT — Not
 *    Slay Needlessly can cancel an attack against it (only covert companies
 *    are eligible for the cancel).
 * 3. The Half-orc is NOT offered a defeated creature as a trophy — combat
 *    finalizes directly (plain-Orc control lives in wh-5.test).
 * 4. discardBodyCheck [9]: a combat body-check roll of exactly 9 sends Doeth
 *    to the discard pile (not eliminated); a roll of 10 eliminates him.
 *
 * Fixtures:
 *   DOETH (wh-2)        — unique minion Half-orc warrior/sage, body 9, discardBodyCheck [9]
 *   NSN (le-212)        — Not Slay Needlessly: cancels vs covert, -2 prowess vs overt
 *   ELF_LORD (le-69)    — "elves" creature (NSN cancel-window target)
 *   ORC_GUARD (tw-072)  — creature with killMarshallingPoints 1 (trophy source)
 *   CARN_DUM (le-359)   — minion ruins-and-lairs (company site)
 *   MINAS_MORGUL (le-390) — minion haven (siteDeck filler)
 *   DOL_GULDUR (le-367) — minion haven (opponent site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  findCharInstanceId, handCardId, companyIdAt, dispatch, viableActions,
  makeBodyCheckCombat, makeShadowMHState, makeMHState, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, CombatState, CancelAttackAction,
} from '../../index.js';

const DOETH = 'wh-2' as CardDefinitionId;
const NSN = 'le-212' as CardDefinitionId;        // Not Slay Needlessly
const ELF_LORD = 'le-69' as CardDefinitionId;    // "elves" creature
const ORC_GUARD = 'tw-072' as CardDefinitionId;  // creature, killMarshallingPoints 1

const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Doeth (Durthak) (wh-2)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: "Unique." — only one copy may be in play ───────────────────────

  test('a second copy of Doeth cannot be organised into play while one is already in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DOETH] }], hand: [DOETH], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const dupId = handCardId(state, RESOURCE_PLAYER);
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.action.type === 'play-character'
        && a.action.characterInstanceId === dupId);

    // The second copy is offered but blocked — and specifically because the
    // unique Doeth is already in play (not for some unrelated reason).
    expect(playActions.length).toBeGreaterThanOrEqual(1);
    expect(playActions.every(a => !a.viable)).toBe(true);
    expect(playActions.some(a => /unique/i.test(a.reason ?? ''))).toBe(true);
  });

  // ── Rule 2: "Half-orc." — does NOT make its company overt ──────────────────
  // Not Slay Needlessly can only cancel an attack against a COVERT company.

  test('Half-orc company stays covert — Not Slay Needlessly can cancel the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [DOETH] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
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
        creatureRace: 'elves',
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

  // ── Rule 3: "Half-orc." — may NOT take trophies (CoE 3.IV.1.1) ─────────────

  test('Half-orc that defeats a creature is NOT offered it as a trophy — combat finalizes', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [DOETH] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const doethId = findCharInstanceId(base, RESOURCE_PLAYER, DOETH);
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
      creatureRace: 'orc',
      strikeAssignments: [{ characterId: doethId, excessStrikes: 0, resolved: true, result: 'success' }],
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

  // ── Rule 4: "Discard on a body check result of 9." (discardBodyCheck [9]) ───

  test('Body check roll of exactly 9 discards the Half-orc (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [DOETH] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const doethId = findCharInstanceId(state, RESOURCE_PLAYER, DOETH);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, DOETH, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: doethId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === doethId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === doethId)).toBe(false);
  });

  test('Body check roll above 9 eliminates the Half-orc', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [DOETH] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const doethId = findCharInstanceId(state, RESOURCE_PLAYER, DOETH);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, DOETH, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: doethId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === doethId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === doethId)).toBe(false);
  });
});
