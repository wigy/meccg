/**
 * @module no-more-nonsense-opponent-choice.test
 *
 * Regression test for bug report aab3bc7f302b4714: No More Nonsense (le-210)
 * makes the leader roll against "another character in the company" of the
 * player's choice, so the engine emits one `play-permanent-event` legal action
 * per (leader, opposed character) pair. The board renderer's character-click
 * handler resolved the click with a first-match lookup, so clicking the leader
 * always fired the first opponent — in game mvh8ymi4-k9gs20 seq 272 Lieutenant
 * of Angmar was always opposed by Old Troll even though Tûma, Ulkaur the
 * Tongueless, Squint-eyed Brute and Orc Veteran were also legal choices.
 * `findPermanentEventVariants` now returns every variant so the click handler
 * presents a menu naming each opposed character.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, GameAction } from '@meccg/shared';
import { findPermanentEventVariants, permanentEventVariantLabel } from './company-block.js';

const NO_MORE_NONSENSE = 'p1-39' as CardInstanceId;
const LIEUTENANT = 'p1-233' as CardInstanceId; // Lieutenant of Angmar, the leader
const ULKAUR = 'p1-238' as CardInstanceId; // Ulkaur the Tongueless, another leader
const OPPONENTS = ['p1-237', 'p1-10', 'p1-238', 'p1-240', 'p1-4'] as CardInstanceId[];

const NAMES: Record<string, string> = {
  'p1-237': 'Old Troll',
  'p1-10': 'Tûma',
  'p1-238': 'Ulkaur the Tongueless',
  'p1-240': 'Squint-eyed Brute',
  'p1-4': 'Orc Veteran',
};

/** The legal actions the engine emitted at seq 271 for Lieutenant of Angmar, plus one for Ulkaur. */
const actions: GameAction[] = [
  ...OPPONENTS.map(opposedCharacterId => ({
    type: 'play-permanent-event',
    player: 'p1',
    cardInstanceId: NO_MORE_NONSENSE,
    targetCharacterId: LIEUTENANT,
    opposedCharacterId,
  })),
  {
    type: 'play-permanent-event',
    player: 'p1',
    cardInstanceId: NO_MORE_NONSENSE,
    targetCharacterId: ULKAUR,
    opposedCharacterId: LIEUTENANT,
  },
] as GameAction[];

describe('No More Nonsense opposed-character choice is reachable in the UI', () => {
  test('every opposed character is surfaced for the clicked leader', () => {
    const found = findPermanentEventVariants(actions, NO_MORE_NONSENSE, LIEUTENANT);
    expect(found.map(a => a.opposedCharacterId)).toEqual(OPPONENTS);
  });

  test('each variant is labelled with the opposed character name', () => {
    const found = findPermanentEventVariants(actions, NO_MORE_NONSENSE, LIEUTENANT);
    const labels = found.map(a => permanentEventVariantLabel(a, id => NAMES[id as string] ?? (id as string)));
    expect(labels).toContain('Roll against Tûma');
    expect(labels).toContain('Roll against Old Troll');
    expect(new Set(labels).size).toBe(OPPONENTS.length);
  });
});
