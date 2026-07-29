/**
 * @module render-instructions
 *
 * Renders the pass/action button in the visual game view. Phase-step
 * instruction text was removed (it duplicated the phase meter); the only
 * surviving guidance — live targeting hints — now renders inside the phase
 * meter breadcrumb (see {@link module:render-phase-meter}).
 */

import type { PlayerView, GameAction } from '@meccg/shared';
import { Phase } from '@meccg/shared';
import { appState } from './app-state.js';

/** Render the pass/stop button in the visual view if a pass-like action is available. */
export function renderPassButton(view: PlayerView, onAction: (action: GameAction) => void): void {
  const btn = document.getElementById('pass-btn') as HTMLButtonElement | null;
  if (!btn) return;

  // Remove all dynamic buttons from previous renders before rebuilding from
  // the current legal actions. This prevents stale buttons when the early
  // return (no pass action) skips the conditional re-creation below.
  document.getElementById('enter-site-btn')?.remove();
  document.getElementById('secondary-pass-btn')?.remove();
  document.getElementById('call-council-btn')?.remove();
  document.getElementById('skip-cvcc-btn')?.remove();
  document.querySelectorAll('.hazard-sb-btn').forEach(b => b.remove());

  // Spectators never act: hide both the pass button and the "Waiting…" box
  // (which would otherwise show permanently, since they have no legal actions).
  if (appState.spectating) {
    btn.classList.add('hidden');
    document.getElementById('waiting-indicator')?.classList.add('hidden');
    return;
  }

  // Find a viable pass-like or single-step action (including chain priority pass)
  const passEval = view.legalActions.find(ea =>
    ea.viable && (ea.action.type === 'pass' || ea.action.type === 'draft-stop'
    || ea.action.type === 'shuffle-play-deck' || ea.action.type === 'draw-cards'
    || ea.action.type === 'roll-initiative' || ea.action.type === 'corruption-check'
    || ea.action.type === 'faction-influence-roll' || ea.action.type === 'under-deeps-roll'
    || ea.action.type === 'pass-chain-priority' || ea.action.type === 'deck-exhaust'
    || ea.action.type === 'finished' || ea.action.type === 'untap'
    || ea.action.type === 'opponent-influence-defend'));
  const passAction = passEval?.action;
  const waitingEl = document.getElementById('waiting-indicator');
  if (!passAction) {
    btn.classList.add('hidden');
    const hasViable = view.legalActions.some(ea => ea.viable);
    waitingEl?.classList.toggle('hidden', hasViable);
    return;
  }
  waitingEl?.classList.add('hidden');

  // Choose label based on action type and phase
  let label = 'Done';
  if (passAction.type === 'pass-chain-priority') {
    label = 'Pass Priority';
  } else if (passAction.type === 'draft-stop') {
    label = 'Done';
  } else if (passAction.type === 'shuffle-play-deck') {
    label = 'Shuffle';
  } else if (passAction.type === 'draw-cards') {
    label = 'Draw';
  } else if (passAction.type === 'roll-initiative') {
    label = 'Roll';
  } else if (passAction.type === 'corruption-check') {
    label = 'Roll';
  } else if (passAction.type === 'faction-influence-roll') {
    label = 'Roll';
  } else if (passAction.type === 'under-deeps-roll') {
    label = 'Roll';
  } else if (passAction.type === 'deck-exhaust') {
    label = 'Exhaust';
  } else if (passAction.type === 'finished') {
    label = 'Finished';
  } else if (passAction.type === 'untap') {
    label = 'Untap';
  } else if (passAction.type === 'opponent-influence-defend') {
    label = 'Roll Defense';
  } else if (view.phaseState.phase === Phase.Untap) {
    label = 'Pass';
  } else if (view.phaseState.phase === Phase.Organization) {
    label = 'Long-event';
  } else if (view.phaseState.phase === Phase.LongEvent) {
    label = 'Movement/Hazard';
  } else if (view.phaseState.phase === Phase.MovementHazard) {
    switch (view.phaseState.step) {
      case 'set-hazard-limit': label = 'Continue'; break;
      case 'draw-cards': label = 'Continue'; break;
      case 'play-hazards': label = 'Pass'; break;
      case 'reset-hand': label = 'Continue'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.Site) {
    switch (view.phaseState.step) {
      case 'enter-or-skip': label = 'Skip'; break;
      case 'play-resources': label = 'Pass'; break;
      case 'play-minor-item': label = 'Pass'; break;
      case 'declare-company-attack': {
        const hasAttack = view.legalActions.some(ea => ea.viable && ea.action.type === 'declare-company-attack');
        label = hasAttack ? 'Skip CvCC' : 'Pass';
        break;
      }
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.EndOfTurn) {
    switch (view.phaseState.step) {
      case 'discard': label = 'Done'; break;
      case 'signal-end': label = 'Finished'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.FreeCouncil) {
    // "Roll" during support window (pendingCheck is set), "Done" otherwise
    const hasSupportActions = view.legalActions.some(ea => ea.viable && ea.action.type === 'support-corruption-check');
    label = hasSupportActions ? 'Roll' : 'Done';
  } else if (view.phaseState.phase === 'setup') {
    const step = view.phaseState.setupStep.step;
    if (step === 'item-draft') label = 'Continue';
    else if (step === 'character-deck-draft') label = 'Done';
    else if (step === 'starting-site-selection') label = 'Continue';
    else if (step === 'character-placement') label = 'Done';
    else label = 'Pass';
  }

  btn.textContent = label;
  btn.classList.remove('hidden');
  btn.onclick = () => onAction(passAction);

  const panel = btn.parentElement;

  // When the primary button is a non-pass action (e.g. Draw) and a pass action
  // also exists, show a secondary Pass button so both options are available.
  if (passAction.type !== 'pass' && passAction.type !== 'pass-chain-priority') {
    const secondaryPass = view.legalActions.find(ea => ea.viable && ea.action.type === 'pass');
    if (secondaryPass) {
      const passBtn2 = document.createElement('button');
      passBtn2.id = 'secondary-pass-btn';
      passBtn2.className = 'enter-site-btn'; // reuse same styling
      passBtn2.textContent = 'Pass';
      passBtn2.onclick = () => onAction(secondaryPass.action);
      panel?.appendChild(passBtn2);
    }
  }

  // During untap phase, add hazard sideboard buttons for the hazard player
  if (view.phaseState.phase === Phase.Untap && view.activePlayer !== view.self.id) {
    const toDiscardEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'start-hazard-sideboard-to-discard');
    if (toDiscardEval) {
      const toDiscardBtn = document.createElement('button');
      toDiscardBtn.className = 'enter-site-btn hazard-sb-btn';
      toDiscardBtn.textContent = 'Hazards to Discard';
      toDiscardBtn.onclick = () => onAction(toDiscardEval.action);
      panel?.appendChild(toDiscardBtn);
    }
    const toDeckEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'start-hazard-sideboard-to-deck');
    if (toDeckEval) {
      const toDeckBtn = document.createElement('button');
      toDeckBtn.className = 'enter-site-btn hazard-sb-btn';
      toDeckBtn.textContent = 'Hazard to Deck';
      toDeckBtn.onclick = () => onAction(toDeckEval.action);
      panel?.appendChild(toDeckBtn);
    }
  }

  // During signal-end, add a "Call Council" button if available
  if (view.phaseState.phase === Phase.EndOfTurn && view.phaseState.step === 'signal-end') {
    const councilEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'call-free-council');
    if (councilEval) {
      const councilBtn = document.createElement('button');
      councilBtn.id = 'call-council-btn';
      councilBtn.className = 'enter-site-btn';
      councilBtn.textContent = 'Call Council';
      councilBtn.onclick = () => onAction(councilEval.action);
      panel?.appendChild(councilBtn);
    }
  }

  // During declare-company-attack, render Attack button(s) for each target.
  // With one target the Attack button becomes primary (most expected action),
  // and Skip CvCC is demoted to a secondary slot. With multiple targets all
  // Attack buttons are added as secondary slots alongside the Skip CvCC primary.
  if (!view.combat && view.phaseState.phase === Phase.Site && view.phaseState.step === 'declare-company-attack') {
    const attackEvals = view.legalActions.filter(
      ea => ea.viable && ea.action.type === 'declare-company-attack',
    );
    if (attackEvals.length === 1) {
      btn.textContent = 'Attack';
      btn.onclick = () => onAction(attackEvals[0].action);

      const skipBtn = document.createElement('button');
      skipBtn.id = 'skip-cvcc-btn';
      skipBtn.className = 'enter-site-btn';
      skipBtn.textContent = 'Skip CvCC';
      skipBtn.onclick = () => onAction(passAction);
      panel?.appendChild(skipBtn);
    } else if (attackEvals.length > 1) {
      for (const atk of attackEvals) {
        const attackBtn = document.createElement('button');
        attackBtn.className = 'enter-site-btn';
        attackBtn.textContent = 'Attack';
        attackBtn.onclick = () => onAction(atk.action);
        panel?.appendChild(attackBtn);
      }
    }
  }

  // During enter-or-skip, promote "Enter" to the primary pass button slot
  // (bottom-most, triggered by the Enter key) and demote "Skip" to the
  // secondary slot above it. Entering the site is the usual choice, so it
  // should be the default that Enter fires.
  if (view.phaseState.phase === Phase.Site && view.phaseState.step === 'enter-or-skip') {
    const enterEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'enter-site');
    if (enterEval) {
      btn.textContent = 'Enter';
      btn.onclick = () => onAction(enterEval.action);

      const skipBtn = document.createElement('button');
      skipBtn.id = 'enter-site-btn';
      skipBtn.className = 'enter-site-btn';
      skipBtn.textContent = 'Skip';
      skipBtn.onclick = () => onAction(passAction);
      panel?.appendChild(skipBtn);
    }
  }
}
