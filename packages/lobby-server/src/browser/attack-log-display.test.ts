/**
 * @module attack-log-display.test
 *
 * Feature request "Have all attack canceler/modifiers etc on the roll"
 * (ab9e871ac5deb6d0): in two Marsh-drake games the defender's Dark Quarrels
 * halved the attack's strikes and a -1 prowess modifier changed a strike roll,
 * but the hazard player saw neither. The engine now records every attack
 * change in `combat.attackLog` and attaches a breakdown to strike rolls and
 * body checks; these tests cover the client-side text built from them:
 * - the combat "Attack" panel lists the base stats, each change with its card
 *   and player, and the current totals;
 * - a strike roll's caption/log line spells out every prowess term, the
 *   total, the need and the outcome — for both players, roller included.
 */

import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardDefinitionId, CombatState, DiceRollEffect, PlayerId } from '@meccg/shared';
import { stripCardMarkers } from '@meccg/shared';
import { attackPanelLines } from './attack-panel-lines.js';
import { diceRollCaption, diceRollNotification } from './dice-roll-log.js';

const DARK_QUARRELS = 'tw-207' as CardDefinitionId;
const BOB = 'p2' as PlayerId;
const CARD_POOL = {
  [DARK_QUARRELS]: { id: DARK_QUARRELS, name: 'Dark Quarrels' },
} as unknown as Readonly<Record<string, CardDefinition>>;

const COMBAT = {
  strikesTotal: 1,
  strikeProwess: 10,
  creatureBody: 8,
  attackLog: [
    { kind: 'base', strikes: 2, prowess: 11, body: 8 },
    { kind: 'strikes', sourceDefinitionId: DARK_QUARRELS, playedBy: BOB, before: 2, after: 1, note: 'halved' },
    { kind: 'prowess', before: 11, after: 10 },
  ],
} as unknown as CombatState;

const STRIKE_ROLL: DiceRollEffect = {
  effect: 'dice-roll',
  playerName: 'Alice',
  die1: 3,
  die2: 4,
  label: 'Strike: Beorn',
  total: 15,
  breakdown: {
    character: [{ label: 'base', value: 7 }, { label: 'Horn of Anor', value: 1 }],
    opponent: [{ label: 'prowess', value: 10 }],
    need: 3,
    outcome: 'success',
  },
};

describe('attack log display', () => {
  test('attack panel lists base stats, each card change with its player, and the totals', () => {
    const lines = attackPanelLines(COMBAT, CARD_POOL, id => (id === BOB ? 'Bob' : undefined));
    expect(lines.entries.map(stripCardMarkers)).toEqual([
      'Attack: 2 strikes, 11 prowess, 8 body',
      'Bob played Dark Quarrels: strikes 2 → 1 (halved)',
      'a card: prowess 11 → 10',
    ]);
    expect(lines.totals).toBe('1 strike · 10 prowess · 8 body');
  });

  test('strike roll caption spells out every prowess term, total, need and outcome', () => {
    expect(diceRollCaption(STRIKE_ROLL)).toBe(
      'Strike: Beorn: 7 + prowess 8 (base 7, +1 Horn of Anor) = 15 vs 10, need 3+ — strike defeated',
    );
  });

  test('a breakdown roll is logged for the roller too, not only the opponent', () => {
    const self = diceRollNotification(STRIKE_ROLL, 'Alice', 'Bob');
    expect(self?.opts).toEqual({ self: 'Alice' });
    expect(self?.message).toContain('= 15 vs 10');
    const opp = diceRollNotification(STRIKE_ROLL, 'Bob', 'Alice');
    expect(opp?.opts).toEqual({ opponent: 'Alice' });
  });

  test('a roll without a breakdown has no caption', () => {
    expect(diceRollCaption({ effect: 'dice-roll', playerName: 'Alice', die1: 1, die2: 2, label: 'Corruption check' })).toBeUndefined();
  });
});
