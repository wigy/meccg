/**
 * @module effect-log-buffer.test
 *
 * Regression test for bug report "Text log" (game ms1vaegk-e4fvuf, seq 110):
 * "Roll result comes to text log before the line telling about the next roll."
 *
 * In that game AI-Real resolved two Lure of Expedience (tw-57) corruption
 * checks back to back — Glorfindel II (tw-161, CP 4, rolled 5+5) at seq 103 and
 * Théoden (tw-182, CP 3, rolled 6+2) at seq 104. The game server broadcasts a
 * reducer's `effect` messages before the `state` message of the same action, so
 * the client logged each roll as it arrived and the panel read
 *
 * ```text
 * AI-Real: rolled 5 + 5 = 10 (Corruption: Glorfindel II)
 * AI-Real: Corruption check for Glorfindel II (CP 4)
 * ```
 *
 * — every result printed above the line announcing its own roll, so it looked
 * like the result belonged to the roll announced below it.
 *
 * The `effect` handler now defers its log output through the effect-log buffer
 * and the `state` handler flushes it right after announcing the action.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { loadCardPool, describeAction, stripCardMarkers } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, DiceRollEffect, GameAction, PlayerId } from '@meccg/shared';
import { queueEffectLog, flushEffectLog, clearEffectLog, pendingEffectLogCount } from './effect-log-buffer.js';
import { diceRollLogLine, diceRollNotification } from './dice-roll-log.js';

const pool = loadCardPool();

const GLORFINDEL = 'tw-161' as CardDefinitionId;
const THEODEN = 'tw-182' as CardDefinitionId;
const GLORFINDEL_INSTANCE = 'p2-102' as CardInstanceId;
const THEODEN_INSTANCE = 'p2-108' as CardInstanceId;
const ROLLER = 'p2' as PlayerId;
const ROLLER_NAME = 'AI-Real';
const VIEWER_NAME = 'wigy';

const lookup = (id: CardInstanceId): CardDefinitionId | undefined =>
  id === GLORFINDEL_INSTANCE ? GLORFINDEL : id === THEODEN_INSTANCE ? THEODEN : undefined;

/** The seq-103 / seq-104 corruption-check actions from the reported game. */
const corruptionCheck = (characterId: CardInstanceId, corruptionPoints: number): GameAction => ({
  type: 'corruption-check',
  player: ROLLER,
  characterId,
  corruptionPoints,
  corruptionModifier: 0,
  possessions: [],
});

/** The dice-roll effect the reducer emits for that check. */
const rollEffect = (label: string, die1: 1 | 2 | 3 | 4 | 5 | 6, die2: 1 | 2 | 3 | 4 | 5 | 6): DiceRollEffect => ({
  effect: 'dice-roll',
  playerName: ROLLER_NAME,
  die1,
  die2,
  label,
});

describe('text-log ordering of dice rolls (game ms1vaegk-e4fvuf, seq 103-104)', () => {
  beforeEach(() => {
    clearEffectLog();
  });

  test('a roll result is logged after the action that announced the roll', () => {
    const lines: string[] = [];

    // The server sends the dice-roll effect first — it must not be logged yet,
    // otherwise the result outruns the line announcing the check.
    const effect = rollEffect('Corruption: Glorfindel II', 5, 5);
    queueEffectLog(() => {
      const notification = diceRollNotification(effect, VIEWER_NAME, ROLLER_NAME);
      if (notification) lines.push(`${ROLLER_NAME}: ${notification.message}`);
    });
    expect(lines).toEqual([]);
    expect(pendingEffectLogCount()).toBe(1);

    // ...then the state message: the client announces the action, then flushes.
    const action = corruptionCheck(GLORFINDEL_INSTANCE, 4);
    lines.push(`${ROLLER_NAME}: ${stripCardMarkers(describeAction(action, pool, lookup, {}, { [ROLLER as string]: ROLLER_NAME }))}`);
    flushEffectLog();

    expect(lines).toEqual([
      'AI-Real: Corruption check for Glorfindel II (CP 4)',
      'AI-Real: rolled 5 + 5 = 10 (Corruption: Glorfindel II)',
    ]);
    expect(pendingEffectLogCount()).toBe(0);
  });

  test('back-to-back checks keep each roll under its own announcement', () => {
    const lines: string[] = [];
    const checks: [CardInstanceId, number, DiceRollEffect][] = [
      [GLORFINDEL_INSTANCE, 4, rollEffect('Corruption: Glorfindel II', 5, 5)],
      [THEODEN_INSTANCE, 3, rollEffect('Corruption: Théoden', 6, 2)],
    ];

    for (const [characterId, cp, effect] of checks) {
      queueEffectLog(() => lines.push(diceRollLogLine(effect)));
      const action = corruptionCheck(characterId, cp);
      lines.push(stripCardMarkers(describeAction(action, pool, lookup, {}, { [ROLLER as string]: ROLLER_NAME })));
      flushEffectLog();
    }

    expect(lines).toEqual([
      'Corruption check for Glorfindel II (CP 4)',
      'Corruption: Glorfindel II: AI-Real rolled 5 + 5 = 10',
      'Corruption check for Théoden (CP 3)',
      'Corruption: Théoden: AI-Real rolled 6 + 2 = 8',
    ]);
  });

  test('the player who rolled gets no duplicate roll line in the message panel', () => {
    // wigy's own roll animates on their own dice — only the opponent's rolls
    // need a text entry. CvCC strikes (which carry a total) are the exception.
    expect(diceRollNotification(rollEffect('Corruption: Glorfindel II', 5, 5), ROLLER_NAME, VIEWER_NAME)).toBeNull();
  });
});
