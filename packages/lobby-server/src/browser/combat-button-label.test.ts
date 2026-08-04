import { describe, it, expect } from 'vitest';
import type { GameAction, PlayerId } from '@meccg/shared';
import { combatButtonLabel } from './combat-button-label.js';

/**
 * Regression tests for resolve-strike button labels.
 *
 * Bug report (game mqxur28y-to5dzj, seq 78): a wounded character (Layos, le-19)
 * facing a strike showed the button "Tapping", and an untapped character's
 * (Balin, tw-123) -3 option showed "Not tapping". Per the CoE rules a wounded
 * character cannot tap (3.iv.6) — its only option is to face the strike without
 * tapping ("Not tapping") — and the -3 option keeps an untapped character
 * untapped after the strike (3.iv.3), so it must read "Untapped".
 *
 * The label key is whether the engine offered the "stay untapped" (-3) option:
 * it is only ever present for an untapped character.
 */
describe('combatButtonLabel for resolve-strike', () => {
  const PLAYER = 'p1' as PlayerId;

  const tapAction = (): GameAction => ({
    type: 'resolve-strike',
    player: PLAYER,
    tapToFight: true,
    need: 9,
    explanation: 'Tapped: need 9+ (prowess 1 vs 9)',
  });

  const stayUntappedAction = (): GameAction => ({
    type: 'resolve-strike',
    player: PLAYER,
    tapToFight: false,
    need: 12,
    explanation: 'Untapped: need 12+ (prowess -2 vs 9)',
  });

  it('labels the tap-to-fight option "Tapping" when the character is untapped (stay-untapped option present)', () => {
    expect(combatButtonLabel(tapAction(), true)).toBe('Tapping');
  });

  it('labels the -3 option "Untapped" (keeps an untapped character untapped, CoE 3.iv.3)', () => {
    expect(combatButtonLabel(stayUntappedAction(), true)).toBe('Untapped');
  });

  it('labels the sole option "Not tapping" for a wounded/tapped character (no stay-untapped option, CoE 3.iv.6)', () => {
    // A wounded character cannot tap, so the engine offers only tapToFight:true
    // and no -3 "stay untapped" sibling. The button must read "Not tapping".
    expect(combatButtonLabel(tapAction(), false)).toBe('Not tapping');
  });
});

/**
 * Regression test for bug report 73deca14307b4922 (game msd5rpsh-fhc6rm,
 * seq ~1363): "Swift Strokes always triggers character tapping when used ->
 * no choice to stay untapped". The engine correctly offers both `tapToFight`
 * variants for reroll-mode strike-modifier cards (le-238.test.ts), but
 * `combatButtonLabel` only recognized `resolve-strike`, so a disambiguation
 * menu built from `play-strike-event` actions had no way to label the two
 * choices distinctly.
 */
describe('combatButtonLabel for play-strike-event (reroll mode, e.g. Swift Strokes)', () => {
  const PLAYER = 'p1' as PlayerId;

  const rerollTapAction = (): GameAction => ({
    type: 'play-strike-event',
    player: PLAYER,
    cardInstanceId: 'p1-31' as never,
    tapToFight: true,
    need: 5,
    explanation: 'Reroll (tapped): need 5+ (prowess 6 vs 10, better of two rolls, +1)',
  });

  const rerollStayUntappedAction = (): GameAction => ({
    type: 'play-strike-event',
    player: PLAYER,
    cardInstanceId: 'p1-31' as never,
    tapToFight: false,
    need: 8,
    explanation: 'Reroll (stay untapped): need 8+ (prowess 3 vs 10, better of two rolls, +1)',
  });

  it('labels the tap-to-fight reroll variant "Tapping" when the stay-untapped sibling is present', () => {
    expect(combatButtonLabel(rerollTapAction(), true)).toBe('Tapping');
  });

  it('labels the stay-untapped reroll variant "Untapped"', () => {
    expect(combatButtonLabel(rerollStayUntappedAction(), true)).toBe('Untapped');
  });
});
