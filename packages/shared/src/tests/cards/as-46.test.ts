/**
 * @module as-46.test
 *
 * Card test: Biter and Beater! (as-46)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Text:
 *   "Playable on a company facing an Orc attack or in combat with an overt
 *    company. Also playable during opponent's site phase. Every Sword of
 *    Gondolin, Orcrist, and Glamdring in target company give an additional
 *    +2 prowess bonus and lower the body of strikes their bearers face by 1."
 *
 * Engine Support:
 * | # | Rule                                                              | Status      |
 * |---|--------------------------------------------------------------------|-------------|
 * | 1 | Playable on a company facing an Orc attack                        | IMPLEMENTED |
 * | 2 | Playable in CvCC combat against an overt company                  | IMPLEMENTED |
 * | 3 | Not offered when the company bears none of the three named weapons | IMPLEMENTED |
 * | 4 | +2 prowess per matching borne weapon, stacking per copy            | IMPLEMENTED |
 * | 5 | Extra prowess capped at the weapon's own active printed maximum    | IMPLEMENTED |
 * | 6 | -1 to the body of strikes the bearer faces, per matching weapon    | IMPLEMENTED |
 * | 7 | Non-bearer characters in the same company are unaffected           | IMPLEMENTED |
 * | 8 | Offered regardless of whose phase is active (combat pre-empts)     | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-08-22
 *
 * Modeling notes:
 *  - Two `company-combat-boost` effects share `itemFilter` (matching Sword of
 *    Gondolin / Orcrist / Glamdring by name) and `when` (`enemy.race: "orc"`
 *    OR `enemy.overt: true`): one `stat: "prowess"` (value 2) and one
 *    `stat: "creature-body"` (value 1).
 *  - Prowess-cap tests assert on the `max` field baked into the resulting
 *    `character-stat-modifier` constraint rather than on `effectiveStats`,
 *    since a weapon's race-conditional override (e.g. Glamdring's max 9 vs
 *    Orcs) only applies in actual combat-prowess resolution, not the
 *    combat-agnostic `effectiveStats` baseline.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus,
  GIMLI, LEGOLAS,
  MORIA, LORIEN,
  findCharInstanceId, companyIdAt,
  viableActions, dispatch, executeAction,
  makeMHState,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameState } from '../../index.js';
import { Race, RegionType, SiteType } from '../../index.js';

const BITER_AND_BEATER = 'as-46' as CardDefinitionId;
const GLAMDRING = 'tw-244' as CardDefinitionId;
const ORCRIST = 'tw-295' as CardDefinitionId;
const SWORD_OF_GONDOLIN = 'tw-336' as CardDefinitionId;
const BERGIL = 'tw-129' as CardDefinitionId; // warrior, dunadan, prowess 1
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // minion, orc, makes its company overt
const GREAT_GOBLIN = 'tw-95' as CardDefinitionId; // Orc creature, body 7

const ORC_CREATURE_ID = 'orc-creature-1' as CardInstanceId;

/**
 * Hero (P1) company at Moria bearing `chars`, holding Biter and Beater!,
 * versus a minion-ish P2 company at Lórien. M/H phase.
 */
function heroState(chars: Array<CardDefinitionId | { defId: CardDefinitionId; items?: CardDefinitionId[] }>): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: chars }],
        hand: [BITER_AND_BEATER],
        siteDeck: [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [],
        siteDeck: [],
      },
    ],
  });
}

/** Attach a manually-built creature combat (Orc, with a body value) to `state`. */
function withOrcCreatureCombat(state: GameState, opts: { defenderCompanyIdx?: number } = {}): GameState {
  const companyId = companyIdAt(state, RESOURCE_PLAYER, opts.defenderCompanyIdx ?? 0);
  const withCreature = {
    ...state.players[HAZARD_PLAYER],
    cardsInPlay: [
      ...state.players[HAZARD_PLAYER].cardsInPlay,
      { instanceId: ORC_CREATURE_ID, definitionId: GREAT_GOBLIN, status: CardStatus.Untapped },
    ],
  };
  const players: typeof state.players = [state.players[RESOURCE_PLAYER], withCreature];
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: ORC_CREATURE_ID },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 3,
    creatureBody: 7,
    creatureRace: Race.Orc,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'cancel-window',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rhûn'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
  }), combat };
}

/**
 * Hero (P1) company at Moria bearing `chars`, holding Biter and Beater!,
 * versus a minion company at Lórien containing an Orc Captain (making it
 * overt) — ready to attach a manually-built CvCC combat.
 */
function heroVsOvertMinionState(chars: Array<CardDefinitionId | { defId: CardDefinitionId; items?: CardDefinitionId[] }>): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: chars }], hand: [BITER_AND_BEATER], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [] },
    ],
  });
}

/** Attach a manually-built CvCC combat (attacker overt) to `state`. */
function withCvccCombat(state: GameState): GameState {
  const attackingCompanyId = companyIdAt(state, HAZARD_PLAYER);
  const defendingCompanyId = companyIdAt(state, RESOURCE_PLAYER);
  const combat: CombatState = {
    isCvCC: true,
    attackSource: { type: 'company-attack', attackingCompanyId },
    companyId: defendingCompanyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 5,
    creatureBody: null,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'cancel-window',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, combat };
}

/** Attach a manually-built non-Orc creature combat (no body value) to `state`. */
function withNonOrcCreatureCombat(state: GameState): GameState {
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: ORC_CREATURE_ID },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 3,
    creatureBody: null,
    creatureRace: Race.Wolf,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'cancel-window',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, combat };
}

describe('Biter and Beater! (as-46)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: offered when facing an Orc attack ────────────────────────────

  test('play-short-event offered when company (bearing Glamdring) faces an Orc attack', () => {
    const state = withOrcCreatureCombat(heroState([{ defId: GIMLI, items: [GLAMDRING] }]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Rule 3: NOT offered facing a non-Orc attack, no CvCC ─────────────────

  test('NOT offered when facing a non-Orc attack outside CvCC', () => {
    const state = withNonOrcCreatureCombat(heroState([{ defId: GIMLI, items: [GLAMDRING] }]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 3: NOT offered without any of the three named weapons ───────────

  test('NOT offered when the company bears none of the three named weapons', () => {
    const state = withOrcCreatureCombat(heroState([GIMLI]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 2: offered in CvCC combat against an overt company ──────────────

  test('play-short-event offered in CvCC combat against an overt (Orc-bearing) company', () => {
    const state = withCvccCombat(heroVsOvertMinionState([{ defId: GIMLI, items: [GLAMDRING] }]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Rule 4 & 7: +2 prowess constraint added for the Glamdring bearer only ──

  test('+2 prowess constraint (attack-scoped) added for the Glamdring bearer; non-bearer untouched', () => {
    const state = withOrcCreatureCombat(heroState([{ defId: GIMLI, items: [GLAMDRING] }, LEGOLAS]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, actions[0].action);

    const gimliId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GIMLI);
    const legolasId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, LEGOLAS);

    const prowessConstraints = afterPlay.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'prowess',
    );
    expect(prowessConstraints).toHaveLength(1);
    expect(prowessConstraints[0].kind.type === 'character-stat-modifier' && prowessConstraints[0].kind.characterId).toBe(gimliId);
    expect(prowessConstraints[0].kind.type === 'character-stat-modifier' && prowessConstraints[0].kind.value).toBe(2);
    // No constraint at all targets Legolas (bears nothing).
    expect(afterPlay.activeConstraints.some(
      c => c.kind.type === 'character-stat-modifier' && c.kind.characterId === legolasId,
    )).toBe(false);
  });

  // ── Rule 5: extra prowess capped at Glamdring's own active max (9 vs Orcs) ─

  test('the +2 prowess constraint is capped at Glamdring\'s max-9-vs-Orcs when facing an Orc attack', () => {
    const state = withOrcCreatureCombat(heroState([{ defId: GIMLI, items: [GLAMDRING] }]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, actions[0].action);

    const prowessConstraint = afterPlay.activeConstraints.find(
      c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'prowess',
    );
    expect(prowessConstraint).toBeDefined();
    expect(prowessConstraint!.kind.type === 'character-stat-modifier' && prowessConstraint!.kind.max).toBe(9);
  });

  // ── Rule 5: base max (8) applies in CvCC, where Glamdring's own vs-Orc ─────
  //           override never activates (no tracked creature race)

  test('the +2 prowess constraint is capped at Glamdring\'s base max 8 in CvCC combat (no creature race tracked)', () => {
    const state = withCvccCombat(heroVsOvertMinionState([{ defId: GIMLI, items: [GLAMDRING] }]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, actions[0].action);

    const prowessConstraint = afterPlay.activeConstraints.find(
      c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'prowess',
    );
    expect(prowessConstraint).toBeDefined();
    expect(prowessConstraint!.kind.type === 'character-stat-modifier' && prowessConstraint!.kind.max).toBe(8);
  });

  // ── Rule 5: Sword of Gondolin (no vs-Orc variant) is always capped at 8 ────

  test('the +2 prowess constraint is capped at Sword of Gondolin\'s max 8 (no vs-Orc variant)', () => {
    const state = withOrcCreatureCombat(heroState([{ defId: GIMLI, items: [SWORD_OF_GONDOLIN] }]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, actions[0].action);

    const prowessConstraint = afterPlay.activeConstraints.find(
      c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'prowess',
    );
    expect(prowessConstraint).toBeDefined();
    expect(prowessConstraint!.kind.type === 'character-stat-modifier' && prowessConstraint!.kind.max).toBe(8);
  });

  // ── Rule 4: every matching weapon in the company gets its own boost ──────
  // Rule 9.15 (only one weapon "in use" per character) means two named
  // weapons stack only when borne by two *different* company members.

  test('two different bearers of two different matching weapons each receive their own prowess and creature-body constraints', () => {
    const state = withOrcCreatureCombat(heroState([
      { defId: GIMLI, items: [GLAMDRING] },
      { defId: BERGIL, items: [ORCRIST] },
    ]));
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, actions[0].action);

    const gimliId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, GIMLI);
    const bergilId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, BERGIL);

    const prowessConstraints = afterPlay.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier' && c.kind.stat === 'prowess',
    );
    expect(prowessConstraints).toHaveLength(2);
    const byCharacter = new Map(prowessConstraints.map(c => [
      c.kind.type === 'character-stat-modifier' ? c.kind.characterId : undefined,
      c.kind.type === 'character-stat-modifier' ? c.kind.max : undefined,
    ]));
    expect(byCharacter.get(gimliId)).toBe(9);  // Glamdring max 9 vs Orcs
    expect(byCharacter.get(bergilId)).toBe(10); // Orcrist max 10 vs Orcs

    const bodyConstraints = afterPlay.activeConstraints.filter(
      c => c.kind.type === 'character-creature-body-modifier',
    );
    expect(bodyConstraints).toHaveLength(2);
    const bodyTargets = bodyConstraints.map(c => c.kind.type === 'character-creature-body-modifier' && c.kind.characterId).sort();
    expect(bodyTargets).toEqual([gimliId, bergilId].sort());
    for (const c of bodyConstraints) {
      expect(c.kind.type === 'character-creature-body-modifier' && c.kind.value).toBe(1);
    }
  });

  // ── Rule 6: creature-body reduction defeats a strike that would otherwise survive ──

  test('creature-body reduction (via constraint) turns a surviving body check into a defeat', () => {
    const state = withOrcCreatureCombat(heroState([{ defId: GIMLI, items: [GLAMDRING] }]));
    const bearerId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(state, actions[0].action);

    // Reuse the real constraints just created; drive the same combat into
    // resolve-strike so the character wins the strike and faces a creature
    // body check.
    const resolveStrikeCombat: CombatState = {
      ...afterPlay.combat!,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      strikeAssignments: [{ characterId: bearerId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      bodyCheckTarget: null,
    };
    const atResolveStrike = { ...afterPlay, combat: resolveStrikeCombat };

    // Gimli's boosted combat prowess trounces the creature's prowess 3, so a
    // low forced roll is enough to win the strike outright.
    const afterStrike = executeAction(atResolveStrike, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');

    // Unreduced body is 7: a roll of 7 would NOT exceed it (survives).
    // With the -1 constraint, effective body is 6: 7 > 6 → the creature is defeated.
    const after = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 7);
    expect(after.combat).toBeNull(); // single-strike attack finalizes combat
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === ORC_CREATURE_ID)).toBe(true);
  });

  test('WITHOUT Biter and Beater!, the same roll leaves the creature alive (control)', () => {
    const state = withOrcCreatureCombat(heroState([GIMLI])); // no weapon, card never played
    const bearerId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const resolveStrikeCombat: CombatState = {
      ...state.combat!,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      strikeAssignments: [{ characterId: bearerId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      bodyCheckTarget: null,
    };
    const atResolveStrike = { ...state, combat: resolveStrikeCombat };

    const afterStrike = executeAction(atResolveStrike, PLAYER_1, 'resolve-strike', 8, true);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');

    const after = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 7);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === ORC_CREATURE_ID)).toBe(false);
  });

  // ── Rule 8: offered regardless of whose phase is active ──────────────────

  test('offered to the defender even while the opponent is the active player', () => {
    let state = withOrcCreatureCombat(heroState([{ defId: GIMLI, items: [GLAMDRING] }]));
    state = { ...state, activePlayer: PLAYER_2 };
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });
});
