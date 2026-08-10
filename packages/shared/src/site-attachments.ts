/**
 * @module site-attachments
 *
 * Helpers for relating cards in play to the site locations they are bound to.
 *
 * Some cards in `cardsInPlay` carry an {@link CardInPlay.attachedToSite} field:
 * they are bound to a *site location* (by {@link CardDefinitionId}) rather than
 * to a specific character. The canonical example is *Hidden Haven* (wh-75),
 * whose drafted Stage resource converts a Ruins & Lairs into a starting
 * Wizardhaven and stays in play bound to that site.
 *
 * The UI presents such a card under its site — mirroring how items/allies hang
 * under a character — rather than in the flat cards-in-play row. These helpers
 * give both clients (browser and text) a single, consistent rule for that
 * partition so a card is never rendered twice nor dropped entirely.
 */

import type { CardDefinitionId } from './types/common.js';

/** The subset of a card-in-play needed to relate it to a site location. */
interface SiteBoundCard {
  /** The site location this card is bound to, if any (a site definition id). */
  readonly attachedToSite?: CardDefinitionId;
}

/**
 * The cards in `cardsInPlay` bound to a specific site location, matched by the
 * site's definition id. Used to render a site's attached cards beneath it.
 */
export function cardsAttachedToSite<T extends SiteBoundCard>(
  cardsInPlay: readonly T[],
  siteDefinitionId: CardDefinitionId,
): readonly T[] {
  return cardsInPlay.filter(c => c.attachedToSite === siteDefinitionId);
}

/**
 * True when this card is bound to a site location that is currently occupied by
 * one of the player's companies — i.e. it is rendered beneath that site and so
 * must be excluded from the flat cards-in-play row. A site-bound card whose
 * location is not currently in play (e.g. *No Strangers at this Time* as-51
 * once its founding company has moved elsewhere) falls back to the flat row,
 * where it is shown with a site-name badge (see `renderInPlayCardImage` in
 * the browser client) so the binding isn't lost.
 */
export function isAttachedToPresentSite(
  card: SiteBoundCard,
  presentSiteDefIds: ReadonlySet<string>,
): boolean {
  return card.attachedToSite != null && presentSiteDefIds.has(card.attachedToSite as string);
}
