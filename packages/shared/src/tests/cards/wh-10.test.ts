/**
 * @module wh-10 — Sly Southerner
 *
 * Card: Sly Southerner (wh-10), minion-character, Ringwraith alignment.
 * Race `orc`, body 9, `discardBodyCheck: [9]`, `keywords: ["Half-orc"]`.
 *
 * Printed text: "Half-orc. Discard on a body check result of 9."
 *
 * Two rules are encoded:
 *
 * 1. "Half-orc." — A Half-orc counts as an Orc for every purpose EXCEPT the two
 *    glossary exceptions (it carries the `Half-orc` keyword to mark them):
 *      a. It may not take trophies (METW §3.IV.1.1). A Half-orc is therefore
 *         never offered as a trophy holder — engine: `reducer-combat.ts` trophy
 *         offer; a true Orc in the same situation IS offered.
 *      b. It does not by itself make its company overt. A Half-orc on its own,
 *         or accompanied only by Men/other Half-orcs, is covert; it becomes
 *         overt only when accompanied by a character that is neither a Man nor
 *         a Half-orc (glossary "overt") — engine: `reducer-utils.ts`
 *         `isCovertCompany`, observed here via "Not Slay Needlessly" (le-212),
 *         whose attack-cancel is only legal against a covert company.
 *
 * 2. "Discard on a body check result of 9." — `discardBodyCheck: [9]`. A body
 *    check roll of exactly 9 discards the character (to the discard pile, not
 *    eliminated); a roll above its body (9) eliminates it; a roll below 9
 *    leaves it wounded — engine: `reducer-combat.ts` body-check resolution.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment, CardStatus, Race } from '../../index.js';
import type { CombatState, CardInstanceId, GameState, CancelAttackAction } from '../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  dispatch, viableActions, findCharInstanceId, companyIdAt,
  makeShadowMHState, makeMHState, makeBodyCheckCombat, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';

const SLY_SOUTHERNER = 'wh-10' as CardDefinitionId;   // half-orc, body 9, discardBodyCheck [9]
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;      // true orc warrior (trophy-eligible)
const CALENDAL = 'le-4' as CardDefinitionId;          // minion elf — neither Man nor Half-orc
const LUITPRAND = 'le-23' as CardDefinitionId;         // minion man (race "man")

// Creature with kill-MP, used for the trophy-offer flow.
const ORC_GUARD = 'tw-072' as CardDefinitionId;

// Not Slay Needlessly — minion short event; cancels an Elf/Dwarf/Dúnedain/Men
// attack only against a covert company, else -2 prowess.
const NSN = 'le-212' as CardDefinitionId;
// Elf-lord Revealed in Wrath — race "elves" creature (a valid NSN target).
const ELF_LORD = 'le-69' as CardDefinitionId;

// Minion sites
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Sly Southerner (wh-10)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: discardBodyCheck [9] ─────────────────────────────────────────

  test('body check roll of exactly 9 discards (to discard pile, not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const slyId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, SLY_SOUTHERNER, CardStatus.Inverted);
    const ready = { ...wounded, phaseState: makeShadowMHState(), combat: makeBodyCheckCombat({ companyId, characterId: slyId }), cheatRollTotal: 9 };

    const [bodyCheckAction] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === slyId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === slyId)).toBe(false);
  });

  test('body check roll above body (10) eliminates to out-of-play pile', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const slyId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, SLY_SOUTHERNER, CardStatus.Inverted);
    const ready = { ...wounded, phaseState: makeShadowMHState(), combat: makeBodyCheckCombat({ companyId, characterId: slyId }), cheatRollTotal: 10 };

    const [bodyCheckAction] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === slyId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === slyId)).toBe(false);
  });

  test('body check roll below 9 (8) leaves the character in play (wounded, not discarded)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const slyId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, SLY_SOUTHERNER, CardStatus.Inverted);
    const ready = { ...wounded, phaseState: makeShadowMHState(), combat: makeBodyCheckCombat({ companyId, characterId: slyId }), cheatRollTotal: 8 };

    const [bodyCheckAction] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].characters[slyId as string]).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === slyId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === slyId)).toBe(false);
  });

  // ─── Rule 1a: Half-orc cannot take trophies ───────────────────────────────

  test('Half-orc is NOT offered a trophy after defeating a creature (combat finalizes directly)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const slyId = findCharInstanceId(base, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const creature = { instanceId: 'creature-inst' as CardInstanceId, definitionId: ORC_GUARD, status: CardStatus.Untapped };
    const stateWithCreature = {
      ...base,
      players: base.players.map((p, i) => (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [...p.cardsInPlay, creature] } : p)) as unknown as typeof base.players,
    };
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: creature.instanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 5,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: slyId, excessStrikes: 0, resolved: true, result: 'success' }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'creature',
      detainment: false,
    };
    const ready: GameState = { ...stateWithCreature, phaseState: makeShadowMHState(), combat, cheatRollTotal: 12 };

    const [bodyCheckAction] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheckAction.action);

    // No trophy-offer phase — combat resolved straight away.
    expect(after.combat).toBeNull();
    // The defeated creature is not held as a trophy by the Half-orc.
    expect(after.players[RESOURCE_PLAYER].characters[slyId as string].trophies ?? []).toHaveLength(0);
  });

  test('control: a true Orc in the same situation IS offered the trophy', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const creature = { instanceId: 'creature-inst' as CardInstanceId, definitionId: ORC_GUARD, status: CardStatus.Untapped };
    const stateWithCreature = {
      ...base,
      players: base.players.map((p, i) => (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [...p.cardsInPlay, creature] } : p)) as unknown as typeof base.players,
    };
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: creature.instanceId },
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
    const ready: GameState = { ...stateWithCreature, phaseState: makeShadowMHState(), combat, cheatRollTotal: 12 };

    const [bodyCheckAction] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheckAction.action);

    expect(after.combat?.phase).toBe('trophy-offer');
    expect(after.combat?.trophyEligibleCharacters).toContain(orcId);
  });

  // ─── Rule 1b: Half-orc and company overtness ──────────────────────────────

  test('Half-orc alone keeps the company covert (NSN can cancel an Elf-lord attack)', () => {
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
    const stateWithCreature: GameState = {
      ...base,
      players: [
        base.players[RESOURCE_PLAYER],
        { ...base.players[HAZARD_PLAYER], cardsInPlay: [...base.players[HAZARD_PLAYER].cardsInPlay, { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped }] },
      ] as unknown as typeof base.players,
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
    const cancelActions = viableActions(stateWithCreature, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Half-orc plus a Man stays covert (Men do not trigger the overt exception)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER, LUITPRAND] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const stateWithCreature: GameState = {
      ...base,
      players: [
        base.players[RESOURCE_PLAYER],
        { ...base.players[HAZARD_PLAYER], cardsInPlay: [...base.players[HAZARD_PLAYER].cardsInPlay, { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped }] },
      ] as unknown as typeof base.players,
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
    const cancelActions = viableActions(stateWithCreature, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Half-orc plus a non-Man non-Half-orc character (Elf) makes the company overt (NSN cannot cancel)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [SLY_SOUTHERNER, CALENDAL] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const stateWithCreature: GameState = {
      ...base,
      players: [
        base.players[RESOURCE_PLAYER],
        { ...base.players[HAZARD_PLAYER], cardsInPlay: [...base.players[HAZARD_PLAYER].cardsInPlay, { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped }] },
      ] as unknown as typeof base.players,
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
    const cancelActions = viableActions(stateWithCreature, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(0);
    // Overt → NSN instead offers its -2 prowess modify-attack.
    const modifyActions = viableActions(stateWithCreature, PLAYER_1, 'modify-attack');
    expect(modifyActions.length).toBeGreaterThanOrEqual(1);
  });
});
