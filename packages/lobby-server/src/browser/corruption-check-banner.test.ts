import { describe, it, expect } from 'vitest';
import type { CorruptionCheckAction, CardInstanceId, PlayerId } from '@meccg/shared';
import { corruptionCheckBannerText } from './corruption-check-banner.js';

/**
 * Regression test for the corruption-check banner (game muo4z4lp-da7ry2,
 * seq 834-835): Ren the Unclean (tw-83) forced corruption checks on all of
 * Gamling's characters with a player-chosen order (CoE 7.1.1), so the client
 * offered one check per character and (correctly) no "Roll" button. The
 * banner, however, still read "Corruption Check — <first character>",
 * pointing at an arbitrary character instead of telling the player to click
 * the one who should roll next.
 */
function check(characterId: string, explanation: string): CorruptionCheckAction {
  return {
    type: 'corruption-check',
    player: 'p1' as PlayerId,
    characterId: characterId as CardInstanceId,
    corruptionPoints: 3,
    corruptionModifier: 1,
    possessions: [],
    need: 3,
    explanation,
  };
}

const names: Record<string, string> = { 'p1-121': 'Aragorn II', 'p1-123': 'Legolas' };
const nameOf = (a: CorruptionCheckAction): string => names[a.characterId as string];

describe('corruptionCheckBannerText', () => {
  it('names the character when a single check is pending', () => {
    expect(corruptionCheckBannerText([check('p1-121', 'Ren the Unclean: need roll > 2 (CP 3, modifier +1)')], nameOf))
      .toEqual({ title: 'Corruption Check — Aragorn II', detail: 'Ren the Unclean: need roll > 2 (CP 3, modifier +1)' });
  });

  it('asks the player to choose when several checks are selectable', () => {
    const text = corruptionCheckBannerText([
      check('p1-121', 'Ren the Unclean: need roll > 2 (CP 3, modifier +1)'),
      check('p1-123', 'Ren the Unclean: need roll > 2 (CP 3, modifier +1)'),
    ], nameOf);
    expect(text?.title).toBe('Corruption Checks — Ren the Unclean');
    expect(text?.title).not.toContain('Aragorn II');
    expect(text?.detail).toContain('2 characters');
    expect(text?.detail).toContain('click a highlighted character');
  });

  it('omits the reason when the selectable checks have different reasons', () => {
    const text = corruptionCheckBannerText([
      check('p1-121', 'Lure of the Senses: need roll > 2 (CP 3)'),
      check('p1-123', 'Lure of Nature: need roll > 2 (CP 3)'),
    ], nameOf);
    expect(text?.title).toBe('Corruption Checks');
  });

  it('returns null when no check is pending', () => {
    expect(corruptionCheckBannerText([], nameOf)).toBeNull();
  });
});
