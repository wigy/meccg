/**
 * @module td-97.test
 *
 * Card test: Alert the Folk (td-97)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 * Effects: 1
 *
 * Text:
 *   "Playable on a company facing a Dragon or Drake attack (not Eärcaraxë).
 *    Discard from your hand any one or two factions playable at sites in
 *    Northern Rhovanion, Iron Hills, Woodland Realm, or Anduin Vales. All
 *    characters facing the attack gain a bonus to their prowess equal to
 *    the total marshalling point values (as printed on their cards) of the
 *    factions discarded."
 *
 * Engine Support:
 * | # | Rule                                                          | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Playable only while facing a Dragon or Drake attack           | IMPLEMENTED |
 * | 2 | Excluded specifically against Eärcaraxë                       | IMPLEMENTED |
 * | 3 | Choice of discarding one or two matching factions from hand   | IMPLEMENTED |
 * | 4 | Candidate factions limited to ones playable in the four named | IMPLEMENTED |
 * |   | regions                                                       |             |
 * | 5 | Prowess bonus equals the sum of the discarded factions' MP    | IMPLEMENTED |
 * | 6 | Bonus applies to every character in the facing company       | IMPLEMENTED |
 * | 7 | Discarded factions and the event card land in the discard pile| IMPLEMENTED |
 * | 8 | Not offered outside combat (combat-only)                     | IMPLEMENTED |
 * | 9 | Not offered when hand holds no matching faction              | IMPLEMENTED |
 *
 * Playable: YES
 * Certified: 2026-08-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint,
  makeMHState,
  findCharInstanceId, findHandCardId, companyIdAt,
  viableActions, dispatch,
  expectInDiscardPile, expectNotInPile,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase, CardStatus, Race, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameState,
  PlayShortEventAction, NotPlayableAction,
} from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Alert the Folk — the card under test. */
const ALERT_THE_FOLK = 'td-97' as CardDefinitionId;
/** Aragorn II (tw-120) — defending company member, prowess 6. */
const ARAGORN = 'tw-120' as CardDefinitionId;
/** Legolas (tw-168) — defending company member, prowess 5. */
const LEGOLAS = 'tw-168' as CardDefinitionId;
/** Théoden (tw-182) — opponent's company filler. */
const THEODEN = 'tw-182' as CardDefinitionId;

/** Cave-drake (tw-020) — race "dragon", not Eärcaraxë. */
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;
/** Land-drake (td-40) — race "drake". */
const LAND_DRAKE = 'td-40' as CardDefinitionId;
/** Eärcaraxë (td-20) — the unique Dragon explicitly excluded by name. */
const EARCARAXE = 'td-20' as CardDefinitionId;
/** Orc-patrol (tw-074) — race "orc", not a Dragon/Drake attack. */
const ORC_PATROL = 'tw-074' as CardDefinitionId;

/** Men of Dale (td-138) — faction, MP 2, playable at Dale (Northern Rhovanion). */
const MEN_OF_DALE = 'td-138' as CardDefinitionId;
/** Men of Lake-town (td-139) — faction, MP 2, playable at Lake-town (Northern Rhovanion). */
const MEN_OF_LAKETOWN = 'td-139' as CardDefinitionId;
/** Rangers of the North (tw-311) — faction, MP 3, playable at Bree (Arthedain — not a named region). */
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId;

const RIVENDELL = 'tw-421' as CardDefinitionId;
const LORIEN = 'tw-408' as CardDefinitionId;
const MORIA = 'tw-413' as CardDefinitionId;

/** Build an M/H-phase base state with the given resource-player hand. */
function baseState(hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
        hand,
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [THEODEN] }],
        hand: [],
        siteDeck: [MORIA],
      },
    ],
  });
}

/**
 * Overwrites `state` with a live combat: `creatureDefId` (of race `race`)
 * attacks PLAYER_1's company. Mirrors the manual combat construction used by
 * other pre-assignment-window short-event tests (e.g. dm-117) since Alert the
 * Folk's `when` gate needs a specific enemy race/name rather than any
 * particular keying path.
 */
function attackWith(state: GameState, creatureDefId: CardDefinitionId, race: Race): GameState {
  const creatureInstanceId = 'creature-1' as CardInstanceId;
  const hazardPlayer = state.players[HAZARD_PLAYER];
  const players = [
    state.players[RESOURCE_PLAYER],
    {
      ...hazardPlayer,
      cardsInPlay: [
        ...hazardPlayer.cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: creatureDefId, status: CardStatus.Untapped },
      ],
    },
  ] as unknown as typeof state.players;

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 9,
    creatureBody: null,
    creatureRace: race,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

describe('Alert the Folk (td-97)', () => {
  beforeEach(() => resetMint());

  // ── Rule 8: combat-only — not offered outside combat ──────────────────

  test('not playable as a short event outside combat', () => {
    const state = baseState([ALERT_THE_FOLK, MEN_OF_DALE]);
    const actions = computeLegalActions(state, PLAYER_1);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, ALERT_THE_FOLK);

    const shortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        (a.action as PlayShortEventAction).cardInstanceId === cardInstance,
    );
    expect(shortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        (a.action as NotPlayableAction).cardInstanceId === cardInstance,
    );
    expect(notPlayable).toBeDefined();
  });

  // ── Rule 1: offered when facing a Dragon attack ────────────────────────

  test('offered when facing a Dragon attack (Cave-drake)', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE, MEN_OF_LAKETOWN]), CAVE_DRAKE, Race.Dragon);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Rule 1: offered when facing a Drake attack ─────────────────────────

  test('offered when facing a Drake attack (Land-drake)', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE, MEN_OF_LAKETOWN]), LAND_DRAKE, Race.Drake);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Rule 1: NOT offered against a non-Dragon/Drake attack ──────────────

  test('NOT offered when facing an Orc attack', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE, MEN_OF_LAKETOWN]), ORC_PATROL, Race.Orc);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 2: NOT offered against Eärcaraxë specifically ─────────────────

  test('NOT offered when the Dragon attacking is Eärcaraxë', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE, MEN_OF_LAKETOWN]), EARCARAXE, Race.Dragon);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 9: NOT offered when hand has no matching faction ──────────────

  test('NOT offered when hand contains only a non-matching faction', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, RANGERS_OF_THE_NORTH]), CAVE_DRAKE, Race.Dragon);
    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 3 & 4: one action per eligible 1- or 2-card combination ───────

  test('one action per eligible combination of matching factions (2 singles + 1 pair)', () => {
    const state = attackWith(
      baseState([ALERT_THE_FOLK, MEN_OF_DALE, MEN_OF_LAKETOWN, RANGERS_OF_THE_NORTH]),
      CAVE_DRAKE, Race.Dragon,
    );
    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(a => a.action as PlayShortEventAction);
    expect(actions).toHaveLength(3);
    const comboSizes = actions.map(a => a.costDiscardInstanceIds?.length).sort();
    expect(comboSizes).toEqual([1, 1, 2]);
    // Rangers of the North never appears in any combo (not a matching faction).
    const rangersInstance = findHandCardId(state, RESOURCE_PLAYER, RANGERS_OF_THE_NORTH);
    for (const a of actions) {
      expect(a.costDiscardInstanceIds).not.toContain(rangersInstance);
    }
  });

  // ── Rule 5 & 6: discarding one faction boosts all characters by its MP ─

  test('discarding one faction (MP 2) gives +2 prowess to every character in the company', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE]), CAVE_DRAKE, Race.Dragon);
    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, ALERT_THE_FOLK);
    const daleInstance = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_DALE);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: eventInstance,
      costDiscardInstanceIds: [daleInstance],
    });

    const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, LEGOLAS);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(8); // 6 + 2
    expect(afterPlay.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.prowess).toBe(7); // 5 + 2
  });

  // ── Rule 5: discarding two factions sums their MP (2 + 2 = 4) ──────────

  test('discarding two factions (MP 2 + 2) gives +4 prowess to every character', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE, MEN_OF_LAKETOWN]), CAVE_DRAKE, Race.Dragon);
    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, ALERT_THE_FOLK);
    const daleInstance = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_DALE);
    const laketownInstance = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_LAKETOWN);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: eventInstance,
      costDiscardInstanceIds: [daleInstance, laketownInstance],
    });

    const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, LEGOLAS);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(10); // 6 + 4
    expect(afterPlay.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.prowess).toBe(9); // 5 + 4
  });

  // ── Rule 7: discarded factions and the event card land in the discard pile ─

  test('discarded factions and the event card move to the discard pile; no card disappears', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE, MEN_OF_LAKETOWN]), CAVE_DRAKE, Race.Dragon);
    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, ALERT_THE_FOLK);
    const daleInstance = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_DALE);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: eventInstance,
      costDiscardInstanceIds: [daleInstance],
    });

    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, ALERT_THE_FOLK);
    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, MEN_OF_DALE);
    expectNotInPile(afterPlay, RESOURCE_PLAYER, 'hand', ALERT_THE_FOLK);
    expectNotInPile(afterPlay, RESOURCE_PLAYER, 'hand', MEN_OF_DALE);
    // Men of Lake-town (never chosen) must remain untouched in hand.
    expect(afterPlay.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MEN_OF_LAKETOWN)).toBe(true);
    assertEveryInstanceReachable(afterPlay);
  });

  // ── Rule: boost is attack-scoped ────────────────────────────────────────

  test('stat modifier constraints are scoped to the attack (kind: attack)', () => {
    const state = attackWith(baseState([ALERT_THE_FOLK, MEN_OF_DALE]), CAVE_DRAKE, Race.Dragon);
    const eventInstance = findHandCardId(state, RESOURCE_PLAYER, ALERT_THE_FOLK);
    const daleInstance = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_DALE);

    const beforePlay = state.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(beforePlay).toHaveLength(0);

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: eventInstance,
      costDiscardInstanceIds: [daleInstance],
    });

    const attackConstraints = afterPlay.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(attackConstraints).toHaveLength(2); // one per character (Aragorn, Legolas)
    for (const c of attackConstraints) {
      expect(c.kind.type).toBe('character-stat-modifier');
      if (c.kind.type === 'character-stat-modifier') {
        expect(c.kind.value).toBe(2);
      }
    }
  });
});
