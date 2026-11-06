/**
 * @module sideboard-intent-label.test
 *
 * Regression test for improvement report 2f48b5d377c5277a (game
 * mvyj33u2-pz06gw): the reporter, playing Pallando, never found how to tap
 * their avatar for sideboard access (CoE rule 2.II.6) during the
 * organization phase. The engine offered `start-sideboard-to-discard` and
 * `start-sideboard-to-deck` for the untapped Pallando at every one of their
 * organization phases, and the browser listed them in Pallando's click
 * menu — but only as "Fetch to Deck" / "Fetch to Discard", which never
 * mention the sideboard or the avatar tap. The labels now say both.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId, PlayerId } from '@meccg/shared';
import { sideboardIntentLabel } from './company-actions.js';

const player = 'p1' as PlayerId;
const avatar = 'p1-66' as CardInstanceId;

describe('sideboardIntentLabel (CoE 2.II.6 avatar sideboard access)', () => {
  test('to-deck intent names the tap, the sideboard and the single card limit', () => {
    const label = sideboardIntentLabel({ type: 'start-sideboard-to-deck', player, characterInstanceId: avatar });
    expect(label).toBe('Tap: Sideboard → Play Deck (1 card)');
  });

  test('to-discard intent names the tap, the sideboard and the five card limit', () => {
    const label = sideboardIntentLabel({ type: 'start-sideboard-to-discard', player, characterInstanceId: avatar });
    expect(label).toBe('Tap: Sideboard → Discard (up to 5)');
  });
});
