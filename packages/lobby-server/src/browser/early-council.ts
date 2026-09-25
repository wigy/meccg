/**
 * @module early-council
 *
 * Browser UI for the agreed early Free Council — a house-rule option that
 * lets two humans playing to a fixed time limit end the game with a normal
 * Free Council instead of one of them conceding.
 *
 * Driven entirely by the human-only meta-actions the game server layers on
 * each seat's legal actions (`withMetaActions` in `@meccg/shared`):
 *
 * - `propose-early-council` shows the toolbar "Propose Council" button;
 * - `accept-early-council` shows the incoming-proposal banner with
 *   Accept / Decline;
 * - `decline-early-council` alone (the proposer's withdraw option) shows the
 *   "waiting for opponent" banner with Withdraw.
 *
 * None of these appear in the ordinary action list's auto-fire paths (see
 * `isMetaAction`), so nothing here is ever sent without a human click.
 */

import type { EvaluatedAction, GameAction, PlayerView } from '@meccg/shared';
import { showConfirm } from './dialog.js';

/** The viable meta-action of the given type in `actions`, if offered. */
function findViable(actions: readonly EvaluatedAction[], type: GameAction['type']): GameAction | undefined {
  return actions.find(a => a.viable && a.action.type === type)?.action;
}

/** Append a button labelled `label` to the banner, running `onClick` when clicked. */
function addBannerButton(
  banner: HTMLElement,
  label: string,
  className: string,
  onClick: () => void,
): void {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  banner.appendChild(btn);
}

/**
 * Show or hide the "Propose Council" toolbar button and the proposal
 * banner to match the current view's early-Council meta-actions.
 */
export function renderEarlyCouncil(view: PlayerView, send: (action: GameAction) => void): void {
  const btn = document.getElementById('early-council-btn') as HTMLButtonElement | null;
  const banner = document.getElementById('early-council-banner');
  const actions = view.legalActions;

  const propose = findViable(actions, 'propose-early-council');
  if (btn) {
    btn.style.display = propose ? '' : 'none';
    btn.onclick = propose
      ? () => { void (async () => {
        const ok = await showConfirm(
          `Propose ending the game now with an early Free Council?\n\nIf ${view.opponent.name} accepts, the current turn finishes, the other player takes one last turn, and then the Free Council scores the game as usual.`,
          { okLabel: 'Propose', cancelLabel: 'Cancel' },
        );
        if (ok) send(propose);
      })(); }
      : null;
  }

  if (!banner) return;
  banner.innerHTML = '';
  const accept = findViable(actions, 'accept-early-council');
  const decline = findViable(actions, 'decline-early-council');

  if (accept && decline) {
    const text = document.createElement('span');
    text.textContent = `${view.opponent.name} proposes ending the game with an early Free Council.`;
    banner.appendChild(text);
    addBannerButton(banner, 'Accept', 'early-council-accept', () => { void (async () => {
      const ok = await showConfirm(
        'Accept the early Free Council? The current turn finishes, the other player takes one last turn, and then the Free Council decides the game by marshalling points.',
        { okLabel: 'Accept', cancelLabel: 'Cancel', destructive: true },
      );
      if (ok) send(accept);
    })(); });
    addBannerButton(banner, 'Decline', 'early-council-decline', () => send(decline));
    banner.classList.remove('hidden');
  } else if (decline) {
    const text = document.createElement('span');
    text.textContent = `Waiting for ${view.opponent.name} to answer your early Free Council proposal…`;
    banner.appendChild(text);
    addBannerButton(banner, 'Withdraw', 'early-council-decline', () => send(decline));
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}
