/**
 * @module render-utils
 *
 * Shared DOM rendering helpers used by both the setup-phase renderer (render.ts)
 * and the play-phase company view renderer (company-view.ts). Extracted to avoid
 * duplication of card image creation and common DOM utilities.
 */

import type { CardDefinition, CharacterInPlay, RegionType } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';

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

/** Render item cards attached to a character inside a group container. */
export function appendItemCards(
  container: HTMLElement,
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  for (const item of char.items) {
    const itemDef = cardPool[item.definitionId as string];
    if (!itemDef) continue;
    const itemImg = cardImageProxyPath(itemDef);
    if (!itemImg) continue;
    container.appendChild(createCardImage(item.definitionId as string, itemDef, itemImg, 'drafted-card drafted-item', item.instanceId as string));
  }
}
