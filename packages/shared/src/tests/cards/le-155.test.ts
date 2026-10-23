/**
 * @module le-155.test
 *
 * Card test: “Two-headed” Troll (le-155)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 * Stats: prowess 5, body 8, mind 2, 1 MP (ally), non-unique
 *
 * Card text:
 *   "Playable at any tapped or untapped Ruins & Lairs [{R}] with a Troll
 *    automatic-attack. Its controlling character's company is overt. Tap to
 *    cancel an Orc or Troll attack against his company. Cannot be duplicated
 *    in a given company."
 *
 * Effects:
 *   1. play-flag: playable-at-tapped-site — playable at a tapped site too
 *   2. company-overt — controlling character's company is overt
 *   3. cancel-attack — `cost: { "tap": "self" }`, `enemy.race` $in [orc, troll]
 *   4. duplication-limit — scope "company", max 1
 *   + playableAt: [{ siteType: "ruins-and-lairs", when: Troll auto-attack }]
 *
 * | # | Rule                                                    | Status | Notes                                         |
 * |---|---------------------------------------------------------|--------|-----------------------------------------------|
 * | 1 | Playable at tapped/untapped R&L with Troll auto-attack   | OK     | playableAt + site.autoAttack.race + play-flag |
 * | 2 | Company is overt                                         | OK     | company-overt (reducer-utils isCovertCompany) |
 * | 3 | Tap to cancel an Orc or Troll attack against his company | OK     | cancel-attack tap-self, enemy.race gate       |
 * | 4 | Cannot be duplicated in a given company                  | OK     | duplication-limit scope=company               |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, type BuildTestStateOpts, resetMint,
  findCharInstanceId, attachAllyToChar, setAllyStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, viableActionsForHandCard, dispatch,
  makeCancelWindowCombat, expectInDiscardPile,
} from '../test-helpers.js';
import { Phase, CardStatus, Race } from '../../index.js';
import type { CardDefinitionId, CancelAttackAction } from '../../index.js';

const TWO_HEADED_TROLL = 'le-155' as CardDefinitionId;

// Minion characters — men, no Orc/Troll race, so the company is covert by default.
const ASTERNAK = 'le-1' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;

// Minion sites
const ETTENMOORS = 'le-373' as CardDefinitionId;   // ruins-and-lairs, Trolls auto-attack
const BUHR_WIDU = 'le-357' as CardDefinitionId;    // ruins-and-lairs, Trolls auto-attack
const WHITE_TOWERS = 'le-412' as CardDefinitionId; // ruins-and-lairs, Wolves auto-attack (no Troll)
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold

// Hazard creatures
const ORC_PATROL = 'tw-074' as CardDefinitionId; // race "orc"
const BERT = 'tw-016' as CardDefinitionId;       // race "troll"
const CAVE_DRAKE = 'tw-082' as CardDefinitionId; // race "drake" (control)
const ELF_LORD = 'le-69' as CardDefinitionId;    // race "elf" (for overt/covert check)

// Not Slay Needlessly — cancels an attack vs a covert company, -2 prowess vs overt.
const NSN = 'le-212' as CardDefinitionId;

/** Movement/hazard fixture: P1's lone Asternak company at Moria. */
const MH_OPTS: BuildTestStateOpts = {
  activePlayer: PLAYER_1,
  phase: Phase.MovementHazard,
  recompute: true,
  players: [
    { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
    { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
  ],
};

/** Same fixture with Not Slay Needlessly in P1's hand. */
const MH_OPTS_NSN: BuildTestStateOpts = { ...MH_OPTS, players: [{ ...MH_OPTS.players[0], hand: [NSN] }, MH_OPTS.players[1]] };

describe('“Two-headed” Troll (le-155)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at a tapped or untapped R&L with a Troll auto-attack ──

  test('IS playable at an untapped Ruins & Lairs with a Troll automatic-attack', () => {
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: ETTENMOORS, hand: [TWO_HEADED_TROLL] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWO_HEADED_TROLL).length)
      .toBeGreaterThanOrEqual(1);
  });

  test('IS playable at a TAPPED Ruins & Lairs with a Troll automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK], site: BUHR_WIDU, hand: [TWO_HEADED_TROLL], siteStatus: CardStatus.Tapped,
    });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWO_HEADED_TROLL).length)
      .toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Ruins & Lairs without a Troll automatic-attack', () => {
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: WHITE_TOWERS, hand: [TWO_HEADED_TROLL] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWO_HEADED_TROLL))
      .toHaveLength(0);
  });

  test('NOT playable at a non-Ruins-and-Lairs site', () => {
    const state = buildSitePhaseState({ characters: [ASTERNAK], site: MORIA_MINION, hand: [TWO_HEADED_TROLL] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWO_HEADED_TROLL))
      .toHaveLength(0);
  });

  // ─── Rule 2: its controlling character's company is overt ─────────────────

  test('company with the Troll is overt: Not Slay Needlessly cannot cancel, only modifies', () => {
    const withAlly = attachAllyToChar(buildTestState(MH_OPTS_NSN), RESOURCE_PLAYER, ASTERNAK, TWO_HEADED_TROLL);
    const combatState = makeCancelWindowCombat(withAlly, { creatureDefId: ELF_LORD, creatureRace: Race.Elf });
    expect(viableActionsForHandCard(combatState, PLAYER_1, 'cancel-attack', RESOURCE_PLAYER, NSN)).toHaveLength(0);
    expect(viableActions(combatState, PLAYER_1, 'modify-attack').length).toBeGreaterThanOrEqual(1);
  });

  test('same company without the Troll is covert: Not Slay Needlessly can cancel', () => {
    const combatState = makeCancelWindowCombat(buildTestState(MH_OPTS_NSN), { creatureDefId: ELF_LORD, creatureRace: Race.Elf });
    expect(viableActionsForHandCard(combatState, PLAYER_1, 'cancel-attack', RESOURCE_PLAYER, NSN).length)
      .toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 3: tap to cancel an Orc or Troll attack against his company ─────

  test('tap-to-cancel is available against an Orc attack', () => {
    const withAlly = attachAllyToChar(buildTestState(MH_OPTS), RESOURCE_PLAYER, ASTERNAK, TWO_HEADED_TROLL);
    const combatState = makeCancelWindowCombat(withAlly, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc });
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const ally = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)].allies[0];
    expect((cancelActions[0].action as CancelAttackAction).cardInstanceId).toBe(ally.instanceId);
  });

  test('tap-to-cancel is available against a Troll attack', () => {
    const withAlly = attachAllyToChar(buildTestState(MH_OPTS), RESOURCE_PLAYER, ASTERNAK, TWO_HEADED_TROLL);
    const combatState = makeCancelWindowCombat(withAlly, { creatureDefId: BERT, creatureRace: Race.Troll });
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('tap-to-cancel is NOT available against a non-Orc/Troll attack', () => {
    const withAlly = attachAllyToChar(buildTestState(MH_OPTS), RESOURCE_PLAYER, ASTERNAK, TWO_HEADED_TROLL);
    const combatState = makeCancelWindowCombat(withAlly, { creatureDefId: CAVE_DRAKE, creatureRace: Race.Drake });
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('tap-to-cancel is NOT available when the Troll is already tapped', () => {
    const withAlly = attachAllyToChar(buildTestState(MH_OPTS), RESOURCE_PLAYER, ASTERNAK, TWO_HEADED_TROLL);
    const tapped = setAllyStatus(withAlly, RESOURCE_PLAYER, ASTERNAK, TWO_HEADED_TROLL, CardStatus.Tapped);
    const combatState = makeCancelWindowCombat(tapped, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc });
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('executing tap-to-cancel taps the Troll, ends combat and discards the creature', () => {
    const withAlly = attachAllyToChar(buildTestState(MH_OPTS), RESOURCE_PLAYER, ASTERNAK, TWO_HEADED_TROLL);
    const combatState = makeCancelWindowCombat(withAlly, { creatureDefId: BERT, creatureRace: Race.Troll });
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);

    const after = dispatch(combatState, cancelActions[0].action);
    expect(after.combat).toBeNull();
    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    expect(after.players[RESOURCE_PLAYER].characters[charId].allies[0].status).toBe(CardStatus.Tapped);
    expectInDiscardPile(after, HAZARD_PLAYER, BERT);
  });

  // ─── Rule 4: cannot be duplicated in a given company ──────────────────────

  test('a second copy is NOT playable in a company where another character already has one', () => {
    const base = buildSitePhaseState({
      characters: [ASTERNAK, LUITPRAND], site: ETTENMOORS, hand: [TWO_HEADED_TROLL],
    });
    expect(viableActionsForHandCard(base, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWO_HEADED_TROLL).length)
      .toBeGreaterThanOrEqual(1);
    const withFirst = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, TWO_HEADED_TROLL);
    expect(viableActionsForHandCard(withFirst, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWO_HEADED_TROLL))
      .toHaveLength(0);
  });
});
