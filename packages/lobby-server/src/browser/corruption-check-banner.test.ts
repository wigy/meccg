import { describe, it, expect } from 'vitest';
import type { CorruptionCheckAction, CardInstanceId, PlayerId } from '@meccg/shared';
import { corruptionCheckBannerText, freeCouncilPendingCheckBannerText } from './corruption-check-banner.js';

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

/**
 * Regression test for game mvufyzxp-jo2x5r (seq 2274-2277, Free Council):
 * once a check is declared only support taps and "Roll" are offered, so no
 * banner named the character rolling and the supporters glowed exactly like
 * the characters offered for checking — the player could not tell who was
 * rolling and who was supporting whom.
 */
describe('freeCouncilPendingCheckBannerText', () => {
  const pending = { corruptionPoints: 0, corruptionModifier: -1, explanation: 'Need roll > 1 (CP 0, modifier -1)', supportCount: 0 };

  it('names the rolling character and tells the owner how to support', () => {
    const text = freeCouncilPendingCheckBannerText(pending, 'Gandalf', true, true);
    expect(text.title).toBe('Corruption Check — Gandalf is rolling');
    expect(text.detail).toContain('Need roll > 1 (CP 0, modifier -1)');
    expect(text.detail).toContain('No support yet');
    expect(text.detail).toContain("characters in Gandalf's company to tap them in support");
  });

  it('shows the support total and adjusted target after supporters tap', () => {
    const text = freeCouncilPendingCheckBannerText({ ...pending, supportCount: 2 }, 'Gandalf', true, false);
    expect(text.detail).toContain('Support +2');
    expect(text.detail).toContain('now need roll > -1');
    expect(text.detail).toContain('Click Roll');
  });

  it("marks the opponent's check without support instructions", () => {
    const text = freeCouncilPendingCheckBannerText(pending, 'Gandalf', false, false);
    expect(text.title).toBe("Opponent's Corruption Check — Gandalf is rolling");
    expect(text.detail).not.toContain('Click');
  });
});
