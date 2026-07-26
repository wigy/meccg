/**
 * @module as-74.test
 *
 * Card test: Great Bats (as-74)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 *
 * Card text:
 *   "Playable at a tapped or untapped Shadow-hold [{S}].
 *    Its controlling character's company is overt.
 *    May not be attacked.
 *    Discard this ally if its controlling character is wounded.
 *    Tap this ally to remove the effect of an attack against its
 *    controlling character's company that states: "attacker chooses
 *    defending characters."
 *    Cannot be duplicated in a given company."
 *
 * Effects:
 *   1. play-target: site (siteType shadow-hold), requireTapped:false
 *   2. play-flag: no-attack — ally may not be assigned strikes
 *   3. company-overt — controlling character's company is overt
 *   4. on-event: bearer-wounded → discard-self
 *   5. modify-attack: cost tap:self, removeAttackerChoosesDefenders:true
 *   6. duplication-limit: scope=company, max=1
 *
 * | # | Rule                                                  | Status | Notes                                            |
 * |---|-------------------------------------------------------|--------|--------------------------------------------------|
 * | 1 | Playable at Shadow-hold (tapped or untapped)          | OK     | play-target site filter + requireTapped:false    |
 * | 2 | May not be attacked                                   | OK     | play-flag: no-attack in combat.ts                |
 * | 3 | Company is overt                                      | OK     | company-overt via reducer-utils isCovertCompany  |
 * | 4 | Discard when bearer is wounded                        | OK     | on-event bearer-wounded → discard-self           |
 * | 5 | Tap to remove "attacker chooses defending characters" | OK     | modify-attack removeAttackerChoosesDefenders     |
 * | 6 | Cannot be duplicated in a given company               | OK     | duplication-limit scope=company in site.ts       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, attachAllyToChar,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, dispatch, makeCancelWindowCombat,
  expectInDiscardPile, executeAction,
  type BuildTestStateOpts,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type { CardDefinitionId, CancelAttackAction, ModifyAttackAction, PlayHeroResourceAction, GameState } from '../../index.js';

const GREAT_BATS = 'as-74' as CardDefinitionId;

// Minion characters (LE pool — ringwraith alignment, no inherent effects)
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, prowess 5, body 7, mind 5
const LUITPRAND = 'le-23' as CardDefinitionId; // man, prowess 3, body 7, mind 1

// Minion sites
const MORIA_MINION = 'le-392' as CardDefinitionId;  // minion shadow-hold
const DIMRILL_DALE = 'le-365' as CardDefinitionId;  // minion ruins-and-lairs (not a shadow-hold)
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven

// Hazard creatures.
// Ambusher carries combat-attacker-chooses-defenders ("Attacker chooses defending characters").
const AMBUSHER = 'le-59' as CardDefinitionId;    // men, prowess 10, 2 strikes
// Hobgoblins is a plain creature with no combat-rule effects.
const HOBGOBLINS = 'le-77' as CardDefinitionId;  // orc, prowess 10, 2 strikes

// Not Slay Needlessly — minion short event that cancels if defender.covert, else -2 prowess
const NSN = 'le-212' as CardDefinitionId;
// Elf-lord Revealed in Wrath — "elf" race creature, for the NSN + overt test
const ELF_LORD = 'le-69' as CardDefinitionId;

/** Base two-player M/H state: Asternak at Moria (minion shadow-hold). */
const BASE_OPTS: BuildTestStateOpts = {
  activePlayer: PLAYER_1,
  phase: Phase.MovementHazard,
  recompute: true,
  players: [
    { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ASTERNAK] }], hand: [] as CardDefinitionId[], siteDeck: [DOL_GULDUR] },
    { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [] as CardDefinitionId[], siteDeck: [DOL_GULDUR] },
  ],
};

/** Same as BASE_OPTS but with Not Slay Needlessly in the resource player's hand. */
const NSN_OPTS: BuildTestStateOpts = {
  ...BASE_OPTS,
  players: [
    { ...BASE_OPTS.players[0], hand: [NSN] },
    BASE_OPTS.players[1],
  ],
};

describe('Great Bats (as-74)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at a tapped or untapped Shadow-hold ─────────────────

  test('IS playable at an untapped Shadow-hold', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: MORIA_MINION,
      hand: [GREAT_BATS],
    });
    const batsInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === batsInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('IS playable at a tapped Shadow-hold', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: MORIA_MINION,
      hand: [GREAT_BATS],
      siteStatus: CardStatus.Tapped,
    });
    const batsInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === batsInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-Shadow-hold site (ruins-and-lairs)', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: DIMRILL_DALE,
      hand: [GREAT_BATS],
    });
    const batsInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const viable = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === batsInstanceId);
    expect(viable).toHaveLength(0);
  });

  // ─── Rule 2: may not be attacked ──────────────────────────────────────────

  test('ally is NOT offered as a defender strike target', () => {
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const combatState = makeCancelWindowCombat(withAlly, {
      creatureDefId: HOBGOBLINS,
      creatureRace: 'orc',
      strikesTotal: 1,
      strikeProwess: 9,
    });

    const assignActions = viableActions(combatState, PLAYER_1, 'assign-strike');
    const allyId = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)]
      .allies[0].instanceId;
    const allyAssigned = assignActions.some(a =>
      'characterId' in a.action && a.action.characterId === allyId,
    );
    expect(allyAssigned).toBe(false);
  });

  test('attacker cannot assign a strike to the ally (attacker-chooses attack)', () => {
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const cancelWindow = makeCancelWindowCombat(withAlly, {
      creatureDefId: AMBUSHER,
      creatureRace: 'man',
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const combatState: GameState = {
      ...cancelWindow,
      combat: { ...cancelWindow.combat!, assignmentPhase: 'attacker', attackerChoosesDefenders: true },
    };

    const assignActions = viableActions(combatState, PLAYER_2, 'assign-strike');
    const allyId = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)]
      .allies[0].instanceId;
    const allyAssigned = assignActions.some(a =>
      'characterId' in a.action && a.action.characterId === allyId,
    );
    expect(allyAssigned).toBe(false);
  });

  // ─── Rule 3: company is overt ─────────────────────────────────────────────

  test('company with Great Bats is overt (NSN does -2 prowess, not cancel)', () => {
    // Not Slay Needlessly cancels vs covert companies, gives -2 prowess vs overt.
    // ASTERNAK (man, no Orc/Troll) → covert without the ally.
    // With GREAT_BATS ally → overt (company-overt effect).
    const base = buildTestState(NSN_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const combatState = makeCancelWindowCombat(withAlly, {
      creatureDefId: ELF_LORD,
      creatureRace: 'elf',
      strikesTotal: 1,
      strikeProwess: 15,
    });

    // Overt company → NSN's cancel-attack mode is unavailable.
    const nsnInstanceId = withAlly.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(0);

    // NSN's -2 prowess mode (modify-attack from hand) IS available against the overt company.
    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as ModifyAttackAction).cardInstanceId === nsnInstanceId);
    expect(modifyActions.length).toBeGreaterThanOrEqual(1);
  });

  test('company without Great Bats and no Orc/Troll is covert (NSN cancels)', () => {
    const base = buildTestState(NSN_OPTS);
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ELF_LORD,
      creatureRace: 'elf',
      strikesTotal: 1,
      strikeProwess: 15,
    });

    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 4: discard ally when bearer is wounded ──────────────────────────

  test('ally is discarded when its bearer is wounded in combat', () => {
    // Asternak: prowess 5, body 7. Strike prowess 9.
    // Roll 2: 2 + 5 = 7 < 9 → wounded.
    // Body check roll 7: 7 >= body 7 → survives as wounded (not eliminated).
    // bearer-wounded event fires → Great Bats goes to discard pile.
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const combatState = makeCancelWindowCombat(withAlly, {
      creatureDefId: HOBGOBLINS,
      creatureRace: 'orc',
      strikesTotal: 1,
      strikeProwess: 9,
    });

    const asternakId = findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK);
    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: asternakId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);     // roll 2: 2+5=7 < 9 → wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 7);    // roll 7: 7 >= 7 → survives wounded

    expect(s.combat).toBeNull();

    // Asternak should still be in play (wounded, not eliminated)
    expect(s.players[RESOURCE_PLAYER].characters[asternakId]).toBeDefined();
    // Great Bats should be discarded to the resource player's discard pile
    expectInDiscardPile(s, RESOURCE_PLAYER, GREAT_BATS);
    // Ally must not still be attached to Asternak
    const asternakChar = s.players[RESOURCE_PLAYER].characters[asternakId];
    expect(asternakChar.allies).toHaveLength(0);
  });

  test('ally is NOT discarded when bearer wins the strike (not wounded)', () => {
    // Roll 12: 12 + 5 = 17 > 9 → Asternak wins, no wound.
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const combatState = makeCancelWindowCombat(withAlly, {
      creatureDefId: HOBGOBLINS,
      creatureRace: 'orc',
      strikesTotal: 1,
      strikeProwess: 9,
    });

    const asternakId = findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK);
    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: asternakId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);    // roll 12: 12+5=17 > 9 → success

    expect(s.combat).toBeNull();
    const asternakChar = s.players[RESOURCE_PLAYER].characters[asternakId];
    expect(asternakChar.allies).toHaveLength(1);
    expect(asternakChar.allies[0].definitionId).toBe(GREAT_BATS);
  });

  // ─── Rule 5: tap to remove "attacker chooses defending characters" ────────

  test('tap-to-remove is available during the cancel-window of an attacker-chooses attack', () => {
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const cancelWindow = makeCancelWindowCombat(withAlly, {
      creatureDefId: AMBUSHER,
      creatureRace: 'man',
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const combatState: GameState = {
      ...cancelWindow,
      combat: { ...cancelWindow.combat!, assignmentPhase: 'cancel-window', attackerChoosesDefenders: true },
    };

    const allyId = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)]
      .allies[0].instanceId;
    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as ModifyAttackAction).cardInstanceId === allyId);
    expect(modifyActions).toHaveLength(1);
  });

  test('tap-to-remove is NOT available when the attack lacks the attacker-chooses rule', () => {
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const combatState = makeCancelWindowCombat(withAlly, {
      creatureDefId: HOBGOBLINS,
      creatureRace: 'orc',
      strikesTotal: 1,
      strikeProwess: 9,
    });

    const allyId = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)]
      .allies[0].instanceId;
    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as ModifyAttackAction).cardInstanceId === allyId);
    expect(modifyActions).toHaveLength(0);
  });

  test('tap-to-remove is NOT available when the ally is already tapped', () => {
    const base = buildTestState(BASE_OPTS);
    let withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const charId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ASTERNAK);
    const char = withAlly.players[RESOURCE_PLAYER].characters[charId];
    withAlly = {
      ...withAlly,
      players: [
        {
          ...withAlly.players[RESOURCE_PLAYER],
          characters: {
            ...withAlly.players[RESOURCE_PLAYER].characters,
            [charId as string]: {
              ...char,
              allies: char.allies.map(a => ({ ...a, status: CardStatus.Tapped })),
            },
          },
        },
        withAlly.players[HAZARD_PLAYER],
      ] as unknown as typeof withAlly.players,
    };
    const cancelWindow = makeCancelWindowCombat(withAlly, {
      creatureDefId: AMBUSHER,
      creatureRace: 'man',
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const combatState: GameState = {
      ...cancelWindow,
      combat: { ...cancelWindow.combat!, assignmentPhase: 'cancel-window', attackerChoosesDefenders: true },
    };

    const allyId = withAlly.players[RESOURCE_PLAYER].characters[charId].allies[0].instanceId;
    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as ModifyAttackAction).cardInstanceId === allyId);
    expect(modifyActions).toHaveLength(0);
  });

  test('activating taps the ally, removes the rule, and the defender assigns strikes', () => {
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const cancelWindow = makeCancelWindowCombat(withAlly, {
      creatureDefId: AMBUSHER,
      creatureRace: 'man',
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const combatState: GameState = {
      ...cancelWindow,
      combat: { ...cancelWindow.combat!, assignmentPhase: 'cancel-window', attackerChoosesDefenders: true },
    };

    const charId = findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK);
    const allyId = combatState.players[RESOURCE_PLAYER].characters[charId].allies[0].instanceId;
    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as ModifyAttackAction).cardInstanceId === allyId);
    expect(modifyActions).toHaveLength(1);

    const afterTap = dispatch(combatState, modifyActions[0].action);

    // Combat continues — the attack is modified, not canceled.
    expect(afterTap.combat).not.toBeNull();
    // The attacker-chooses-defenders rule is removed.
    expect(afterTap.combat!.attackerChoosesDefenders).toBeFalsy();
    // Great Bats is now tapped.
    const ally = afterTap.players[RESOURCE_PLAYER].characters[charId].allies[0];
    expect(ally.status).toBe(CardStatus.Tapped);

    // After the defender passes the cancel-window, the DEFENDER assigns
    // strikes (not the attacker, since the rule is gone).
    const afterPass = dispatch(afterTap, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('defender');
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike').length).toBeGreaterThanOrEqual(1);
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike')).toHaveLength(0);
  });

  test('without activating, the attacker assigns strikes after the cancel-window', () => {
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const cancelWindow = makeCancelWindowCombat(withAlly, {
      creatureDefId: AMBUSHER,
      creatureRace: 'man',
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const combatState: GameState = {
      ...cancelWindow,
      combat: { ...cancelWindow.combat!, assignmentPhase: 'cancel-window', attackerChoosesDefenders: true },
    };

    const afterPass = dispatch(combatState, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThanOrEqual(1);
  });

  test('activating while the attacker is up to assign flips assignment to the defender', () => {
    const base = buildTestState(BASE_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);
    const cancelWindow = makeCancelWindowCombat(withAlly, {
      creatureDefId: AMBUSHER,
      creatureRace: 'man',
      strikesTotal: 2,
      strikeProwess: 10,
    });
    const combatState: GameState = {
      ...cancelWindow,
      combat: { ...cancelWindow.combat!, assignmentPhase: 'attacker', attackerChoosesDefenders: true },
    };

    const charId = findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK);
    const allyId = combatState.players[RESOURCE_PLAYER].characters[charId].allies[0].instanceId;
    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as ModifyAttackAction).cardInstanceId === allyId);
    expect(modifyActions).toHaveLength(1);

    const afterTap = dispatch(combatState, modifyActions[0].action);
    expect(afterTap.combat!.attackerChoosesDefenders).toBeFalsy();
    expect(afterTap.combat!.assignmentPhase).toBe('defender');
    expect(viableActions(afterTap, PLAYER_1, 'assign-strike').length).toBeGreaterThanOrEqual(1);
    expect(viableActions(afterTap, PLAYER_2, 'assign-strike')).toHaveLength(0);
  });

  // ─── Rule 6: cannot be duplicated in a given company ─────────────────────

  test('second copy in same company is not playable while first is attached', () => {
    const base = buildSitePhaseState({
      characters: [ASTERNAK],
      site: MORIA_MINION,
      hand: [GREAT_BATS, GREAT_BATS],
    });
    const withFirstAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, GREAT_BATS);

    const secondAllyInst = withFirstAlly.players[RESOURCE_PLAYER].hand[0].instanceId;
    const actions = computeLegalActions(withFirstAlly, PLAYER_1);
    const viablePlay = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === secondAllyInst);
    expect(viablePlay).toHaveLength(0);
  });

  test('Great Bats CAN be played when no copy is already in the company', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: MORIA_MINION,
      hand: [GREAT_BATS],
    });
    const batsInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === batsInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });
});
