import { describe, it, expect } from 'vitest';
import type { EvaluatedAction } from '@meccg/shared';
import { Phase } from '@meccg/shared';
import {
  shouldOverrideToAllCompanies,
  shouldFocusOwnCompanyAfterSelectCompany,
  shouldResetFocusOnOpponentCompanyAdvance,
  shouldClearOverrideForNewCombat,
  shouldRestoreOverrideAfterCombat,
  isCombatBlockedByPendingCorruptionCheck,
  handStaysVisibleDuringOverview,
} from './company-view-state.js';

/**
 * Regression tests for the turn-change focus decision.
 *
 * Bug report (game mqtbg9mu-u4g9gt, seq 33): when the opponent has the first
 * turn of the game, the local player was dropped into the all-companies overview
 * instead of focusing the opponent's single starting company. The game-start
 * case must keep the override off so the downstream auto-focus lands on the
 * opponent's company in single-company view.
 */
describe('shouldOverrideToAllCompanies', () => {
  const SELF = 'p1';
  const OPPONENT = 'p2';

  it('does NOT force the overview when the opponent has the first turn (game start)', () => {
    // lastActivePlayer === null marks the very start of the game.
    expect(shouldOverrideToAllCompanies(OPPONENT, null, SELF)).toBe(false);
  });

  it('does NOT force the overview when the local player has the first turn', () => {
    expect(shouldOverrideToAllCompanies(SELF, null, SELF)).toBe(false);
  });

  it('forces the overview when it becomes the opponent\'s turn mid-game', () => {
    expect(shouldOverrideToAllCompanies(OPPONENT, SELF, SELF)).toBe(true);
  });

  it('does NOT force the overview when it becomes the local player\'s turn mid-game', () => {
    expect(shouldOverrideToAllCompanies(SELF, OPPONENT, SELF)).toBe(false);
  });

  it('does NOT force the overview when there is no active player', () => {
    expect(shouldOverrideToAllCompanies(null, OPPONENT, SELF)).toBe(false);
  });
});

/**
 * Regression tests for bug report a0b96ce4a3e16820 (game msd9dixh-m9voxl, seq
 * 721): "l'agent a disparu je ne le vois plus sur la surface de jeu" — after
 * playing Pôn-ora-Pôn (dm-22) as an agent hazard during the opponent's
 * movement/hazard phase, the agent never appeared anywhere on the board.
 *
 * Root cause: the select-company → next-step auto-focus fired regardless of
 * whose turn it was, kicking the hazard player out of the all-companies
 * overview (forced on for the whole opponent turn by
 * shouldOverrideToAllCompanies) and into single-company view focused on the
 * opponent's active company — the only view that never renders self.agents.
 */
describe('shouldFocusOwnCompanyAfterSelectCompany', () => {
  const SELF = 'p1';
  const OPPONENT = 'p2';

  it('does NOT focus a company on the opponent\'s turn (stays in the all-companies overview)', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'play-hazards', OPPONENT, SELF)).toBe(false);
  });

  it('focuses the active company on our own turn', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'draw-cards', SELF, SELF)).toBe(true);
  });

  it('does NOT focus when the previous step was not select-company', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('draw-cards', 'play-hazards', SELF, SELF)).toBe(false);
  });

  it('does NOT focus when still in the select-company step', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'select-company', SELF, SELF)).toBe(false);
  });

  it('does NOT focus when there is no active player', () => {
    expect(shouldFocusOwnCompanyAfterSelectCompany('select-company', 'draw-cards', null, SELF)).toBe(false);
  });
});

/**
 * Regression tests for bug report 97754b4edc722de1 (game msq1wzcy-gwjpmx,
 * turn 3, opponent movement/hazard phase): "After playing hazard on the
 * first company (Haz.Lim 3), it gives a pass hazards... I clicked the
 * button, but it didn't disappear... realising it had moved to the next
 * company already... I could not play hazard on that one any more."
 *
 * The hazard player can click an opponent company block to bring it into
 * single-company view (see opponent-company-focus-click.test.ts). Once both
 * players pass the play-hazards step, `activeCompanyIndex` advances to the
 * next company, but nothing reset the stale single-company focus — the
 * player was left looking at a dead view for a company whose hazard window
 * had already closed, with no visible cue that the turn had moved on.
 */
describe('shouldResetFocusOnOpponentCompanyAdvance', () => {
  const SELF = 'p1';
  const OPPONENT = 'p2';

  it('resets focus when the opponent\'s active company advances', () => {
    expect(shouldResetFocusOnOpponentCompanyAdvance(true, 0, 1, OPPONENT, SELF)).toBe(true);
  });

  it('does NOT reset when the active company index is unchanged', () => {
    expect(shouldResetFocusOnOpponentCompanyAdvance(true, 0, 0, OPPONENT, SELF)).toBe(false);
  });

  it('does NOT reset when we are not focused on an opponent company', () => {
    expect(shouldResetFocusOnOpponentCompanyAdvance(false, 0, 1, OPPONENT, SELF)).toBe(false);
  });

  it('does NOT reset on our own turn', () => {
    expect(shouldResetFocusOnOpponentCompanyAdvance(true, 0, 1, SELF, SELF)).toBe(false);
  });

  it('does NOT reset when there was no previous index (just entered the phase)', () => {
    expect(shouldResetFocusOnOpponentCompanyAdvance(true, null, 0, OPPONENT, SELF)).toBe(false);
  });

  it('does NOT reset when there is no active player', () => {
    expect(shouldResetFocusOnOpponentCompanyAdvance(true, 0, 1, null, SELF)).toBe(false);
  });
});

/**
 * Regression tests for bug report 7ff9464e440e22ed (game msenkvsc-3y5o11, seq
 * 581): "When opponnent moves it is staying in the overview screen, not
 * showing the party and my cards". The opponent's movement/hazard phase
 * forces the all-companies overview on for the whole turn (so self-agents
 * stay visible), but a hazard-triggered strike/body-check needs the combat
 * view instead — and the overview's CSS hides the local player's hand. The
 * override must be cleared the moment a new combat starts.
 */
describe('shouldClearOverrideForNewCombat', () => {
  it('clears the override when a new combat starts', () => {
    expect(shouldClearOverrideForNewCombat(true, false)).toBe(true);
  });

  it('does NOT clear the override on a re-render while combat is still ongoing', () => {
    expect(shouldClearOverrideForNewCombat(true, true)).toBe(false);
  });

  it('does NOT clear the override when there is no combat', () => {
    expect(shouldClearOverrideForNewCombat(false, false)).toBe(false);
  });

  it('does NOT clear the override when combat just ended', () => {
    expect(shouldClearOverrideForNewCombat(false, true)).toBe(false);
  });
});

/**
 * Regression tests for bug report ed948ef8e9ec6c8f (game mshkjqbp-4pszaj, seq
 * 403): "Update not seeing Opp. Company" — an automatic attack at a site
 * during the opponent's turn correctly clears the all-companies override so
 * the combat view can take over, but nothing restored the override once the
 * automatic attack resolved. The render was left stuck in single-company
 * view (focused on whichever company fought) for the rest of the opponent's
 * turn, hiding the opponent's other companies from the overview.
 *
 * Also covers the follow-up feature request ("Stop the view jumping back to
 * overview"): the restore must only fire when the all-companies override was
 * already active (auto-forced) before the interrupting combat started. When
 * the player had manually focused a specific opponent company before playing
 * a creature/attacking hazard, the resulting combat must not force them back
 * to the overview once it resolves.
 */
describe('shouldRestoreOverrideAfterCombat', () => {
  const SELF = 'p1';
  const OPPONENT = 'p2';

  it('restores the override when combat ends mid-opponent-turn and the override was active before combat', () => {
    expect(shouldRestoreOverrideAfterCombat(false, true, OPPONENT, SELF, true)).toBe(true);
  });

  it('does NOT restore when the override was NOT active before combat (manually focused company)', () => {
    expect(shouldRestoreOverrideAfterCombat(false, true, OPPONENT, SELF, false)).toBe(false);
  });

  it('does NOT restore when combat is still active', () => {
    expect(shouldRestoreOverrideAfterCombat(true, true, OPPONENT, SELF, true)).toBe(false);
  });

  it('does NOT restore when combat was not active last render', () => {
    expect(shouldRestoreOverrideAfterCombat(false, false, OPPONENT, SELF, true)).toBe(false);
  });

  it('does NOT restore on our own turn', () => {
    expect(shouldRestoreOverrideAfterCombat(false, true, SELF, SELF, true)).toBe(false);
  });

  it('does NOT restore when there is no active player', () => {
    expect(shouldRestoreOverrideAfterCombat(false, true, null, SELF, true)).toBe(false);
  });
});

/**
 * Regression tests for bug report cd1a91ecd6df95b2 (game mslxt32k-vsylze, seq
 * 1085): "it force a CP on all characters, but it is not clear who's roll it
 * is. So no support tap or friend of three to play easily." Corpse-candle
 * (tw-23/le-67) forces "every character in the company makes a corruption
 * check before defending characters are selected" — the engine sets
 * `combat.phase` to 'assign-strikes' immediately, before those pre-defense
 * checks resolve, so `view.combat` is already non-null while the checks are
 * still pending. The company view unconditionally ceded to the combat arena
 * whenever `view.combat` was set, hiding the corruption-check banner naming
 * the checking character, the per-character tap-in-support buttons (CoE
 * 7.1.1), and reactive short-event plays (e.g. A Friend or Three) — all of
 * which only render in the company view.
 */
describe('isCombatBlockedByPendingCorruptionCheck', () => {
  const corruptionCheckAction: EvaluatedAction = {
    action: {
      type: 'corruption-check',
      player: 'p1',
      characterId: 'p1-107',
      corruptionPoints: 1,
      corruptionModifier: 0,
      possessions: [],
      need: 2,
      explanation: 'Corpse-candle: need roll > 1 (CP 1)',
    },
    viable: true,
  } as unknown as EvaluatedAction;

  const supportCorruptionCheckAction: EvaluatedAction = {
    action: {
      type: 'support-corruption-check',
      player: 'p1',
      supportingCharacterId: 'p1-108',
      targetCharacterId: 'p1-107',
    },
    viable: true,
  } as unknown as EvaluatedAction;

  const assignStrikeAction: EvaluatedAction = {
    action: { type: 'assign-strike', player: 'p1', characterId: 'p1-107', tapped: false },
    viable: true,
  } as unknown as EvaluatedAction;

  it('blocks the combat view when a corruption-check action is pending', () => {
    expect(isCombatBlockedByPendingCorruptionCheck([corruptionCheckAction])).toBe(true);
  });

  it('blocks the combat view when a support-corruption-check action is pending', () => {
    expect(isCombatBlockedByPendingCorruptionCheck([supportCorruptionCheckAction])).toBe(true);
  });

  it('does NOT block the combat view once only assign-strike actions remain', () => {
    expect(isCombatBlockedByPendingCorruptionCheck([assignStrikeAction])).toBe(false);
  });

  it('does NOT block on a non-viable corruption-check action', () => {
    const nonViable = { ...corruptionCheckAction, viable: false };
    expect(isCombatBlockedByPendingCorruptionCheck([nonViable])).toBe(false);
  });

  it('does NOT block when there are no legal actions', () => {
    expect(isCombatBlockedByPendingCorruptionCheck([])).toBe(false);
  });
});

/**
 * Regression test for bug report 1a19775ad8f882a0 (game msosuz1s-y1tnx9, seq
 * 1115): "I have a Friend of Tree (I think) but my hand is no longer
 * visible." During Free Council corruption checks, the all-companies overview
 * is forced on for the whole phase (so support taps across every company
 * stay reachable) and public/style.css hides `#hand-arc` whenever
 * `all-companies-mode` is set on `document.body`. That left CoE 10.3.i's
 * reactive hand plays — e.g. A Friend or Three's corruption-check-boost,
 * which the player had legally available for this exact check — completely
 * unreachable: the card was in hand but never rendered, so it could never be
 * clicked.
 */
describe('handStaysVisibleDuringOverview', () => {
  it('keeps the hand-arc visible during Free Council so reactive plays (CoE 10.3.i) stay reachable', () => {
    expect(handStaysVisibleDuringOverview(Phase.FreeCouncil)).toBe(true);
  });

  it('does NOT keep the hand-arc visible during the opponent-turn overview outside Free Council', () => {
    expect(handStaysVisibleDuringOverview(Phase.MovementHazard)).toBe(false);
  });
});
