import { describe, it, expect } from 'vitest';
import type { OpposedRollAction, CardInstanceId, PlayerId } from '@meccg/shared';
import { opposedRollBannerText } from './opposed-roll-banner.js';
import { classifyActionKind } from './button-classification.js';

/**
 * Regression test for game mvgxzndp-aakfaf, seq 234-236: No More Nonsense
 * (le-210) resolved into an opposed roll, but the client showed neither a
 * "Roll" button nor any prompt — `opposed-roll` was not a bottom-tier
 * action and had no situation banner, so the player only advanced by
 * guessing to press Enter.
 */
function roll(characterId: string, explanation: string): OpposedRollAction {
  return {
    type: 'opposed-roll',
    player: 'p1' as PlayerId,
    characterId: characterId as CardInstanceId,
    explanation,
  };
}

describe('opposed roll prompt', () => {
  it('surfaces opposed-roll as a bottom-tier button action', () => {
    expect(classifyActionKind('opposed-roll')).toBe('end-of-phase');
  });

  it('names the source card and shows the contest breakdown', () => {
    const explanation = 'No More Nonsense: roll for Lieutenant of Angmar (roll + prowess 8)';
    expect(opposedRollBannerText([roll('p1-235', explanation)])).toEqual({
      title: 'Opposed Roll — No More Nonsense',
      detail: `${explanation} — click Roll to roll the dice`,
    });
  });

  it('returns null when no opposed roll is pending', () => {
    expect(opposedRollBannerText([])).toBeNull();
  });
});
