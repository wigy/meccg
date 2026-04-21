/**
 * @module le-158.test
 *
 * Card test: The Warg-king (le-158)
 * Type: minion-resource-ally
 *
 * Card text:
 *   "Unique. Playable at any tapped or untapped Ruins & Lairs with a Wolf
 *    automatic-attack. Tap to cancel a Wolf or Animal attack against his
 *    company. +2 to any influence attempt by a character in his company
 *    against a Wolf faction."
 *
 * Effects tested:
 *   1. Playable-at restriction — `playableAt` with `siteType: ruins-and-lairs`
 *      and `when: { "site.autoAttack.race": "wolf" }`.
 *   2. cancel-attack — `cost: { "tap": "self" }` with `enemy.race` $in
 *      ["wolf", "wolves", "animal", "animals"]. Sourced from in-play ally;
 *      taps the ally rather than discarding from hand.
 *   3. check-modifier — +2 influence when faction race is "wolf",
 *      collected from any ally in the influencing character's company.
 *
 * Fixture alignment: minion-character (ringwraith), with minion sites and
 * the minion Wolf faction Wargs of the Forochel (le-293).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, attachAllyToChar,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, companyIdAt, dispatch,
  makeMHState, expectInDiscardPile,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInstance, CardInstanceId, CombatState, CancelAttackAction, InfluenceAttemptAction, PlayHeroResourceAction, GameState } from '../../index.js';

const WARG_KING = 'le-158' as CardDefinitionId;
const WARGS_OF_FOROCHEL = 'le-293' as CardDefinitionId;

// Minion characters — clean fixtures with no DI/influence effects of their own.
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, mind 5, DI 2, no effects
const LUITPRAND = 'le-23' as CardDefinitionId; // man, mind 1, DI 0, no effects

// Minion sites
const WHITE_TOWERS = 'le-412' as CardDefinitionId; // ruins-and-lairs, Wolves auto-attack
const DIMRILL_DALE = 'le-365' as CardDefinitionId; // ruins-and-lairs, Orcs auto-attack (no Wolves)
const LOSSADAN_CAIRN = 'le-388' as CardDefinitionId; // ruins-and-lairs (used for influence check)
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold (default destination)

// Hazard creatures used in combat tests. Wolf/Animal-race creatures in the
// pool have empty `keyedTo` arrays (they would normally be played via site
// auto-attacks), so the combat tests construct {@link CombatState} directly
// to exercise the cancel-attack legal-action path.
const DIRE_WOLVES = 'le-68' as CardDefinitionId;          // race "wolves"
const WATCHER_IN_THE_WATER = 'le-99' as CardDefinitionId; // race "animals"
const CAVE_DRAKE = 'tw-082' as CardDefinitionId;          // race "drake" (control: not Wolf/Animal)

/**
 * Build a CombatState for a wolf/animal/drake hazard creature attacking the
 * defending company. Mints a creature instance into the attacker's
 * `cardsInPlay` so cancel-attack resolution can move it to the discard pile.
 */
function setupCombat(
  state: GameState,
  creatureDefId: CardDefinitionId,
  creatureRace: string,
): GameState {
  const creatureInstanceId = `creature-${creatureRace}-1` as CardInstanceId;
  const creatureCard: CardInstance = { instanceId: creatureInstanceId, definitionId: creatureDefId };
  const hazardPlayer = state.players[HAZARD_PLAYER];
  const updatedHazardPlayer = {
    ...hazardPlayer,
    cardsInPlay: [
      ...hazardPlayer.cardsInPlay,
      { instanceId: creatureCard.instanceId, definitionId: creatureCard.definitionId, status: CardStatus.Untapped },
    ],
  };
  const players = [
    state.players[RESOURCE_PLAYER],
    updatedHazardPlayer,
  ] as unknown as typeof state.players;

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 2,
    strikeProwess: 8,
    creatureBody: null,
    creatureRace,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

describe('The Warg-king (le-158)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: playable-at restriction ───────────────────────────────────────

  test('Warg-king IS playable at a Ruins & Lairs site with a Wolf automatic-attack', () => {
    // The White Towers (le-412) is ruins-and-lairs with a Wolves auto-attack —
    // satisfies the `site.autoAttack.race: wolf` condition.
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: WHITE_TOWERS,
      hand: [WARG_KING],
    });

    const wargKingInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === wargKingInstanceId);

    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Warg-king is NOT playable at a Ruins & Lairs site without a Wolf automatic-attack', () => {
    // Dimrill Dale (le-365) is ruins-and-lairs but has only an Orcs
    // auto-attack — the `when` clause must reject this site.
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: DIMRILL_DALE,
      hand: [WARG_KING],
    });

    const wargKingInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);

    const viablePlay = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === wargKingInstanceId);
    expect(viablePlay).toHaveLength(0);

    const notPlayable = actions.filter(a =>
      !a.viable
      && a.action.type === 'not-playable'
      && (a.action as { cardInstanceId: string }).cardInstanceId === wargKingInstanceId,
    );
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
  });

  test('Warg-king is NOT playable at a non-Ruins-and-Lairs site even with no Wolf auto-attack', () => {
    // Dol Guldur (le-367) is a minion haven, not ruins-and-lairs.
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: DOL_GULDUR,
      hand: [WARG_KING],
    });

    const wargKingInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const viablePlay = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === wargKingInstanceId);
    expect(viablePlay).toHaveLength(0);
  });

  // ─── Effect 2: tap to cancel a Wolf or Animal attack ─────────────────────────

  test('Warg-king tap-to-cancel is available against a Wolf attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, WARG_KING);
    const combatState = setupCombat(withAlly, DIRE_WOLVES, 'wolves');

    expect(combatState.combat).not.toBeNull();
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);

    const cancelAction = cancelActions[0].action as CancelAttackAction;
    const ally = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK) as string]
      .allies[0];
    expect(cancelAction.cardInstanceId).toBe(ally.instanceId);
    expect(cancelAction.scoutInstanceId).toBeUndefined();
  });

  test('Warg-king tap-to-cancel is available against an Animal attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, WARG_KING);
    const combatState = setupCombat(withAlly, WATCHER_IN_THE_WATER, 'animals');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
  });

  test('Warg-king tap-to-cancel is NOT available against a non-Wolf/Animal attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, WARG_KING);
    const combatState = setupCombat(withAlly, CAVE_DRAKE, 'drake');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('Warg-king tap-to-cancel is NOT available when the ally is already tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, WARG_KING);
    const charId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ASTERNAK);
    const char = withAlly.players[RESOURCE_PLAYER].characters[charId as string];
    const updatedChars = {
      ...withAlly.players[RESOURCE_PLAYER].characters,
      [charId as string]: {
        ...char,
        allies: char.allies.map(a => ({ ...a, status: CardStatus.Tapped })),
      },
    };
    withAlly = {
      ...withAlly,
      players: [
        { ...withAlly.players[RESOURCE_PLAYER], characters: updatedChars },
        withAlly.players[HAZARD_PLAYER],
      ] as unknown as typeof withAlly.players,
    };

    const combatState = setupCombat(withAlly, DIRE_WOLVES, 'wolves');
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('Executing Warg-king tap-to-cancel taps the ally and ends combat (creature discarded)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, WARG_KING);
    const combatState = setupCombat(withAlly, DIRE_WOLVES, 'wolves');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
    const after = dispatch(combatState, cancelActions[0].action);

    // Combat fully canceled (ally cancel does not chain).
    expect(after.combat).toBeNull();

    // Warg-king ally is now tapped on its host.
    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    const ally = after.players[RESOURCE_PLAYER].characters[charId as string].allies[0];
    expect(ally.status).toBe(CardStatus.Tapped);

    // Wolves creature lands in the hazard player's discard pile.
    expectInDiscardPile(after, HAZARD_PLAYER, DIRE_WOLVES);
  });

  // ─── Effect 3: +2 influence vs Wolf factions for any character in company ────

  test('+2 influence applies to ANY character in the Warg-king\'s company against a Wolf faction', () => {
    // Asternak (man, base DI 2) attempts to influence Wargs of the Forochel
    // (wolf faction, influenceNumber 10) at Lossadan Cairn. The Warg-king
    // is attached to Luitprand, not Asternak — but the bonus is company-wide.
    //   modifier = DI 2 + Warg-king bonus 2 = 4 → need = 10 - 4 = 6
    const base = buildSitePhaseState({
      characters: [ASTERNAK, LUITPRAND],
      site: LOSSADAN_CAIRN,
      hand: [WARGS_OF_FOROCHEL],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, WARG_KING);

    const asternakId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ASTERNAK);
    const actions = computeLegalActions(withAlly, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const asternakAttempt = influenceActions.find(
      a => a.influencingCharacterId === asternakId,
    );
    expect(asternakAttempt).toBeDefined();
    // influenceNumber(10) - baseDI(2) - wargKingBonus(+2) = 6
    expect(asternakAttempt!.need).toBe(6);
  });

  test('+2 influence does NOT apply when the Warg-king is not in the company', () => {
    // Same setup, but the Warg-king is not attached anywhere. Asternak's
    // attempt sees only his base DI 2 → need = 10 - 2 = 8.
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: LOSSADAN_CAIRN,
      hand: [WARGS_OF_FOROCHEL],
    });

    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const asternakAttempt = influenceActions.find(
      a => a.influencingCharacterId === asternakId,
    );
    expect(asternakAttempt).toBeDefined();
    expect(asternakAttempt!.need).toBe(8);
  });

  test('+2 influence does NOT apply against non-Wolf factions (faction-race-gated)', () => {
    // Goblins of Goblin-gate (le-265, race "orc") at Goblin-gate (le-378).
    // Warg-king's bonus is faction.race=wolf only — must not fire here.
    const GOBLIN_GATE = 'le-378' as CardDefinitionId;
    const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;

    const base = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, WARG_KING);

    const asternakId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ASTERNAK);
    const actions = computeLegalActions(withAlly, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const asternakAttempt = influenceActions.find(
      a => a.influencingCharacterId === asternakId,
    );
    expect(asternakAttempt).toBeDefined();
    // influenceNumber(9) - baseDI(2) = 7 (no Warg-king bonus for an Orc faction)
    expect(asternakAttempt!.need).toBe(7);
  });
});
