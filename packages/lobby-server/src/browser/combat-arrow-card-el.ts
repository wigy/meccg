/**
 * @module combat-arrow-card-el
 *
 * Resolves the `.company-card` element used as a strike-arrow endpoint.
 *
 * `drawStrikeArrows` (combat-view.ts) looks up a combatant by its
 * `data-combat-char-id` attribute and then needs the `.company-card` image to
 * anchor the arrow. For characters, `data-combat-char-id` is set on a wrapping
 * column div and the image is a descendant. For allies/items rendered via
 * `createCardImageFromDefId`, `data-combat-char-id` is set directly on the
 * bare `<img class="company-card">` element, which has no matching
 * descendant — a plain `querySelector('.company-card')` call returns null and
 * silently drops the arrow (bug report "Battle arrows", game
 * ms6gbt8d-5na91m, seq 472: no arrow from Orc-watch to the ally Stinker).
 */

interface ElementLike {
  matches(selector: string): boolean;
  querySelector(selector: string): ElementLike | null;
}

/** Returns `el` itself if it is the `.company-card`, otherwise the matching descendant. */
export function resolveCardElement<T extends ElementLike>(el: T): T | null {
  return (el.matches('.company-card') ? el : el.querySelector('.company-card')) as T | null;
}
