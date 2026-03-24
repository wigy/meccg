/**
 * @module flip-animate
 *
 * Implements FLIP (First, Last, Invert, Play) animations for card elements.
 * When the game state updates and the DOM is rebuilt, cards that existed in
 * the previous render animate smoothly from their old positions to their new
 * positions instead of popping into place. Cards that are new fade in.
 *
 * Tracks cards by two keys:
 * - `data-instance-id` — unique card instance (primary, used during play)
 * - `data-card-id` — card definition ID (fallback, used during draft when
 *   instance IDs are not yet assigned)
 *
 * Instance IDs take priority. Definition IDs are matched one-to-one: each
 * old position is consumed at most once, so duplicate cards (e.g. three
 * copies of the same definition) each animate from a distinct old element.
 *
 * Usage:
 *   1. Call `snapshotPositions()` before clearing and rebuilding the DOM.
 *   2. Rebuild the DOM.
 *   3. Call `animateFromSnapshot()` after the new DOM is in place.
 */

/** Duration of the FLIP transition in milliseconds. */
const FLIP_DURATION = 600;

/** Duration of the fade-in for newly appearing cards. */
const FADE_IN_DURATION = 400;

/** Selector for card image elements (all cards have data-card-id). */
const CARD_SELECTOR = 'img[data-card-id]';

/** Stored positions from the previous render, keyed by instance ID. */
let instanceSnapshot: Map<string, DOMRect> | null = null;

/** Stored positions keyed by definition ID (list to handle duplicates). */
let defIdSnapshot: Map<string, DOMRect[]> | null = null;

/**
 * Capture the bounding rect of every card image element.
 * Call this *before* clearing the DOM for a re-render.
 */
export function snapshotPositions(): void {
  instanceSnapshot = new Map();
  defIdSnapshot = new Map();

  for (const el of document.querySelectorAll(CARD_SELECTOR)) {
    const htmlEl = el as HTMLElement;
    const rect = el.getBoundingClientRect();

    const instId = htmlEl.dataset.instanceId;
    if (instId) {
      instanceSnapshot.set(instId, rect);
    }

    const defId = htmlEl.dataset.cardId;
    if (defId) {
      const list = defIdSnapshot.get(defId);
      if (list) list.push(rect);
      else defIdSnapshot.set(defId, [rect]);
    }
  }
}

/**
 * After the DOM has been rebuilt, animate cards from their previous positions
 * to their new positions (FLIP). Cards without a previous position fade in.
 */
export function animateFromSnapshot(): void {
  if (!instanceSnapshot && !defIdSnapshot) return;
  const oldInstances = instanceSnapshot;
  const oldDefIds = defIdSnapshot;
  instanceSnapshot = null;
  defIdSnapshot = null;

  // Nothing to animate from
  if ((!oldInstances || oldInstances.size === 0)
    && (!oldDefIds || oldDefIds.size === 0)) return;

  for (const el of document.querySelectorAll(CARD_SELECTOR)) {
    const htmlEl = el as HTMLElement;

    // Try instance ID first (exact match)
    let oldRect: DOMRect | undefined;
    const instId = htmlEl.dataset.instanceId;
    if (instId && oldInstances) {
      oldRect = oldInstances.get(instId);
      if (oldRect) oldInstances.delete(instId); // consume
    }

    // Fall back to definition ID (consume one from the list)
    if (!oldRect && oldDefIds) {
      const defId = htmlEl.dataset.cardId;
      if (defId) {
        const list = oldDefIds.get(defId);
        if (list && list.length > 0) {
          oldRect = list.shift();
        }
      }
    }

    if (!oldRect) {
      // New card — fade in
      htmlEl.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: FADE_IN_DURATION, easing: 'ease-out' },
      );
      continue;
    }

    const newRect = htmlEl.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;

    // Skip if the card hasn't moved (within 1px tolerance)
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    htmlEl.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: FLIP_DURATION, easing: 'ease-out', composite: 'add' },
    );
  }
}
