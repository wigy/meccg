/**
 * @module td-21.test
 *
 * Card test: Eärcaraxë Ahunt (td-21)
 * Type: hazard-event (long, unique)
 * Effects: 2 (duplication-limit scope:game max:1, ahunt-attack)
 *
 * "Unique. Any company moving in Andrast Coast, Bay of Belfalas, Eriadoran
 *  Coast, and/or Andrast faces one Dragon attack (considered a hazard creature
 *  attack) — 3 strikes at 15/6 (attacker chooses defending characters).
 *  If Doors of Night is in play, this attack also affects: Old Pûkel-land,
 *  Enedhwaith, Anfalas, and any Coastal Sea region (or region type)."
 *
 * Engine Support:
 * | # | Feature                           | Status      | Notes                              |
 * |---|-----------------------------------|-------------|------------------------------------|
 * | 1 | Unique (duplication-limit game:1)  | IMPLEMENTED | duplication-limit effect           |
 * | 2 | Ahunt attack on matching regions   | IMPLEMENTED | ahunt-attack in order-effects step |
 * | 3 | Attacker chooses defenders         | IMPLEMENTED | combatRules on ahunt-attack        |
 * | 4 | Doors of Night extends regions     | IMPLEMENTED | extended clause with condition      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, buildTestState, resetMint, makeMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF, LEGOLAS,
  EDHELLOND, LORIEN, MINAS_TIRITH, DOORS_OF_NIGHT,
  viableActions, dispatch, mint, addP2CardsInPlay,
} from '../test-helpers.js';
import { Phase, CardStatus, reduce } from '../../index.js';
import type { CardDefinitionId, HazardEventCard, CombatState, GameState } from '../../index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const EARCARAXE_AHUNT = 'td-21' as CardDefinitionId;

/**
 * Build a state where a company at Edhellond is in M/H order-effects step,
 * moving through the given region path names. The ahunt long-event is
 * already in PLAYER_2's cardsInPlay.
 */
function buildAhuntOrderEffectsState(
  pathNames: readonly string[],
  pathTypes: readonly string[],
  extraCardsInPlay: { definitionId: CardDefinitionId }[] = [],
): GameState {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: EDHELLOND, characters: [ARAGORN, GANDALF] }],
        hand: [],
        siteDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });

  const ahuntInstance = { instanceId: mint(), definitionId: EARCARAXE_AHUNT, status: CardStatus.Untapped };
  const extraInstances = extraCardsInPlay.map(c => ({
    instanceId: mint(),
    definitionId: c.definitionId,
    status: CardStatus.Untapped,
  }));

  const withCards = addP2CardsInPlay(base, [ahuntInstance, ...extraInstances]);

  return {
    ...withCards,
    phaseState: makeMHState({
      step: 'order-effects' as const,
      resolvedSitePathNames: pathNames as string[],
      resolvedSitePath: pathTypes as import('../../index.js').RegionType[],
    }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Eärcaraxë Ahunt (td-21)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct type, stats, and effects', () => {
    const def = pool[EARCARAXE_AHUNT as string] as HazardEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-event');
    expect(def.eventType).toBe('long');
    expect(def.unique).toBe(true);
    expect(def.effects).toHaveLength(2);
    expect(def.effects![0].type).toBe('duplication-limit');
    expect(def.effects![1].type).toBe('ahunt-attack');
  });

  test('ahunt-attack effect has correct region names and combat stats', () => {
    const def = pool[EARCARAXE_AHUNT as string] as HazardEventCard;
    const ahunt = def.effects!.find(e => e.type === 'ahunt-attack')!;
    expect(ahunt).toMatchObject({
      type: 'ahunt-attack',
      regionNames: ['Andrast Coast', 'Bay of Belfalas', 'Eriadoran Coast', 'Andrast'],
      strikes: 3,
      prowess: 15,
      body: 6,
      race: 'dragon',
      combatRules: ['attacker-chooses-defenders'],
    });
  });

  test('ahunt-attack extended clause adds regions when Doors of Night is in play', () => {
    const def = pool[EARCARAXE_AHUNT as string] as HazardEventCard;
    const ahunt = def.effects!.find(e => e.type === 'ahunt-attack')!;
    expect((ahunt as { extended?: unknown }).extended).toMatchObject({
      when: { inPlay: 'Doors of Night' },
      regionNames: ['Old Pûkel-land', 'Enedhwaith', 'Anfalas'],
      regionTypes: ['coastal-sea'],
    });
  });

  test('company moving through Andrast Coast triggers ahunt combat at order-effects', () => {
    const state = buildAhuntOrderEffectsState(
      ['Anfalas', 'Andrast Coast'],
      ['wilderness', 'coastal'],
    );

    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThanOrEqual(1);

    const next = dispatch(state, passActions[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(15);
    expect(combat.creatureBody).toBe(6);
    expect(combat.creatureRace).toBe('dragon');
    expect(combat.assignmentPhase).toBe('cancel-window');
  });

  test('company moving through Bay of Belfalas triggers ahunt combat', () => {
    const state = buildAhuntOrderEffectsState(
      ['Bay of Belfalas'],
      ['coastal'],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('company moving through non-matching region does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState(
      ['Belfalas', 'Lamedon'],
      ['wilderness', 'wilderness'],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('non-moving company (empty path) does not trigger ahunt', () => {
    const state = buildAhuntOrderEffectsState([], []);

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Old Pûkel-land does NOT trigger without Doors of Night', () => {
    const state = buildAhuntOrderEffectsState(
      ['Old Pûkel-land'],
      ['wilderness'],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('Old Pûkel-land triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState(
      ['Old Pûkel-land'],
      ['wilderness'],
      [{ definitionId: DOORS_OF_NIGHT }],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('coastal-sea region type triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState(
      ['Some Coastal Region'],
      ['coastal-sea'],
      [{ definitionId: DOORS_OF_NIGHT }],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('ahunt');
  });

  test('Enedhwaith triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState(
      ['Enedhwaith'],
      ['wilderness'],
      [{ definitionId: DOORS_OF_NIGHT }],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('Anfalas triggers with Doors of Night in play', () => {
    const state = buildAhuntOrderEffectsState(
      ['Anfalas'],
      ['wilderness'],
      [{ definitionId: DOORS_OF_NIGHT }],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
  });

  test('attacker chooses defenders (cancel-window phase)', () => {
    const state = buildAhuntOrderEffectsState(
      ['Andrast'],
      ['wilderness'],
    );

    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('ahunt long-event stays in cardsInPlay after combat (not moved to kill/discard)', () => {
    const state = buildAhuntOrderEffectsState(
      ['Andrast Coast'],
      ['coastal'],
    );

    // Trigger combat
    let current = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(current.combat).not.toBeNull();

    // Run through combat: both players pass through strike assignment and resolution
    for (let i = 0; i < 50 && current.combat !== null; i++) {
      // Try hazard player actions first (attacker assigns strikes)
      let actions = viableActions(current, PLAYER_2, 'assign-strike');
      if (actions.length > 0) {
        current = dispatch(current, actions[0].action);
        continue;
      }
      // Try defender actions
      actions = viableActions(current, PLAYER_1, 'assign-strike');
      if (actions.length > 0) {
        current = dispatch(current, actions[0].action);
        continue;
      }
      // Try pass actions from either player
      for (const pid of [PLAYER_1, PLAYER_2]) {
        actions = viableActions(current, pid, 'pass');
        if (actions.length > 0) {
          const result = reduce(current, actions[0].action);
          if (!result.error) {
            current = result.state;
            break;
          }
        }
      }
    }

    // After combat, ahunt card should still be in cardsInPlay
    const ahuntInPlay = current.players[1].cardsInPlay.some(
      c => c.definitionId === EARCARAXE_AHUNT,
    );
    expect(ahuntInPlay).toBe(true);

    // It should NOT be in discard or kill piles
    expect(current.players[0].killPile.some(c => c.definitionId === EARCARAXE_AHUNT)).toBe(false);
    expect(current.players[1].discardPile.some(c => c.definitionId === EARCARAXE_AHUNT)).toBe(false);
  });
});
