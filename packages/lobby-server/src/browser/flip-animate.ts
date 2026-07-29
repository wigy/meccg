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

/** The parts of a DOMRect the animation decision needs. */
interface RectLike {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
}

/**
 * Decide whether a card should animate between a recorded position and its
 * current one.
 *
 * A rect of zero width *and* height is what `getBoundingClientRect()` returns
 * for an element inside a `display: none` container, so it records no position
 * at all. The hand and opponent arcs are hidden in the all-companies overview
 * (`.all-companies-mode #hand-arc { display: none }`), which the view enters
 * and leaves automatically on every turn change. Treating those zero rects as
 * a real position at the viewport origin made the whole hand fly in from the
 * top-left corner on the way back to single-company view. A card that was not
 * laid out before, or is not laid out now, simply appears or disappears.
 *
 * Genuinely new cards never reach here — they have no snapshot entry and fade
 * in instead — so suppressing this case costs no wanted animation.
 *
 * Moves under a pixel are also skipped: they read as a jitter, not a move.
 */
export function shouldAnimateBetween(oldRect: RectLike, newRect: RectLike): boolean {
  const unlaidOut = (r: RectLike) => r.width === 0 && r.height === 0;
  if (unlaidOut(oldRect) || unlaidOut(newRect)) return false;
  return Math.abs(oldRect.left - newRect.left) >= 1 || Math.abs(oldRect.top - newRect.top) >= 1;
}

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

    // Fall back to definition ID (consume one from the list). Only for cards
    // with NO instance id — i.e. draft cards before instance assignment. A card
    // that has an instance id but didn't match above is genuinely new (or a
    // modal-scoped UI copy with a synthetic `browser:` id) and should fade in,
    // not slide in from a same-definition card's old position.
    if (!entry && !instId && oldDefIds) {
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
    if (!shouldAnimateBetween(oldRect, newRect)) continue;

    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;

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
          if (!shouldAnimateBetween(old.rect, pileRect)) continue;
          const dx = old.rect.left - pileRect.left;
          const dy = old.rect.top - pileRect.top;

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
