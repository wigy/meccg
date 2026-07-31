/**
 * @module render-utils
 *
 * Shared DOM rendering helpers used by both the setup-phase renderer (render.ts)
 * and the play-phase company view renderer (company-view.ts). Extracted to avoid
 * duplication of card image creation and common DOM utilities.
 */

import type { CardDefinition, CardInstanceId, CardDefinitionId, CharacterInPlay, GameAction, RegionType, PlayerView, Alignment } from '@meccg/shared';
import { cardImageProxyPath, effectiveItemCorruptionPoints, isItemCard } from '@meccg/shared';

/** Get an element by ID, throwing if not found. */
export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

/**
 * Create a card image element from a definition.
 * Sets data-card-id for hover preview integration and optionally
 * data-instance-id for FLIP animation tracking.
 */
export function createCardImage(defId: string, def: CardDefinition, imgPath: string, className = 'drafted-card', instanceId?: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = imgPath;
  img.alt = def.name;
  img.dataset.cardId = defId;
  if (instanceId) img.dataset.instanceId = instanceId;
  img.className = className;
  return img;
}

/**
 * Resolve `defId` to its definition and proxy image path and build a
 * {@link createCardImage}, or return `null` when the definition is unknown or
 * has no image path. Folds the ubiquitous "look up def, bail if missing,
 * compute imgPath, bail if missing, then createCardImage" guard repeated across
 * the board and company renderers. `className` defaults to createCardImage's
 * own default so call sites that pass none are unchanged.
 */
export function createCardImageFromDefId(
  defId: CardDefinitionId | string,
  cardPool: Readonly<Record<string, CardDefinition>>,
  className = 'drafted-card',
  instanceId?: string,
): HTMLImageElement | null {
  const def = cardPool[defId as string];
  if (!def) return null;
  const imgPath = cardImageProxyPath(def);
  if (!imgPath) return null;
  return createCardImage(defId as string, def, imgPath, className, instanceId);
}

/**
 * Create the card image for `defId`/`instanceId`, falling back to a face-down
 * card-back image (with `fallbackAlt` as the alt text) when the definition is
 * unknown or has no proxy image path. The returned element always carries
 * `className`. Shared by the company-site renderers (on-guard cards,
 * active-constraint cards, agent-attack thumbnails), which each build this same
 * "real image, otherwise card-back" element.
 */
export function createCardImageOrBack(
  instanceId: CardInstanceId,
  defId: CardDefinitionId | undefined,
  cardPool: Readonly<Record<string, CardDefinition>>,
  className: string,
  fallbackAlt: string,
): HTMLImageElement {
  const def = defId ? cardPool[defId as string] : undefined;
  const imgPath = def ? cardImageProxyPath(def) : undefined;
  if (def && imgPath) {
    return createCardImage(defId as string, def, imgPath, className, instanceId as string);
  }
  const img = document.createElement('img');
  img.src = '/images/card-back.jpg';
  img.alt = fallbackAlt;
  img.className = className;
  return img;
}

/** Create a face-down card image (card back). */
export function createFaceDownCard(altText: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = '/images/card-back.jpg';
  img.alt = altText;
  img.className = 'drafted-card drafted-card-facedown';
  return img;
}

/**
 * Map from region type to the filename of its original MECCG icon.
 * Icons sourced from the MECCG Set Editor (usmcgeek/meccg on GitHub).
 *
 * - Wilderness: pine tree
 * - Shadow: half-shaded tower
 * - Dark: solid tower
 * - Coastal: waves
 * - Free: outlined tower with window
 * - Border: half-shaded tower with door
 */
const REGION_TYPE_ICONS: Record<RegionType, string> = {
  wilderness: 'w',
  shadow: 's',
  dark: 'd',
  coastal: 'c',
  free: 'f',
  border: 'b',
};

/**
 * Create an inline image element for a region type symbol using the
 * original MECCG icons.
 *
 * @param regionType - The region type to render.
 * @param size - Width and height in pixels (default 16).
 * @returns An HTMLElement wrapping the icon image.
 */
export function createRegionTypeIcon(regionType: RegionType, size = 16): HTMLElement {
  const code = REGION_TYPE_ICONS[regionType];
  const el = document.createElement('span');
  el.className = 'region-type-icon';
  el.title = regionType;
  const img = document.createElement('img');
  img.src = `/images/regions/${code}.png`;
  img.alt = regionType;
  img.width = size;
  img.height = size;
  el.appendChild(img);
  return el;
}

/**
 * The card definitions of every card in play, both players'. Game-wide effects
 * carried by a permanent event reach cards of either side (an
 * `in-play-item-modifier` raises the corruption points of *all* matching items,
 * not only its controller's), so renderers that need them must consult both
 * `cardsInPlay` lists. Unknown definitions (redacted cards) are skipped.
 */
export function inPlayCardDefs(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CardDefinition[] {
  return [...view.self.cardsInPlay, ...view.opponent.cardsInPlay]
    .map(c => cardPool[c.definitionId as string])
    .filter((d): d is CardDefinition => d != null);
}

/**
 * Render item cards attached to a character inside a group container, each
 * wrapped with its corruption-point badge (matching `renderCharacterColumn`'s
 * in-play item rendering) so a starting item's CP is visible as soon as it is
 * assigned during setup, not only once play has advanced to the company view.
 */
export function appendItemCards(
  container: HTMLElement,
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
  view: PlayerView,
  bearerAlignment?: Alignment,
): void {
  const inPlayDefs = inPlayCardDefs(view, cardPool);
  for (const item of char.items) {
    const itemDef = cardPool[item.definitionId as string];
    const itemEl = createCardImageFromDefId(item.definitionId, cardPool, 'drafted-card drafted-item', item.instanceId as string);
    if (!itemEl) continue;
    const itemCp = itemDef && isItemCard(itemDef) ? effectiveItemCorruptionPoints(itemDef, inPlayDefs, bearerAlignment) : 0;
    if (itemCp > 0) {
      const itemWrap = document.createElement('div');
      itemWrap.className = 'item-card-wrap';
      itemWrap.appendChild(itemEl);
      const cpBadge = document.createElement('div');
      cpBadge.className = 'item-cp-badge';
      cpBadge.textContent = `${itemCp} CP`;
      itemWrap.appendChild(cpBadge);
      container.appendChild(itemWrap);
    } else {
      container.appendChild(itemEl);
    }
  }
}

/**
 * Append a "+" toggle that reveals the raw JSON of an action, for debugging
 * what the engine actually offered.
 *
 * Shared by the human action list (`render-actions.ts`) and the pseudo-AI
 * action list (`pseudo-ai.ts`), which had byte-identical copies — one nested
 * inside its renderer, one at module scope.
 */
export function addJsonToggle(container: HTMLElement, action: GameAction): void {
  const toggle = document.createElement('span');
  toggle.className = 'action-json-toggle';
  toggle.textContent = '+';
  toggle.title = 'Show JSON';
  const pre = document.createElement('pre');
  pre.className = 'action-json hidden';
  pre.textContent = JSON.stringify(action, null, 2);
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    pre.classList.toggle('hidden');
    const nowVisible = !pre.classList.contains('hidden');
    toggle.textContent = nowVisible ? '−' : '+';
    toggle.title = nowVisible ? 'Hide JSON' : 'Show JSON';
  });
  container.appendChild(toggle);
  container.appendChild(pre);
}
