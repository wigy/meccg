/**
 * @module company-attachments
 *
 * Helpers for relating cards in play to the companies they are bound to.
 *
 * Some cards in `cardsInPlay` carry a {@link CardInPlay.companyId} field: they
 * are company-targeting permanent events (e.g. *Fellowship*, *Going Ever Under
 * Dark*) bound to a specific company for as long as its membership stays
 * unchanged. Physically such a card sits with the company it was played on,
 * so the UI presents it inside that company's block — mirroring how items hang
 * under a character and site-bound cards hang under a site — rather than in
 * the flat cards-in-play row.
 *
 * These helpers give both clients (browser and text) a single, consistent
 * rule for that partition so a card is never rendered twice nor dropped
 * entirely. They intentionally parallel `site-attachments.ts`, which performs
 * the same partition for site-bound cards (`attachedToSite`).
 */

import type { CompanyId } from './types/common.js';

/** The subset of a card-in-play needed to relate it to a company. */
interface CompanyBoundCard {
  /** The company this card is bound to, if any. */
  readonly companyId?: CompanyId;
}

/**
 * The cards in `cardsInPlay` bound to a specific company. Used to render a
 * company's attached permanent events inside its company block.
 */
export function cardsAttachedToCompany<T extends CompanyBoundCard>(
  cardsInPlay: readonly T[],
  companyId: CompanyId,
): readonly T[] {
  return cardsInPlay.filter(c => c.companyId === companyId);
}

/**
 * True when this card is bound to a company that is currently rendered on the
 * board — i.e. it is shown inside that company's block and so must be excluded
 * from the flat cards-in-play row. A company-bound card whose company no
 * longer exists (the engine normally discards such orphans, but the rule is
 * defined for completeness) falls back to the flat row.
 */
export function isAttachedToPresentCompany(
  card: CompanyBoundCard,
  presentCompanyIds: ReadonlySet<string>,
): boolean {
  return card.companyId != null && presentCompanyIds.has(card.companyId as string);
}
