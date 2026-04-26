/**
 * @module card-detail
 *
 * Card detail tooltip for the deck editor. Shows card image, name, and rules
 * text in a floating overlay positioned near the hovered element.
 */

import { cardImageProxyPath } from '@meccg/shared';
import type { CardDefinition } from '@meccg/shared';

let tooltipEl: HTMLElement | null = null;

function getTooltip(): HTMLElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'de-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

/** Show the card tooltip near the given anchor element. */
export function showCardTooltip(def: CardDefinition, anchorEl: HTMLElement): void {
  const tt = getTooltip();
  tt.innerHTML = '';

  const imgPath = cardImageProxyPath(def);
  if (imgPath) {
    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.className = 'de-tooltip-img';
    img.loading = 'lazy';
    tt.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'de-tooltip-body';

  const name = document.createElement('div');
  name.className = 'de-tooltip-name';
  name.textContent = def.name;
  body.appendChild(name);

  const d = def as unknown as Record<string, unknown>;
  if (typeof d.text === 'string' && d.text) {
    const text = document.createElement('div');
    text.className = 'de-tooltip-text';
    text.textContent = d.text;
    body.appendChild(text);
  }

  tt.appendChild(body);

  // Position tooltip near the anchor, repositioning to avoid viewport edges.
  tt.style.display = 'block';
  const rect = anchorEl.getBoundingClientRect();
  const w = tt.offsetWidth || 210;
  const h = tt.offsetHeight || 200;
  let x = rect.right + 8;
  let y = rect.top;

  if (x + w > window.innerWidth - 8) x = rect.left - w - 8;
  if (x < 8) x = 8;
  if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
  if (y < 8) y = 8;

  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
}

/** Hide the card tooltip. */
export function hideCardTooltip(): void {
  if (tooltipEl) tooltipEl.style.display = 'none';
}
