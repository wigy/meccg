/**
 * @module td-14.test
 *
 * Card test: Dragon's Blood (td-14)
 * Type: hazard-event (short)
 *
 * Card text: "Playable on a character facing a Dragon or Drake strike (before
 * the dice are rolled to resolve the strike). If the strike fails, the
 * target character must make a body check modified by -1 if he has armor,
 * by -1 if he has a shield, and by -1 if he has a helmet. Cannot be
 * duplicated on a given character."
 *
 * Engine Support:
 * | # | Rule                                              | Status      | Notes                                    |
 * |---|----------------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Playable on a character facing a Dragon or Drake   | IMPLEMENTED | play-window combat/resolve-strike +       |
 * |   | strike, before the dice are rolled                 |             | play-target character filter attack.race  |
 * |   |                                                     |             | $in [dragon, drake].                      |
 * | 2 | If the strike fails, the target character must     | IMPLEMENTED | on-event self-enters-play-combat ->       |
 * |   | make an additional body check                      |             | force-body-check-on-strike-failure;       |
 * |   |                                                     |             | resolveStrikeCore / handleBodyCheckRoll   |
 * |   |                                                     |             | (combat-strike.ts, combat-actions.ts).    |
 * | 3 | Check modified by -1 each for armor/shield/helmet  | IMPLEMENTED | itemModifiers keyword scan (possession,   |
 * |   | the character has                                  |             | not "in use" status) at strike resolution.|
 * | 4 | Cannot be duplicated on a given character           | IMPLEMENTED | duplication-limit scope:character, tracked|
 * |   |                                                     |             | via an attack-scoped attack-card-played   |
 * |   |                                                     |             | constraint (the card discards immediately |
 * |   |                                                     |             | rather than attaching).                   |
 *
 * The card never attaches — it resolves and discards immediately like other
 * combat-reactive short events (Words of Power and Terror tw-115, Fury of the
 * Iron Crown tw-492).
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachItemToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  companyIdAt, findCharInstanceId, dispatch, viableActions,
  expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameAction, GameState, PlayHazardAction } from '../../index.js';
import { Race } from '../../index.js';

const DRAGONS_BLOOD = 'td-14' as CardDefinitionId;
const HAUBERK = 'tw-254' as CardDefinitionId; // armor
const GREAT_SHIELD = 'tw-250' as CardDefinitionId; // shield
const ADAMANT_HELMET = 'td-96' as CardDefinitionId; // helmet

/**
 * Build a resolve-strike combat state for a Dragon (or Drake) attack against
 * `defender`, with `bloodCopies` copies of Dragon's Blood in the hazard
 * player's hand. Single strike, `assignmentPhase: 'done'` — mirrors Dragon's
 * Curse's (td-16) test scaffolding for the same combat play-window.
 */
function makeDragonsBloodState(opts: {
  defender: CardDefinitionId;
  creatureRace?: Race;
  strikeProwess?: number;
  creatureBody?: number | null;
  bloodCopies?: number;
}): { state: GameState; defenderId: CardInstanceId } {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [opts.defender] }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: Array(opts.bloodCopies ?? 1).fill(DRAGONS_BLOOD),
        siteDeck: [RIVENDELL],
      },
    ],
  });
  const defenderId = findCharInstanceId(base, RESOURCE_PLAYER, opts.defender);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'synthetic-dragon' as CardInstanceId },
    companyId: companyIdAt(base, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess ?? 2,
    creatureBody: opts.creatureBody === undefined ? null : opts.creatureBody,
    creatureRace: opts.creatureRace ?? Race.Dragon,
    strikeAssignments: [{ characterId: defenderId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { state: { ...base, combat }, defenderId };
}

/** Play Dragon's Blood onto `defenderId`, then close the attacker's Step-1 window. */
function playDragonsBlood(state: GameState, defenderId: CardInstanceId): GameState {
  const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
  const play = plays.find(p => p.action.targetCharacterId === defenderId);
  expect(play).toBeDefined();
  const afterPlay = dispatch(state, play!.action);
  return dispatch(afterPlay, { type: 'pass', player: PLAYER_2 });
}

/** Resolve the current strike with a rigged 2d6 total. */
function resolveStrike(state: GameState, tapToFight: boolean, rollTotal: number): GameState {
  const actions = viableActions(state, PLAYER_1, 'resolve-strike') as { action: { tapToFight: boolean } }[];
  const action = actions.find(a => a.action.tapToFight === tapToFight);
  expect(action).toBeDefined();
  return dispatch({ ...state, cheatRollTotal: rollTotal }, action!.action as unknown as GameAction);
}

/** Roll the pending body check with a rigged 2d6 total (either target). */
function rollBodyCheck(state: GameState, rollTotal: number): GameState {
  const fromAttacker = viableActions(state, PLAYER_2, 'body-check-roll');
  const fromDefender = viableActions(state, PLAYER_1, 'body-check-roll');
  const actions = fromAttacker.length > 0 ? fromAttacker : fromDefender;
  expect(actions).toHaveLength(1);
  return dispatch({ ...state, cheatRollTotal: rollTotal }, actions[0].action as unknown as GameAction);
}

describe("Dragon's Blood (td-14)", () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: play-window, race gating ──────────────────────────────────

  test('offered on a character facing a Dragon strike', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, creatureRace: Race.Dragon });
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.filter(p => p.action.targetCharacterId === defenderId)).toHaveLength(1);
  });

  test('offered on a character facing a Drake strike', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, creatureRace: Race.Drake });
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.filter(p => p.action.targetCharacterId === defenderId)).toHaveLength(1);
  });

  test('NOT offered when the attacking creature is neither Dragon nor Drake', () => {
    const { state } = makeDragonsBloodState({ defender: ARAGORN, creatureRace: Race.Orc });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT offered outside a combat resolve-strike window (e.g. plain M/H phase)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DRAGONS_BLOOD], siteDeck: [RIVENDELL] },
      ],
    });
    expect(viableActions(base, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Combat-reactive short event: resolves and discards, never attaches ───

  test('playing Dragon\'s Blood discards it immediately (never attaches to the target)', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN });
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const next = dispatch(state, plays[0].action);

    expect(next.players[RESOURCE_PLAYER].characters[defenderId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, DRAGONS_BLOOD);
    expect(next.players[HAZARD_PLAYER].hand).toHaveLength(0);
  });

  // ─── Rule 4: duplication limit ─────────────────────────────────────────

  test('NOT offered again on the same character in the same attack (duplication-limit)', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, bloodCopies: 2 });
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(2); // two copies in hand, both currently offered

    const afterFirst = dispatch(state, plays[0].action);
    expect(viableActions(afterFirst, PLAYER_2, 'play-hazard').filter(
      p => (p.action as PlayHazardAction).targetCharacterId === defenderId,
    )).toHaveLength(0);
  });

  // ─── Rules 2 & 3: forced body check on strike failure, item modifiers ──

  test('strike defeated (no creature body): forces a body check on the character instead of finalizing', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, strikeProwess: 2, creatureBody: null });
    const withBlood = playDragonsBlood(state, defenderId);

    // Aragorn (prowess 6) taps, rolls 5: 5+6=11 > strikeProwess 2 — strike defeated.
    const afterStrike = resolveStrike(withBlood, true, 5);

    expect(afterStrike.combat).not.toBeNull();
    expect(afterStrike.combat!.phase).toBe('body-check');
    expect(afterStrike.combat!.bodyCheckTarget).toBe('character');
    // No creature body to check against — the pending check is Dragon's Blood's, not a normal one.
    expect(afterStrike.combat!.strikeAssignments[0].forcedBodyCheckModifier).toBe(0);
  });

  test('forced check modifier accumulates -1 per armor/shield/helmet borne', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, strikeProwess: 2, creatureBody: null });
    const withArmor = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, HAUBERK);
    const withAll = attachItemToChar(
      attachItemToChar(withArmor, RESOURCE_PLAYER, ARAGORN, GREAT_SHIELD),
      RESOURCE_PLAYER, ARAGORN, ADAMANT_HELMET,
    );
    const withBlood = playDragonsBlood(withAll, defenderId);
    const afterStrike = resolveStrike(withBlood, true, 5);

    expect(afterStrike.combat!.strikeAssignments[0].forcedBodyCheckModifier).toBe(-3);
  });

  test('no items borne: forced check modifier is 0, and a high roll eliminates the character', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, strikeProwess: 2, creatureBody: null });
    const withBlood = playDragonsBlood(state, defenderId);
    const afterStrike = resolveStrike(withBlood, true, 5);

    const afterBodyCheck = rollBodyCheck(afterStrike, 12); // 12 > body 9 — eliminated
    expect(afterBodyCheck.combat).toBeNull();
    expect(afterBodyCheck.players[RESOURCE_PLAYER].characters[defenderId]).toBeUndefined();
    expect(afterBodyCheck.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.definitionId === ARAGORN)).toBe(true);
  });

  test('armor + shield + helmet (-3 modifier) saves the character from the same roll', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, strikeProwess: 2, creatureBody: null });
    const withArmor = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, HAUBERK);
    const withAll = attachItemToChar(
      attachItemToChar(withArmor, RESOURCE_PLAYER, ARAGORN, GREAT_SHIELD),
      RESOURCE_PLAYER, ARAGORN, ADAMANT_HELMET,
    );
    const withBlood = playDragonsBlood(withAll, defenderId);
    const afterStrike = resolveStrike(withBlood, true, 5);

    // 12 - 3 (armor/shield/helmet) = 9, not > body 9 — survives.
    const afterBodyCheck = rollBodyCheck(afterStrike, 12);
    expect(afterBodyCheck.combat).toBeNull();
    expect(afterBodyCheck.players[RESOURCE_PLAYER].characters[defenderId]).toBeDefined();
  });

  test('a genuine wound (strike succeeds against the defender) is unaffected by Dragon\'s Blood', () => {
    // strikeProwess high enough that Aragorn's roll cannot beat it — a real wound,
    // not a "failed strike"; the forced-check modifier must stay unset even
    // though Dragon's Blood was played and the character bears full armor.
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, strikeProwess: 15, creatureBody: null });
    const withArmor = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, HAUBERK);
    const withAll = attachItemToChar(
      attachItemToChar(withArmor, RESOURCE_PLAYER, ARAGORN, GREAT_SHIELD),
      RESOURCE_PLAYER, ARAGORN, ADAMANT_HELMET,
    );
    const withBlood = playDragonsBlood(withAll, defenderId);

    // Aragorn taps, rolls 2: 2+6=8 < strikeProwess 15 — wounded (a real wound).
    const afterStrike = resolveStrike(withBlood, true, 2);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('character');
    expect(afterStrike.combat!.strikeAssignments[0].forcedBodyCheckModifier).toBeUndefined();

    // Body check roll 10 would survive if the -3 item modifier applied
    // (10-3=7, not > 9); it must NOT apply here, so 10 > body 9 eliminates.
    const afterBodyCheck = rollBodyCheck(afterStrike, 10);
    expect(afterBodyCheck.combat).toBeNull();
    expect(afterBodyCheck.players[RESOURCE_PLAYER].characters[defenderId]).toBeUndefined();
  });

  test('creature body check chains into the forced character check afterward', () => {
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, strikeProwess: 2, creatureBody: 2 });
    const withBlood = playDragonsBlood(state, defenderId);

    // Aragorn defeats the strike; the creature has body, so a creature body
    // check comes first (bodyCheckTarget stays 'creature', not overridden).
    const afterStrike = resolveStrike(withBlood, true, 5);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');

    // Creature check: roll 1 (effective 1, not > body 2) — creature survives.
    const afterCreatureCheck = rollBodyCheck(afterStrike, 1);
    expect(afterCreatureCheck.combat).not.toBeNull();
    expect(afterCreatureCheck.combat!.phase).toBe('body-check');
    expect(afterCreatureCheck.combat!.bodyCheckTarget).toBe('character');

    // Chained forced character check: roll 12 (no items) > body 9 — eliminated.
    const afterCharCheck = rollBodyCheck(afterCreatureCheck, 12);
    expect(afterCharCheck.combat).toBeNull();
    expect(afterCharCheck.players[RESOURCE_PLAYER].characters[defenderId]).toBeUndefined();
  });

  test('a tie (strike ineffectual) still counts as "failed" and forces the check', () => {
    // Aragorn taps, rolls 2: 2+6=8, exactly matching strikeProwess 8 — a tie
    // ("ineffectual", CoE 3.iv.7). The strike is not defeated, but Aragorn was
    // not wounded either — Dragon's Blood still forces the check.
    const { state, defenderId } = makeDragonsBloodState({ defender: ARAGORN, strikeProwess: 8, creatureBody: null });
    const withBlood = playDragonsBlood(state, defenderId);
    const afterStrike = resolveStrike(withBlood, true, 2);

    expect(afterStrike.combat!.strikeAssignments[0].result).toBe('tie');
    expect(afterStrike.combat!.phase).toBe('body-check');
    expect(afterStrike.combat!.bodyCheckTarget).toBe('character');
    expect(afterStrike.combat!.strikeAssignments[0].forcedBodyCheckModifier).toBe(0);
  });
});
