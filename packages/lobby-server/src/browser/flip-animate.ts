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
 * **Pile tracking**: Deck piles (play deck, site deck, sideboard, discard,
 * victory display) stamp a `data-pile-instances` attribute listing all
 * instance IDs they contain. The snapshot records the pile element's position
 * for each of those instance IDs. When a card moves from a pile to a visible
 * location (or vice versa), it animates from/to the pile's position. Cards
 * emerging from a face-down pile also get a card-back → face crossfade.
 *
 * When a card image sits inside a wrapper element (e.g. `.character-card-wrap`
 * or `.item-card-wrap`), the wrapper is animated instead so that badges and
 * stat overlays move together with the card.
 *
 * Usage:
 *   1. Call `snapshotPositions()` before clearing and rebuilding the DOM.
 *   2. Rebuild the DOM.
 *   3. Call `animateFromSnapshot()` after the new DOM is in place.
 */

/** Movement speed in pixels per second. */
const FLIP_SPEED = 1200;

/** Minimum duration so short moves don't look instant. */
const FLIP_MIN_DURATION = 150;

/** Maximum duration so cross-screen moves don't feel sluggish. */
const FLIP_MAX_DURATION = 800;

/** Duration of the fade-in for newly appearing cards. */
const FADE_IN_DURATION = 400;

/** Selector for card image elements (all cards have data-card-id). */
const CARD_SELECTOR = 'img[data-card-id]';

/** Selector for pile images that carry instance ID lists. */
const PILE_SELECTOR = 'img[data-pile-instances]';

/**
 * CSS selector for wrapper elements that should be animated as a unit
 * instead of just the card image. Checked via `Element.closest()`.
 */
const WRAPPER_SELECTOR = '.character-card-wrap, .item-card-wrap';

/**
 * Stored position from the previous render, with optional back-image URL
 * when the card was in a face-down pile.
 */
interface SnapshotEntry {
  rect: DOMRect;
  /** If this position was a pile showing a card-back, this is the back image URL. */
  backImage?: string;
}

/** Stored positions from the previous render, keyed by instance ID. */
let instanceSnapshot: Map<string, SnapshotEntry> | null = null;

/** Stored positions keyed by definition ID (list to handle duplicates). */
let defIdSnapshot: Map<string, DOMRect[]> | null = null;

/**
 * Walk up from a card image to its nearest wrapper element, if any.
 * Returns the wrapper or the image itself if no wrapper is found.
 */
function animationTarget(img: HTMLElement): HTMLElement {
  return img.closest(WRAPPER_SELECTOR) as HTMLElement ?? img;
}

/**
 * Capture the bounding rect of every card image element and pile element.
 * Call this *before* clearing the DOM for a re-render.
 */
export function snapshotPositions(): void {
  instanceSnapshot = new Map();
  defIdSnapshot = new Map();

  // Snapshot individual card images
  for (const el of document.querySelectorAll(CARD_SELECTOR)) {
    const htmlEl = el as HTMLElement;
    const target = animationTarget(htmlEl);
    const rect = target.getBoundingClientRect();

    const instId = htmlEl.dataset.instanceId;
    if (instId) {
      instanceSnapshot.set(instId, { rect });
    }

    const defId = htmlEl.dataset.cardId;
    if (defId) {
      const list = defIdSnapshot.get(defId);
      if (list) list.push(rect);
      else defIdSnapshot.set(defId, [rect]);
    }
  }

  // Snapshot pile elements — register their position for every instance they contain
  for (const el of document.querySelectorAll(PILE_SELECTOR)) {
    const htmlEl = el as HTMLImageElement;
    const rect = htmlEl.getBoundingClientRect();
    // Skip piles with zero size (empty placeholder)
    if (rect.width === 0 && rect.height === 0) continue;

    const backImage = htmlEl.src;
    const pileIds = htmlEl.dataset.pileInstances?.split(' ') ?? [];
    for (const id of pileIds) {
      if (!id) continue;
      // Only register if not already tracked as a visible card
      if (!instanceSnapshot.has(id)) {
        instanceSnapshot.set(id, { rect, backImage });
      }
    }
  }
}

/**
 * After the DOM has been rebuilt, animate cards from their previous positions
 * to their new positions (FLIP). Cards without a previous position fade in.
 * Cards emerging from a face-down pile get a card-back → face crossfade overlay.
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
    const htmlEl = el as HTMLImageElement;
    const target = animationTarget(htmlEl);

    // Try instance ID first (exact match)
    let entry: SnapshotEntry | undefined;
    const instId = htmlEl.dataset.instanceId;
    if (instId && oldInstances) {
      entry = oldInstances.get(instId);
      if (entry) oldInstances.delete(instId); // consume
    }

    // Fall back to definition ID (consume one from the list)
    if (!entry && oldDefIds) {
      const defId = htmlEl.dataset.cardId;
      if (defId) {
        const list = oldDefIds.get(defId);
        if (list && list.length > 0) {
          const rect = list.shift()!;
          entry = { rect };
        }
      }
    }

    if (!entry) {
      // New card — fade in
      target.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: FADE_IN_DURATION, easing: 'ease-out' },
      );
      continue;
    }

    const oldRect = entry.rect;
    const newRect = target.getBoundingClientRect();
    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;

    // Skip if the card hasn't moved (within 1px tolerance)
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    const distance = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.min(FLIP_MAX_DURATION, Math.max(FLIP_MIN_DURATION, distance / FLIP_SPEED * 1000));

    target.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration, easing: 'ease-out', composite: 'add' },
    );

    // Card-back → face crossfade: if the old position was a face-down pile,
    // overlay a card-back image that fades out, revealing the real card beneath.
    if (entry.backImage && htmlEl.src !== entry.backImage) {
      const overlay = document.createElement('img');
      overlay.src = entry.backImage;
      overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;z-index:1';

      // The target must be positioned so the overlay aligns correctly
      const pos = getComputedStyle(target).position;
      if (pos === 'static') target.style.position = 'relative';

      target.appendChild(overlay);
      const fadeAnim = overlay.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration, easing: 'ease-in-out' },
      );
      fadeAnim.onfinish = () => overlay.remove();
    }
  }

  // Animate cards that moved INTO a pile (disappeared from view).
  // For each pile element in the new DOM, check if any of its instance IDs
  // had a visible position in the old snapshot — animate from that position.
  if (oldInstances && oldInstances.size > 0) {
    for (const el of document.querySelectorAll(PILE_SELECTOR)) {
      const htmlEl = el as HTMLImageElement;
      const pileIds = htmlEl.dataset.pileInstances?.split(' ') ?? [];
      const pileRect = htmlEl.getBoundingClientRect();
      if (pileRect.width === 0 && pileRect.height === 0) continue;

      let animated = false;
      for (const id of pileIds) {
        if (!id) continue;
        const old = oldInstances.get(id);
        if (!old) continue;
        // Only animate if this card was previously a visible card (no backImage),
        // meaning it moved from the play area into a pile.
        if (old.backImage) continue;
        oldInstances.delete(id);

        if (!animated) {
          const dx = old.rect.left - pileRect.left;
          const dy = old.rect.top - pileRect.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

          const distance = Math.sqrt(dx * dx + dy * dy);
          const duration = Math.min(FLIP_MAX_DURATION, Math.max(FLIP_MIN_DURATION, distance / FLIP_SPEED * 1000));
          htmlEl.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration, easing: 'ease-out', composite: 'add' },
          );
          animated = true; // only animate the pile element once
        }
      }
    }
  }
}
