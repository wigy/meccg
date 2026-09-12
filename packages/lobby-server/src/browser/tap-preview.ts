/**
 * @module tap-preview
 *
 * Lets the board apply a character's tap visual the instant the `dice-roll`
 * effect carrying it arrives, rather than waiting for the dice animation and
 * the deferred `state` message that follows it (see effect-log-buffer.ts's
 * module doc for why the state message is held back until the animation
 * starts). Without this, a tap-to-fight strike rolls its dice against a
 * still-untapped board and only shows the tap once the whole new state
 * renders afterward — well after the action that caused it.
 */

import type { CardInstanceId } from '@meccg/shared';

/**
 * Toggle the tapped visual on every element currently rendering
 * `characterId`, on the board (`[data-instance-id]`, company-character.ts)
 * and in the combat overlay (`[data-combat-char-id]`, combat-view.ts). Pure
 * DOM class toggle, no `appState` mutation — the next full
 * `renderStateMessage()` naturally reconciles it (e.g. replacing it with the
 * wounded/`Inverted` styling if the roll wounds instead of just tapping).
 */
export function applyTapPreview(characterId: CardInstanceId): void {
  const idStr = characterId as string;
  const matches = [
    ...document.querySelectorAll(`[data-instance-id="${idStr}"]`),
    ...document.querySelectorAll(`[data-combat-char-id="${idStr}"]`),
  ];
  for (const el of matches) {
    const wrap = el.closest('.character-card-wrap') ?? el.querySelector('.character-card-wrap');
    if (!wrap) continue;
    wrap.classList.add('character-card-wrap--tapped');
    wrap.querySelector('.character-card-inner')?.classList.add('character-card-inner--tapped');
  }
}
