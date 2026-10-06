/**
 * @module withdraw-support
 *
 * Browser UI for taking back a support tap before the roll (the human-only
 * `withdraw-support` meta-action, see `withdraw-support.ts` in
 * `@meccg/shared`). The engine offers one such action per support tap made
 * since the last other action — i.e. until the dice are rolled or anything
 * else happens.
 *
 * Each offered withdrawal is surfaced twice:
 *
 * - a "↶ <card>" button in the `#withdraw-support-banner` under the
 *   toolbar, which works for every supporter (characters, allies and items);
 * - a clickable "↶" badge (or, for an item/ally image, a highlighted
 *   clickable image) on the tapped supporter's card wherever it is
 *   rendered on the board (`[data-instance-id]`) or in the combat overlay
 *   (`[data-combat-char-id]`), so a misclicked support can be undone by
 *   clicking the card that was just tapped.
 *
 * Meta-actions are excluded from auto-pass and keyboard auto-fire (see
 * `isMetaAction`), so a withdrawal is only ever sent on a human click.
 */

import type { GameAction, PlayerView, WithdrawSupportAction, CardInstanceId } from '@meccg/shared';

/** The viable `withdraw-support` actions offered in `view`. */
export function withdrawSupportActions(view: PlayerView): WithdrawSupportAction[] {
  return view.legalActions
    .filter(a => a.viable && a.action.type === 'withdraw-support')
    .map(a => a.action as WithdrawSupportAction);
}

/** Every element currently rendering the supporter `id`. */
function supporterElements(id: CardInstanceId): HTMLElement[] {
  const idStr = id as string;
  return [
    ...document.querySelectorAll<HTMLElement>(`[data-instance-id="${idStr}"]`),
    ...document.querySelectorAll<HTMLElement>(`[data-combat-char-id="${idStr}"]`),
  ];
}

/**
 * Show or hide the withdraw-support banner and card badges to match the
 * current view. Must run after the board and combat overlay are rendered
 * so the badges find the supporters' card elements.
 *
 * @param nameOf - Display name of a card instance, for the banner buttons.
 */
export function renderWithdrawSupport(
  view: PlayerView,
  nameOf: (id: CardInstanceId) => string,
  send: (action: GameAction) => void,
): void {
  const actions = withdrawSupportActions(view);

  const banner = document.getElementById('withdraw-support-banner');
  if (banner) {
    banner.innerHTML = '';
    if (actions.length === 0) {
      banner.classList.add('hidden');
    } else {
      const text = document.createElement('span');
      text.textContent = 'Changed your mind? Untap a supporter before rolling:';
      banner.appendChild(text);
      for (const action of actions) {
        const btn = document.createElement('button');
        btn.className = 'withdraw-support-btn';
        btn.textContent = `↶ ${nameOf(action.supportSourceId)}`;
        btn.title = 'Withdraw this support and untap the card';
        btn.addEventListener('click', () => send(action));
        banner.appendChild(btn);
      }
      banner.classList.remove('hidden');
    }
  }

  for (const action of actions) {
    const label = `Withdraw ${nameOf(action.supportSourceId)}'s support (untap)`;
    for (const el of supporterElements(action.supportSourceId)) {
      if (el.tagName === 'IMG') {
        // An item/ally image: a badge can't be nested in an <img>, so make the
        // image itself the click target — unless it is the character's own
        // card inside a column that gets the badge below.
        if (el.parentElement?.closest(`[data-instance-id="${action.supportSourceId as string}"], [data-combat-char-id="${action.supportSourceId as string}"]`)) continue;
        el.classList.add('withdraw-support-target');
        el.title = label;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          send(action);
        }, { capture: true });
        continue;
      }
      const host = el.querySelector<HTMLElement>('.character-card-wrap') ?? el;
      if (host.querySelector('.withdraw-support-badge')) continue;
      const badge = document.createElement('span');
      badge.className = 'withdraw-support-badge';
      badge.textContent = '↶';
      badge.title = label;
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        send(action);
      });
      host.appendChild(badge);
    }
  }
}
