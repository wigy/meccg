/**
 * @module tw-246.test
 *
 * Card test: Gollum (tw-246)
 * Type: hero-resource-ally
 * Alignment: wizard
 * Stats: prowess 2, body 9, mind 4, MP 2.
 * Unique. Playable at Goblin-gate or Moria.
 *
 * Card text:
 *   "If his company's size is two or less, tap Gollum to cancel one attack
 *    against his company keyed to Wilderness [{w}] or Shadow-land [{s}].
 *    You may tap Gollum if he is at the same non-Haven site as The One Ring;
 *    then both Gollum and The One Ring are discarded."
 *
 * Gollum is the hero-alignment counterpart to Stinker (le-154) — the same
 * game mechanics apply, evaluated through the same cancel-attack and
 * grant-action engine paths.
 *
 * Engine Support:
 * | # | Feature                                               | Status      | Notes                                                     |
 * |---|-------------------------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | Playable at Goblin-gate or Moria                      | IMPLEMENTED | `playableAt` with two `site` entries                      |
 * | 2 | Grant-action: discard Gollum + The One Ring           | IMPLEMENTED | grant-action `stinker-discard-with-ring` (cost: discard)  |
 * | 3 | Gate on bearer at non-Haven                           | IMPLEMENTED | `bearer.atHaven` context variable                         |
 * | 4 | Gate on The One Ring at the same site                 | IMPLEMENTED | `site.hasOneRing` — name-matched across both players      |
 * | 5 | Discard ring even when held by opposing player        | IMPLEMENTED | `discard-named-card-from-company` scans all co-located    |
 * | 6 | Combat cancel-attack when company size ≤ 2 (W/S key)  | IMPLEMENTED | `cancel-attack` with `attack.keying` + `bearer.companySize` |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar, attachItemToChar,
  viableActions, dispatch,
  findCharInstanceId,
  expectInDiscardPile,
  makeSitePhase,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, FRODO, LEGOLAS,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  companyIdAt, makeMHState,
  RIVENDELL, MORIA, MOUNT_DOOM,
} from '../test-helpers.js';
import { Alignment, CardStatus } from '../../index.js';
import type {
  CardDefinitionId,
  ActivateGrantedAction,
  CancelAttackAction,
  CardInstance,
  CardInstanceId,
  CombatState,
  GameState,
  PlayHeroResourceAction,
  RegionType,
} from '../../index.js';

const GOLLUM = 'tw-246' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const GOBLIN_GATE = 'tw-398' as CardDefinitionId;   // hero shadow-hold (name "Goblin-gate")
const ORC_PATROL = 'tw-074' as CardDefinitionId;    // hazard creature for combat tests

/**
 * Build a combat state with the given attack keying so tests can exercise
 * Gollum's cancel-attack on any region keying. Mints a creature instance into
 * the hazard player's cardsInPlay so cancel-attack resolution can discard it.
 */
function setupCombat(
  state: GameState,
  creatureDefId: CardDefinitionId,
  creatureRace: string,
  keying: readonly RegionType[],
): GameState {
  const creatureInstanceId = `creature-${creatureDefId as string}-1` as CardInstanceId;
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
    strikeProwess: 6,
    creatureBody: null,
    creatureRace,
    attackKeying: keying.length > 0 ? keying : undefined,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

describe('Gollum (tw-246)', () => {
  beforeEach(() => resetMint());

  // ─── Playable-at restriction ─────────────────────────────────────────────────

  test('Gollum IS playable at Goblin-gate', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GOBLIN_GATE, characters: [ARAGORN] }], hand: [GOLLUM], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const gollumInstanceId = state.players[0].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === gollumInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Gollum IS playable at Moria', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [GOLLUM], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const gollumInstanceId = state.players[0].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === gollumInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Gollum is NOT playable at a non-Goblin-gate/Moria shadow-hold (Mount Doom)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MOUNT_DOOM, characters: [ARAGORN] }], hand: [GOLLUM], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const gollumInstanceId = state.players[0].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === gollumInstanceId);
    expect(playActions).toHaveLength(0);
  });

  // ─── Grant-action: discard Gollum + The One Ring ─────────────────────────────

  test('grant-action NOT offered when The One Ring is not at the same site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const actions = viableActions(withGollum, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(0);
  });

  test('grant-action NOT offered at a Haven even when The One Ring is there', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const withRing = attachItemToChar(withGollum, HAZARD_PLAYER, BILBO, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(0);
  });

  test('grant-action offered when Gollum and The One Ring are at the same non-Haven site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [BILBO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const withRing = attachItemToChar(withGollum, HAZARD_PLAYER, BILBO, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);
  });

  test('grant-action offered when Gollum and The One Ring are at Goblin-gate', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: GOBLIN_GATE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const withRing = attachItemToChar(withGollum, RESOURCE_PLAYER, ARAGORN, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);
  });

  test('activating the grant-action discards Gollum and The One Ring held by opposing player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [BILBO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const withRing = attachItemToChar(withGollum, HAZARD_PLAYER, BILBO, THE_ONE_RING);

    const aragornId = findCharInstanceId(withRing, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(withRing, HAZARD_PLAYER, BILBO);

    const gollumInstId = withRing.players[0].characters[aragornId as string].allies[0].instanceId;
    const ringInstId = withRing.players[1].characters[bilboId as string].items[0].instanceId;

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);

    const next = dispatch(withRing, actions[0].action);

    expect(next.players[0].characters[aragornId as string].allies).toHaveLength(0);
    expectInDiscardPile(next, RESOURCE_PLAYER, gollumInstId);

    expect(next.players[1].characters[bilboId as string].items).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, ringInstId);
  });

  test("activating the grant-action discards the ring held by the bearer's own company", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const withRing = attachItemToChar(withGollum, RESOURCE_PLAYER, ARAGORN, THE_ONE_RING);

    const aragornId = findCharInstanceId(withRing, RESOURCE_PLAYER, ARAGORN);
    const gollumInstId = withRing.players[0].characters[aragornId as string].allies[0].instanceId;
    const ringInstId = withRing.players[0].characters[aragornId as string].items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);

    const next = dispatch(withRing, actions[0].action);

    const host = next.players[0].characters[aragornId as string];
    expect(host.allies).toHaveLength(0);
    expect(host.items.some(i => i.instanceId === ringInstId)).toBe(false);
    expectInDiscardPile(next, RESOURCE_PLAYER, gollumInstId);
    expectInDiscardPile(next, RESOURCE_PLAYER, ringInstId);
  });

  // ─── Combat cancel-attack (company size ≤ 2, W/S-keyed attacks) ──────────────

  test('cancel-attack IS available against a Wilderness-keyed attack with a 1-character company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const combatState = setupCombat(withGollum, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);

    const aragornId = findCharInstanceId(combatState, RESOURCE_PLAYER, ARAGORN);
    const gollum = combatState.players[RESOURCE_PLAYER].characters[aragornId as string].allies[0];
    const cancel = cancelActions[0].action as CancelAttackAction;
    expect(cancel.cardInstanceId).toBe(gollum.instanceId);
  });

  test('cancel-attack IS available against a Shadow-land-keyed attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const combatState = setupCombat(withGollum, ORC_PATROL, 'orc', ['shadow' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
  });

  test('cancel-attack is NOT available against a Dark-domain-only-keyed attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const combatState = setupCombat(withGollum, ORC_PATROL, 'orc', ['dark' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack IS available with a 2-character company (boundary: size ≤ 2)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [] },
      ],
    });
    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const combatState = setupCombat(withGollum, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
  });

  test('cancel-attack is NOT available when the company has 3 characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN, BILBO, FRODO] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const combatState = setupCombat(withGollum, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack is NOT available when Gollum is already tapped', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    base = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const host = base.players[RESOURCE_PLAYER].characters[aragornId as string];
    const updatedChars = {
      ...base.players[RESOURCE_PLAYER].characters,
      [aragornId as string]: {
        ...host,
        allies: host.allies.map(a => ({ ...a, status: CardStatus.Tapped })),
      },
    };
    base = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], characters: updatedChars },
        base.players[HAZARD_PLAYER],
      ] as unknown as typeof base.players,
    };

    const combatState = setupCombat(base, ORC_PATROL, 'orc', ['wilderness' as RegionType]);
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('executing cancel-attack taps Gollum and ends combat (creature discarded)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [] },
      ],
    });
    const withGollum = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLLUM);
    const combatState = setupCombat(withGollum, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
    const after = dispatch(combatState, cancelActions[0].action);

    expect(after.combat).toBeNull();

    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const gollum = after.players[RESOURCE_PLAYER].characters[aragornId as string].allies[0];
    expect(gollum.status).toBe(CardStatus.Tapped);

    expectInDiscardPile(after, HAZARD_PLAYER, ORC_PATROL);
  });
});
