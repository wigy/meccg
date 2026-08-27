/**
 * @module tw-115.test
 *
 * Card test: Words of Power and Terror (tw-115)
 * Type: hazard-event (short)
 *
 * "Modify the prowesses of all characters in a company attacked by a
 *  Nazgûl by -1 until the end of the turn. Cannot be duplicated on a
 *  given company."
 *
 * Engine Support:
 * | # | Rule                                          | Status      | Notes                                    |
 * |---|------------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Playable only during a Nazgûl (Ringwraith)      | IMPLEMENTED | play-window combat/resolve-strike +       |
 * |   | creature attack                                 |             | play-condition combat-creature-race.      |
 * | 2 | -1 prowess to every character in the company    | IMPLEMENTED | on-event self-enters-play-combat with     |
 * |   | facing the attack, until end of turn            |             | add-constraint company-stat-modifier.     |
 * | 3 | The card resolves and discards immediately      | IMPLEMENTED | short-event combat play discards instead  |
 * |   | (does not stay attached like Dragon's Curse)     |             | of attaching (combat-hazard-play.ts).     |
 * | 4 | Cannot be duplicated on a given company          | IMPLEMENTED | duplication-limit scope:company max:1     |
 * |   |                                                  |             | checked against active constraints.       |
 *
 * Playable: YES — every rule is implemented in the engine and exercised
 * by assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  companyIdAt, findCharInstanceId, dispatch, viableFor, viableActions,
  expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CombatState, GameState, PlayHazardAction } from '../../index.js';
import { Race } from '../../index.js';

const WORDS_OF_POWER_AND_TERROR = 'tw-115' as CardDefinitionId;

/**
 * Build a resolve-strike combat state for a Nazgûl (Ringwraith) attack
 * against a two-character defending company, with the card in the hazard
 * player's hand. Mirrors Dragon's Curse's (td-16) test scaffolding.
 */
function makeNazgulResolveStrikeState(opts: {
  creatureRace?: Race;
  cardInHand?: boolean;
}): { state: GameState } {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GANDALF] }],
        hand: opts.cardInHand === false ? [] : [WORDS_OF_POWER_AND_TERROR],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  // The plain `buildTestState({ phase: Phase.MovementHazard, ... })` scaffold
  // leaves the M/H phase state minimal ({ phase } only). That's fine for
  // most combat tests, but `combatHazardPermanentPlays` also consults the
  // hazard-limit fields (`hazardLimitAtReveal`/`preRevealHazardLimitConstraintIds`)
  // once `activeConstraints` gains an entry targeting the company — which this
  // card's own effect does — so they must be filled in here.
  const withMhState: GameState = {
    ...base,
    phaseState: {
      ...base.phaseState,
      hazardLimitAtReveal: 4,
      preRevealHazardLimitConstraintIds: [],
    } as GameState['phaseState'],
  };
  const aragornId = findCharInstanceId(withMhState, RESOURCE_PLAYER, ARAGORN);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'synthetic-nazgul' as import('../../index.js').CardInstanceId },
    companyId: companyIdAt(withMhState, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 17,
    creatureBody: 12,
    creatureRace: opts.creatureRace ?? Race.Ringwraith,
    strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { state: { ...withMhState, combat } };
}

describe('Words of Power and Terror (tw-115)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable only during a Nazgûl attack ───────────────────────

  test('hazard player can play the card during a Nazgûl attack resolve-strike', () => {
    const { state } = makeNazgulResolveStrikeState({});
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT offered when the attacking creature is not a Nazgûl', () => {
    const { state } = makeNazgulResolveStrikeState({ creatureRace: Race.Orc });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('combat play-window pins the card out of the M/H phase hazard menu', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GANDALF] }], hand: [WORDS_OF_POWER_AND_TERROR], siteDeck: [RIVENDELL] },
      ],
    });
    const plays = viableActions(base, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Rules 2 & 3: company-wide -1 prowess, resolves and discards ────────

  test('playing the card discards it immediately (does not attach) and reduces every company member\'s prowess by 1', () => {
    const { state } = makeNazgulResolveStrikeState({});
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    expect(state.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(6);
    expect(state.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.prowess).toBe(5);

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(1);
    const next = dispatch(state, plays[0].action);

    // The card never attaches to any character's hazards...
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(0);
    expect(next.players[RESOURCE_PLAYER].characters[legolasId].hazards).toHaveLength(0);
    // ...it resolves straight to the hazard player's discard pile instead.
    expectInDiscardPile(next, HAZARD_PLAYER, WORDS_OF_POWER_AND_TERROR);

    // Both company members — not just the one facing the current strike —
    // lose 1 prowess for the rest of the turn.
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(5);
    expect(next.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.prowess).toBe(4);

    // The struck character's strike (unlike Dragon's Curse) is untouched —
    // this card modifies character prowess, not the current strike.
    expect(next.combat!.strikeAssignments[0].strikeProwessBonus ?? 0).toBe(0);

    // Modifier is turn-scoped ("until the end of the turn").
    const constraint = next.activeConstraints.find(c => c.kind.type === 'company-stat-modifier');
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('turn');
    expect(constraint!.target).toEqual({ kind: 'company', companyId: companyIdAt(state, RESOURCE_PLAYER) });
  });

  // ─── Rule 4: cannot be duplicated on a given company ────────────────────

  test('NOT offered a second time against the same company (duplication-limit scope: company)', () => {
    const { state } = makeNazgulResolveStrikeState({});
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(1);
    const afterFirst = dispatch(state, plays[0].action);

    // Give the hazard player a second copy in hand for the same attack.
    const withSecondCopy: GameState = {
      ...afterFirst,
      players: [
        afterFirst.players[0],
        { ...afterFirst.players[1], hand: [{ instanceId: 'wopt-2' as import('../../index.js').CardInstanceId, definitionId: WORDS_OF_POWER_AND_TERROR }] },
      ],
    };
    const morePlays = viableActions(withSecondCopy, PLAYER_2, 'play-hazard');
    expect(morePlays).toHaveLength(0);
  });
});
