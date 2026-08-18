/**
 * @module pass-button-label
 *
 * Pure label logic for the bottom-bar pass/action button rendered in the
 * visual game view. Extracted from `render-instructions.ts`, mirroring
 * {@link module:combat-button-label}, so the label rules are unit-testable
 * without a DOM environment.
 *
 * Generic branches (steps whose only legal action is a plain `PassAction`)
 * used to all collapse onto the same "Pass"/"Continue"/"Done" text, so two
 * genuinely different steps (e.g. Movement/Hazard's `draw-cards` and
 * `play-hazards`) rendered an identical button in an identical screen
 * position with no cue that a new step had begun — players could not tell
 * what they were actually agreeing to skip. Every generic branch below now
 * names what it passes, e.g. "Pass Draw" vs "Pass Hazards".
 */
import type { GameAction, PlayerView } from '@meccg/shared';
import { Phase } from '@meccg/shared';

/**
 * Short label for the bottom-bar pass/action button.
 *
 * `passAction` is the resolved pass-like action (see `renderPassButton`'s
 * whitelist) the button sends when clicked. Most of its branches are
 * action-type specific (e.g. "Draw", "Roll") and unambiguous regardless of
 * phase. The remaining branches cover a literal `PassAction`
 * (`{type: 'pass'}`), whose label depends entirely on which phase/step is
 * being passed — those read `view.phaseState` to name the step being
 * skipped. The secondary pass button (always a literal `pass` action) also
 * goes through this function, so it gets the same step-aware wording as the
 * primary button.
 */
export function passButtonLabel(passAction: GameAction, view: PlayerView): string {
  if (passAction.type === 'draft-stop') return 'Done';
  if (passAction.type === 'shuffle-play-deck') return 'Shuffle';
  if (passAction.type === 'draw-cards') return 'Draw';
  if (passAction.type === 'roll-initiative') return 'Roll';
  if (passAction.type === 'corruption-check') return 'Roll';
  if (passAction.type === 'faction-influence-roll') return 'Roll';
  if (passAction.type === 'under-deeps-roll') return 'Roll';
  if (passAction.type === 'deck-exhaust') return 'Exhaust';
  if (passAction.type === 'finished') return 'Finished';
  if (passAction.type === 'untap') return 'Untap';
  if (passAction.type === 'opponent-influence-defend') return 'Roll Defense';
  if (passAction.type === 'resolve-dice-check') return 'Roll';
  if (passAction.type === 'flattery-attempt') return 'Roll';
  if (passAction.type === 'seized-by-terror-roll') return 'Roll';
  if (passAction.type === 'gold-ring-test-roll') return 'Roll';
  if (passAction.type === 'pass-chain-priority') return 'Pass Priority';

  // Rule 9.21's ring-play-offer: the plain `pass` here declines playing the
  // offered special ring, not the ordinary end-of-phase pass it would
  // otherwise be read as (e.g. "Long-event" during Organization) — without
  // this the button read as an unrelated phase-advance action and the
  // player had no visible way to decline the ring.
  if (passAction.type === 'pass'
    && view.legalActions.some(ea => ea.viable && ea.action.type === 'play-ring-after-test')) {
    return 'Skip Ring';
  }

  if (view.phaseState.phase === Phase.Untap) return 'End Untap';
  if (view.phaseState.phase === Phase.Organization) return 'Long-event';
  if (view.phaseState.phase === Phase.LongEvent) return 'Movement/Hazard';

  if (view.phaseState.phase === Phase.MovementHazard) {
    switch (view.phaseState.step) {
      case 'set-hazard-limit': return 'Continue';
      case 'draw-cards': return 'Pass Draw';
      // Name what's actually being given up: clicking Pass looks harmless
      // from the all-companies overview, but ends hazard opportunities
      // against whichever company is currently active. The remaining
      // hazard limit is shown by the HL box, not repeated here.
      case 'play-hazards': return 'Pass Hazards';
      case 'reset-hand': return 'Continue';
      default: return 'Continue';
    }
  }

  if (view.phaseState.phase === Phase.Site) {
    switch (view.phaseState.step) {
      case 'enter-or-skip': return 'Skip';
      case 'play-resources': return 'Pass Resources';
      case 'play-minor-item': return 'Pass Minor Item';
      case 'declare-company-attack': {
        const hasAttack = view.legalActions.some(ea => ea.viable && ea.action.type === 'declare-company-attack');
        return hasAttack ? 'Skip CvCC' : 'Pass Attack';
      }
      default: return 'Continue';
    }
  }

  if (view.phaseState.phase === Phase.EndOfTurn) {
    switch (view.phaseState.step) {
      case 'discard': return 'Done';
      // Movement/Hazard has its own unrelated `reset-hand` step (per-company
      // hazard-phase draw/discard) that also renders "Continue" — without a
      // distinct label here, a player finishing MH's reset-hand could
      // mistake it for already being in End-of-Turn's reset-hand (CoE
      // 2.VI.ii hand-size reconciliation), where different actions (e.g.
      // Huntsman's Garb's end-of-turn fetch) become legal.
      case 'reset-hand': return 'Reconcile Hand';
      case 'signal-end': return 'End Turn';
      default: return 'Continue';
    }
  }

  if (view.phaseState.phase === Phase.FreeCouncil) {
    // "Roll" during support window (pendingCheck is set), "Done" otherwise
    const hasSupportActions = view.legalActions.some(ea => ea.viable && ea.action.type === 'support-corruption-check');
    return hasSupportActions ? 'Roll' : 'Done';
  }

  if (view.phaseState.phase === 'setup') {
    const step = view.phaseState.setupStep.step;
    if (step === 'item-draft') return 'Continue';
    if (step === 'character-deck-draft') return 'Done';
    if (step === 'starting-site-selection') return 'Continue';
    if (step === 'character-placement') return 'Done';
    return 'Pass';
  }

  return 'Done';
}
