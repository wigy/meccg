/**
 * @module le-154.test
 *
 * Card test: Stinker (le-154)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 * Stats: prowess 2, body 9, mind 4, MP 2.
 * Unique. Playable at Goblin-gate or Moria. Manifestation of Gollum and My
 * Precious.
 *
 * Card text:
 *   "If his company's size is less than three, tap Stinker to cancel one
 *    attack against his company keyed to Wilderness [{w}] or Shadow-land
 *    [{s}]. You may tap Stinker if he is at the same non-Darkhaven site as
 *    The One Ring; then both Stinker and The One Ring are discarded."
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                                    |
 * |---|------------------------------------------------------|-------------|----------------------------------------------------------|
 * | 1 | Grant-action: discard Stinker + The One Ring          | IMPLEMENTED | grant-action `stinker-discard-with-ring` (cost: discard)  |
 * | 2 | Gate on bearer at non-haven ("non-Darkhaven")        | IMPLEMENTED | `bearer.atHaven` context variable                        |
 * | 3 | Gate on The One Ring at the same site                | IMPLEMENTED | `site.hasOneRing` — name-matched across both players      |
 * | 4 | Discard ring even when held by opposing hero player  | IMPLEMENTED | `discard-named-card-from-company` scans all co-located    |
 * | 5 | Combat cancel-attack when company size < 3 (W/S key)  | IMPLEMENTED | `cancel-attack` with `attack.keying` + `bearer.companySize` |
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
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  companyIdAt, makeMHState,
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
  RegionType,
} from '../../index.js';

const STINKER = 'le-154' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;

// Minion host character for attaching Stinker
const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId;
// Second minion character used for company-size tests
const LUITPRAND = 'le-23' as CardDefinitionId;

// Sites (name-matched across alignments)
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold (name "Moria")
const MORIA_HERO = 'tw-413' as CardDefinitionId;     // shadow-hold (name "Moria")
const GOBLIN_GATE_MINION = 'le-378' as CardDefinitionId; // shadow-hold (name "Goblin-gate")
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // haven (minion "Darkhaven")
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

// Hazard creatures used to drive cancel-attack combat tests. The combat state
// is constructed directly with explicit `attackKeying` so the cancel-attack
// path is exercised regardless of which regions a given creature's `keyedTo`
// happens to include in the static card pool.
const ORC_PATROL = 'tw-074' as CardDefinitionId;   // race "orc"

/**
 * Build a minion-vs-hazard CombatState with a specified attack keying so
 * tests can exercise Stinker's cancel-attack on any region keying. Mints a
 * creature instance into the attacker's `cardsInPlay` so cancel-attack
 * resolution can move it to the discard pile.
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

describe('Stinker (le-154)', () => {
  beforeEach(() => resetMint());

  test('grant-action NOT offered when The One Ring is not at the same site', () => {
    // Stinker at Moria, no One Ring anywhere → ability should not fire.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const actions = viableActions(withStinker, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(0);
  });

  test('grant-action NOT offered at a Darkhaven even when The One Ring is there', () => {
    // Both companies are at Dol Guldur (minion haven). Although The One Ring
    // is co-located, the "non-Darkhaven" clause blocks the ability.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: DOL_GULDUR, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, HAZARD_PLAYER, ARAGORN, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(0);
  });

  test('grant-action offered when Stinker and The One Ring are at the same non-Darkhaven site', () => {
    // Stinker at minion-Moria; hero Aragorn at hero-Moria with The One Ring.
    // Name-match should recognize the sites as co-located.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, HAZARD_PLAYER, ARAGORN, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);
  });

  test('grant-action offered when Stinker and The One Ring are at Goblin-gate', () => {
    // Both at Goblin-gate (a shadow-hold, not a haven). Ring carried by the
    // same minion player's own character — still triggers (rules don't
    // restrict the owner of the ring).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: GOBLIN_GATE_MINION,
            characters: [HORSEMAN_IN_THE_NIGHT],
          }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    // The One Ring on the host character itself (unusual but permitted as fixture).
    const withRing = attachItemToChar(withStinker, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);
  });

  test('activating the grant-action discards Stinker and The One Ring held by opposing player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, HAZARD_PLAYER, ARAGORN, THE_ONE_RING);

    const hostId = findCharInstanceId(withRing, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const aragornId = findCharInstanceId(withRing, HAZARD_PLAYER, ARAGORN);

    // Capture Stinker / Ring instance IDs before dispatch so we can assert on
    // where the specific instances end up.
    const stinkerInstId = withRing.players[0].characters[hostId as string].allies[0].instanceId;
    const ringInstId = withRing.players[1].characters[aragornId as string].items[0].instanceId;

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);

    const next = dispatch(withRing, actions[0].action);

    // Stinker is no longer attached and sits in the minion player's discard.
    expect(next.players[0].characters[hostId as string].allies).toHaveLength(0);
    expectInDiscardPile(next, RESOURCE_PLAYER, stinkerInstId);

    // The One Ring is no longer on Aragorn and sits in the hero player's discard.
    expect(next.players[1].characters[aragornId as string].items).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, ringInstId);
  });

  test('activating the grant-action discards the ring held by the bearer\'s own company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MORIA_MINION,
            characters: [HORSEMAN_IN_THE_NIGHT],
          }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, THE_ONE_RING);

    const hostId = findCharInstanceId(withRing, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const stinkerInstId = withRing.players[0].characters[hostId as string].allies[0].instanceId;
    const ringInstId = withRing.players[0].characters[hostId as string].items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);

    const next = dispatch(withRing, actions[0].action);

    // Both cards end up in the minion player's own discard pile.
    const host = next.players[0].characters[hostId as string];
    expect(host.allies).toHaveLength(0);
    expect(host.items.some(i => i.instanceId === ringInstId)).toBe(false);
    expectInDiscardPile(next, RESOURCE_PLAYER, stinkerInstId);
    expectInDiscardPile(next, RESOURCE_PLAYER, ringInstId);
  });

  // ─── Combat cancel-attack (company size < 3, W/S-keyed attacks) ──────────────

  test('cancel-attack IS available against a Wilderness-keyed attack with a 1-character company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const combatState = setupCombat(withStinker, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);

    const hostId = findCharInstanceId(combatState, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const stinker = combatState.players[RESOURCE_PLAYER].characters[hostId as string].allies[0];
    const cancel = cancelActions[0].action as CancelAttackAction;
    expect(cancel.cardInstanceId).toBe(stinker.instanceId);
  });

  test('cancel-attack IS available against a Shadow-land-keyed attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const combatState = setupCombat(withStinker, ORC_PATROL, 'orc', ['shadow' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
  });

  test('cancel-attack is NOT available against a Dark-only-keyed attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const combatState = setupCombat(withStinker, ORC_PATROL, 'orc', ['dark' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack is NOT available when the company has 3 characters', () => {
    // Add a third character so company size equals 3. The ability requires
    // company size < 3, so it must not fire.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT, LUITPRAND, 'le-1' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const combatState = setupCombat(withStinker, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack IS available with a 2-character company (boundary: size < 3)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT, LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const combatState = setupCombat(withStinker, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
  });

  test('cancel-attack is NOT available when Stinker is already tapped', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    base = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const hostId = findCharInstanceId(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const host = base.players[RESOURCE_PLAYER].characters[hostId as string];
    const updatedChars = {
      ...base.players[RESOURCE_PLAYER].characters,
      [hostId as string]: {
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

  test('executing cancel-attack taps Stinker and ends combat (creature discarded)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const combatState = setupCombat(withStinker, ORC_PATROL, 'orc', ['wilderness' as RegionType]);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
    const after = dispatch(combatState, cancelActions[0].action);

    // Combat fully canceled.
    expect(after.combat).toBeNull();

    // Stinker ally is now tapped on its host.
    const hostId = findCharInstanceId(after, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const stinker = after.players[RESOURCE_PLAYER].characters[hostId as string].allies[0];
    expect(stinker.status).toBe(CardStatus.Tapped);

    // Orc-patrol lands in the hazard player's discard pile.
    expectInDiscardPile(after, HAZARD_PLAYER, ORC_PATROL);
  });
});
