/**
 * @module company-character
 *
 * Renders a single character column: the character card image with status
 * transforms (tapped/wounded), stats/mind/DI badges, and a row of
 * attachments (items, allies, hazards, followers with their own items).
 */

import type {
  Alignment,
  CardDefinition,
  CardInPlay,
  CardInstanceId,
  CharacterInPlay,
} from '@meccg/shared';
import { cardImageProxyPath, effectiveItemCorruptionPoints, isCharacterCard, isItemCard, CardStatus, cardsAttachedToCharacter } from '@meccg/shared';
import { createCardImage } from './render-utils.js';

/** Highlight class + click handler applied to a card image. */
interface CardClick {
  cls: string;
  handler: (e: Event) => void;
}

/** Options for {@link buildCharacterCardWrap} naming how a main character's wrap differs from a follower's. */
interface CardWrapOptions {
  /** CSS class(es) for the card image: `'company-card'` for a main character, plus `company-card--follower` for a follower. */
  cardClass: string;
  /**
   * Whether the card has attachments that fade its lower half. Main characters
   * count items + allies + hazards + followers; followers count only their own
   * items + allies + hazards.
   */
  hasAttachments: boolean;
  /**
   * When tapped with attachments, also mark the wrap with
   * `character-card-wrap--has-attachments`. Only main characters do this;
   * followers never mark their wrap.
   */
  markTappedWithAttachments: boolean;
  /** Influence-move highlight and click handler for the card image, if any. */
  influenceClick?: CardClick | undefined;
}

/**
 * Build the card wrap for a character or follower: card image with
 * tapped/wounded transforms, stats badge, mind badge, and DI badge.
 */
function buildCharacterCardWrap(
  ch: CharacterInPlay,
  def: CardDefinition,
  imgPath: string,
  opts: CardWrapOptions,
): HTMLElement {
  // Card wrapper (for positioning badge)
  const wrap = document.createElement('div');
  wrap.className = 'character-card-wrap';

  const img = createCardImage(ch.definitionId as string, def, imgPath, opts.cardClass, ch.instanceId as string);

  // Inner wrapper rotates both card image and badges together
  const inner = document.createElement('div');
  inner.className = 'character-card-inner';
  if (ch.status === CardStatus.Tapped) {
    inner.classList.add('character-card-inner--tapped');
    wrap.classList.add('character-card-wrap--tapped');
    if (opts.markTappedWithAttachments && opts.hasAttachments) wrap.classList.add('character-card-wrap--has-attachments');
  } else if (ch.status === CardStatus.Inverted) {
    inner.classList.add('character-card-inner--wounded');
    if (opts.hasAttachments) img.classList.add('company-card--faded-top');
  } else {
    if (opts.hasAttachments) img.classList.add('company-card--faded');
  }

  // Influence move highlight and click handler
  if (opts.influenceClick) {
    if (opts.influenceClick.cls) img.classList.add(opts.influenceClick.cls);
    img.style.cursor = 'pointer';
    img.addEventListener('click', opts.influenceClick.handler);
  }
  inner.appendChild(img);

  // Stats badge
  const badge = document.createElement('div');
  badge.className = 'char-stats-badge';
  badge.textContent = `${ch.effectiveStats.prowess}/${ch.effectiveStats.body}`;
  inner.appendChild(badge);

  // Mind badge (left edge, above DI)
  if (isCharacterCard(def) && def.mind !== null) {
    const mindBadge = document.createElement('div');
    mindBadge.className = 'char-mind-badge';
    mindBadge.textContent = String(def.mind);
    inner.appendChild(mindBadge);
  }

  // Direct influence badge (left edge, middle) — only shown when DI > 0
  if (ch.effectiveStats.directInfluence > 0) {
    const diBadge = document.createElement('div');
    diBadge.className = 'char-di-badge';
    diBadge.textContent = String(ch.effectiveStats.directInfluence);
    inner.appendChild(diBadge);
  }

  wrap.appendChild(inner);
  return wrap;
}

/** Shared context threaded through attachment rendering for every bearer. */
interface AttachmentRowContext {
  cardPool: Readonly<Record<string, CardDefinition>>;
  itemClickBuilder?: ((itemInstId: CardInstanceId, charInstId: CardInstanceId) => CardClick | undefined) | undefined;
  hazardClickBuilder?: ((hazardInstId: CardInstanceId) => CardClick | undefined) | undefined;
  inPlayDefs: readonly CardDefinition[];
  bearerAlignment?: Alignment | undefined;
  /** Both players' `cardsInPlay`, searched for cards attached to each bearer (CardInPlay.attachedTo) via {@link cardsAttachedToCharacter}. */
  attachedEventCandidates?: readonly CardInPlay[] | undefined;
  /** Renders one character-attached card, reusing the same board affordances (tap, discard, click-to-preview) as the flat cards-in-play row. */
  renderAttachedEvent?: ((card: CardInPlay) => HTMLElement | null) | undefined;
}

/**
 * Append the bearer's items, allies, and hazards to `row` as overlapping card
 * images with tapped/wounded transforms, click handlers, and CP badges.
 */
function appendAttachmentCards(
  row: HTMLElement,
  bearer: CharacterInPlay,
  bearerDef: CardDefinition,
  ctx: AttachmentRowContext,
): void {
  const allAttachments = [...bearer.items, ...bearer.allies, ...bearer.hazards];
  for (const att of allAttachments) {
    const attDef = ctx.cardPool[att.definitionId as string];
    if (!attDef) continue;
    const attImg = cardImageProxyPath(attDef);
    if (!attImg) continue;
    const attEl = createCardImage(att.definitionId as string, attDef, attImg, 'company-card company-card--item', att.instanceId as string);
    if (att.status === CardStatus.Tapped) {
      attEl.classList.add('company-card--tapped');
    } else if (att.status === CardStatus.Inverted) {
      attEl.classList.add('company-card--wounded');
    }
    const isItem = bearer.items.some(i => i.instanceId === att.instanceId);
    const isHazard = bearer.hazards.some(h => h.instanceId === att.instanceId);
    const isAlly = bearer.allies.some(a => a.instanceId === att.instanceId);
    // Items merge their own granted actions (e.g. Cram) with store/transfer
    // in one click handler; hazards and allies (e.g. Tom Bombadil's tap-to-
    // cancel-hazard) only ever carry granted actions.
    const itemOrHazardClick = isItem && ctx.itemClickBuilder
      ? ctx.itemClickBuilder(att.instanceId, bearer.instanceId)
      : (isHazard || isAlly) && ctx.hazardClickBuilder
        ? ctx.hazardClickBuilder(att.instanceId)
        : undefined;
    if (itemOrHazardClick) {
      if (itemOrHazardClick.cls) attEl.classList.add(itemOrHazardClick.cls);
      attEl.style.cursor = 'pointer';
      attEl.addEventListener('click', itemOrHazardClick.handler);
    }
    // Wrap item in a container for CP badge positioning
    const bearerRace = isCharacterCard(bearerDef) ? bearerDef.race : undefined;
    const attCp = isItemCard(attDef) ? effectiveItemCorruptionPoints(attDef, ctx.inPlayDefs, ctx.bearerAlignment, bearerRace) : 0;
    if (attCp > 0) {
      const itemWrap = document.createElement('div');
      itemWrap.className = 'item-card-wrap';
      itemWrap.appendChild(attEl);
      const cpBadge = document.createElement('div');
      cpBadge.className = 'item-cp-badge';
      cpBadge.textContent = `${attCp} CP`;
      itemWrap.appendChild(cpBadge);
      row.appendChild(itemWrap);
    } else {
      row.appendChild(attEl);
    }
  }

  // Character-attached permanent/short events (e.g. a corruption card, or
  // Flee from Strike once it stays in play on the fleeing character) render
  // alongside items/allies/hazards, inline with their bearer, instead of the
  // detached flat cards-in-play row (bug: such a card rendered as a
  // disconnected sliver in a corner of the board).
  if (ctx.attachedEventCandidates && ctx.renderAttachedEvent) {
    for (const card of cardsAttachedToCharacter(ctx.attachedEventCandidates, bearer.instanceId)) {
      const img = ctx.renderAttachedEvent(card);
      if (img) row.appendChild(img);
    }
  }
}

/** Whether `bearer` has any character-attached cards (CardInPlay.attachedTo) in `ctx`. */
function hasAttachedEvents(bearer: CharacterInPlay, ctx: AttachmentRowContext): boolean {
  return ctx.attachedEventCandidates != null
    && cardsAttachedToCharacter(ctx.attachedEventCandidates, bearer.instanceId).length > 0;
}

/**
 * Render a single character column: character card + items stacked below.
 * Applies tapped/wounded transforms based on character status.
 *
 * `inPlayDefs` are the definitions of every card in play (both players'), used
 * to raise an item's CP badge by any `in-play-item-modifier` in effect (e.g.
 * *Scorba at Home* td-65 makes Glamdring cost 2 CP, not its printed 1) so the
 * badge matches the corruption check the engine computes. `bearerAlignment` is
 * the alignment of the player controlling this character, needed because some
 * modifiers spare certain players (*Bane of the Ithil-stone* tw-13 doubles
 * Palantír corruption but "has no effect on a minion player").
 */
export function renderCharacterColumn(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
  isTitleCharacter: boolean,
  charMap?: Readonly<Record<string, CharacterInPlay>>,
  influenceClick?: { cls: string; handler: (e: Event) => void },
  influenceClickBuilder?: (id: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
  itemClickBuilder?: (itemInstId: CardInstanceId, charInstId: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
  hazardClickBuilder?: (hazardInstId: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
  inPlayDefs: readonly CardDefinition[] = [],
  bearerAlignment?: Alignment,
  attachedEventCandidates?: readonly CardInPlay[],
  renderAttachedEvent?: (card: CardInPlay) => HTMLElement | null,
): HTMLElement {
  const col = document.createElement('div');
  col.className = 'character-column';
  col.dataset.instanceId = char.instanceId as string;

  const def = cardPool[char.definitionId as string];
  if (!def) return col;
  const imgPath = cardImageProxyPath(def);
  if (!imgPath) return col;

  const ctx: AttachmentRowContext = { cardPool, itemClickBuilder, hazardClickBuilder, inPlayDefs, bearerAlignment, attachedEventCandidates, renderAttachedEvent };

  const hasFollowers = charMap != null && char.followers.length > 0;
  const hasAttachments = char.items.length > 0 || char.allies.length > 0 || char.hazards.length > 0 || hasFollowers || hasAttachedEvents(char, ctx);
  col.appendChild(buildCharacterCardWrap(char, def, imgPath, {
    cardClass: 'company-card',
    hasAttachments,
    markTappedWithAttachments: true,
    influenceClick,
  }));

  // Items, allies, followers, and character-attached events — shown side by side in one row
  const hasOwnAttachments = char.items.length > 0 || char.allies.length > 0 || char.hazards.length > 0 || hasAttachedEvents(char, ctx);
  if (hasOwnAttachments || hasFollowers) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    appendAttachmentCards(attachments, char, def, ctx);
    // Followers rendered as overlapping cards like items, with their own items below
    if (hasFollowers) {
      for (const followerId of char.followers) {
        const follower = charMap[followerId as string];
        if (!follower) continue;
        const fDef = cardPool[follower.definitionId as string];
        if (!fDef) continue;
        const fImg = cardImageProxyPath(fDef);
        if (!fImg) continue;

        // Wrap follower + its items in a mini-column
        const followerCol = document.createElement('div');
        followerCol.className = 'follower-column';

        const followerHasItems = follower.items.length > 0 || follower.allies.length > 0 || follower.hazards.length > 0 || hasAttachedEvents(follower, ctx);
        followerCol.appendChild(buildCharacterCardWrap(follower, fDef, fImg, {
          cardClass: 'company-card company-card--follower',
          hasAttachments: followerHasItems,
          markTappedWithAttachments: false,
          influenceClick: influenceClickBuilder?.(followerId),
        }));

        // Follower's own items, allies, and hazards
        if (followerHasItems) {
          const fAttRow = document.createElement('div');
          fAttRow.className = 'character-attachments';
          appendAttachmentCards(fAttRow, follower, fDef, ctx);
          followerCol.appendChild(fAttRow);
        }

        attachments.appendChild(followerCol);
      }
    }
    col.appendChild(attachments);
  }

  return col;
}
