/**
 * @module render-utils
 *
 * Shared DOM rendering helpers used by both the setup-phase renderer (render.ts)
 * and the play-phase company view renderer (company-view.ts). Extracted to avoid
 * duplication of card image creation and common DOM utilities.
 */

import type { CardDefinition, CharacterInPlay } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';

/** Get an element by ID, throwing if not found. */
export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

/**
 * Create a card image element from a definition.
 * Sets data-card-id for hover preview integration.
 */
export function createCardImage(defId: string, def: CardDefinition, imgPath: string, className = 'drafted-card'): HTMLImageElement {
  const img = document.createElement('img');
  img.src = imgPath;
  img.alt = def.name;
  img.dataset.cardId = defId;
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
    container.appendChild(createCardImage(item.definitionId as string, itemDef, itemImg, 'drafted-card drafted-item'));
  }
}
