import { describe, it, expect } from 'vitest';
import type { GameAction, PlayerId, CardInstanceId } from '@meccg/shared';
import { combatButtonLabel, isCombatActionButton } from './combat-button-label.js';

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

/**
 * Regression test for bug report d7ecb98f2ae44a45 (game mtukrmxa-asilf1, seq
 * 880): "Je ne vois pas comment je peux annuler la seconde attaque" ("I don't
 * see how I can cancel the second attack"). Fifteen Birds in Five Firtrees
 * (dm-129) grants a `free-attack-cancel` constraint that the engine correctly
 * offers as a `cancel-attack` action with `mode: 'free-later-cancel'` against
 * the next non-unique hazard-creature attack — but that action's
 * `cardInstanceId` names the already-discarded granting card (kept only for
 * logging) and it has no `scoutInstanceId`/`targetCharacterId`, so neither the
 * hand-card click routing nor the old button-type allowlist ever surfaced it.
 * `isCombatActionButton` must route it into the generic button stack, and
 * `combatButtonLabel` must give it a clear label.
 */
describe('free-later-cancel cancel-attack (Fifteen Birds in Five Firtrees dm-129, Darkness Wielded ba-55)', () => {
  const PLAYER = 'p1' as PlayerId;

  const freeLaterCancelAction = (): GameAction => ({
    type: 'cancel-attack',
    player: PLAYER,
    cardInstanceId: 'p1-4' as CardInstanceId,
    mode: 'free-later-cancel',
  });

  it('is routed into the generic combat-action button stack', () => {
    expect(isCombatActionButton(freeLaterCancelAction())).toBe(true);
  });

  it('is labeled clearly as a free attack cancellation', () => {
    expect(combatButtonLabel(freeLaterCancelAction(), false)).toBe('Cancel Attack (Free)');
  });

  it('does not route an ordinary hand-played cancel-attack (no mode) into the button stack', () => {
    const handPlayed: GameAction = {
      type: 'cancel-attack',
      player: PLAYER,
      cardInstanceId: 'p1-9' as CardInstanceId,
    };
    expect(isCombatActionButton(handPlayed)).toBe(false);
  });
});
