/**
 * @module render-card-preview
 *
 * Sets up the card preview panel in the visual view and provides the
 * buildCardAttributes function that renders card stats and properties.
 * Also handles the deck box compact/expanded toggle.
 */

import type { CardDefinition } from '@meccg/shared';
import { cardImageProxyPath, formatSignedNumber } from '@meccg/shared';
import { setDebugCardPool, REGION_ICON_CODES, SITE_ICON_CODES } from './render-text-format.js';

/** Format a race or skill identifier into its proper display name. */
function formatLabel(value: string): string {
  const special: Record<string, string> = {
    dunadan: 'Dúnadan',
    'awakened-plant': 'Awakened Plant',
    'pukel-creature': 'Pûkel-creature',
    'shadow-hold': 'Shadow-hold',
    'free-hold': 'Free-hold',
    'border-hold': 'Border-hold',
    'ruins-and-lairs': 'Ruins & Lairs',
    'shadow-land': 'Shadow-land',
    'dark-domain': 'Dark-domain',
    'free-domain': 'Free-domain',
    'border-land': 'Border-land',
    'coastal-sea': 'Coastal Sea',
    'double-wilderness': 'Double Wilderness',
    'double-shadow-land': 'Double Shadow-land',
    'double-coastal-sea': 'Double Coastal Sea',
    'gold-ring': 'Gold Ring',
  };
  return special[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

/** Format a card type string into a human-readable label. */
function formatCardType(cardType: string): string {
  return cardType
    .replace(/^(hero|minion|fallen-wizard|balrog)-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Add an attribute row to the info panel. Value may contain HTML. */
function addAttr(parent: HTMLElement, label: string, value: string | number): void {
  const row = document.createElement('div');
  row.className = 'card-preview-attr';
  row.innerHTML = `<span class="attr-label">${label}</span><span class="attr-value">${value}</span>`;
  parent.appendChild(row);
}

/** Render an array of region types as inline icon images. */
function regionIconsHtml(regions: readonly string[]): string {
  return regions.map(r => {
    const code = REGION_ICON_CODES[r];
    if (code) {
      return `<img src="/images/regions/${code}.png" alt="${formatLabel(r)}" title="${formatLabel(r)}" style="width:16px;height:16px;display:inline-block">`;
    }
    return formatLabel(r);
  }).join('');
}

/** Render an array of site types as inline icon images. */
function siteIconsHtml(siteTypes: readonly string[]): string {
  return siteTypes.map(s => {
    const code = SITE_ICON_CODES[s];
    if (code) {
      return `<img src="/images/sites/${code}.png" alt="${formatLabel(s)}" title="${formatLabel(s)}" style="width:16px;height:16px;display:inline-block">`;
    }
    return formatLabel(s);
  }).join('');
}

/** Build attribute rows for a card definition based on its type. */
export function buildCardAttributes(el: HTMLElement, def: CardDefinition): void {
  addAttr(el, 'Type', formatCardType(def.cardType));

  // Show keywords if present (environment, weapon, armor, etc.)
  const keywords = (def as { keywords?: readonly string[] }).keywords;
  if (keywords && keywords.length > 0) {
    addAttr(el, 'Keywords', keywords.map(formatLabel).join(', '));
  }

  switch (def.cardType) {
    case 'hero-character':
    case 'minion-character': {
      addAttr(el, 'Race', formatLabel(def.race));
      if (def.skills.length > 0) addAttr(el, 'Skills', def.skills.map(formatLabel).join(', '));
      addAttr(el, 'Prowess / Body', `${def.prowess} / ${def.body}`);
      if (def.mind !== null) addAttr(el, 'Mind', def.mind);
      addAttr(el, 'Direct Influence', def.directInfluence);
      addAttr(el, 'MP', def.marshallingPoints);
      if (def.corruptionModifier !== 0) addAttr(el, 'Corruption Mod', def.corruptionModifier);
      addAttr(el, 'Home Site', def.homesite);
      break;
    }
    case 'hero-resource-item':
    case 'minion-resource-item': {
      addAttr(el, 'Subtype', formatLabel(def.subtype));
      if (def.prowessModifier !== 0) addAttr(el, 'Prowess', formatSignedNumber(def.prowessModifier));
      if (def.bodyModifier !== 0) addAttr(el, 'Body', formatSignedNumber(def.bodyModifier));
      addAttr(el, 'MP', def.marshallingPoints);
      if (def.corruptionPoints !== 0) addAttr(el, 'Corruption', def.corruptionPoints);
      break;
    }
    case 'hero-resource-faction':
    case 'minion-resource-faction': {
      addAttr(el, 'Race', formatLabel(def.race));
      addAttr(el, 'Influence #', def.influenceNumber);
      addAttr(el, 'MP', def.marshallingPoints);
      addAttr(el, 'Playable At', def.playableAt.map(e => 'site' in e ? e.site : formatLabel(e.siteType)).join(', '));
      break;
    }
    case 'hero-resource-ally':
    case 'minion-resource-ally': {
      addAttr(el, 'Prowess / Body', `${def.prowess} / ${def.body}`);
      addAttr(el, 'Mind', def.mind);
      addAttr(el, 'MP', def.marshallingPoints);
      break;
    }
    case 'hazard-creature': {
      if (def.race) addAttr(el, 'Race', formatLabel(def.race));
      addAttr(el, 'Strikes', def.strikes);
      addAttr(el, 'Prowess', def.prowess);
      if (def.body !== null) addAttr(el, 'Body', def.body);
      if (def.killMarshallingPoints !== 0) addAttr(el, 'Kill MP', def.killMarshallingPoints);
      if (def.keyedTo.length > 0) {
        const entries: string[] = [];
        for (const key of def.keyedTo) {
          const parts: string[] = [];
          if (key.regionTypes && key.regionTypes.length > 0) parts.push(regionIconsHtml(key.regionTypes));
          if (key.regionNames && key.regionNames.length > 0) parts.push(key.regionNames.join(', '));
          if (key.siteTypes && key.siteTypes.length > 0) parts.push(siteIconsHtml(key.siteTypes));
          if (key.siteNames && key.siteNames.length > 0) parts.push(key.siteNames.join(', '));
          const entry = parts.join(' ');
          if (entry.length > 0) entries.push(entry);
        }
        if (entries.length > 0) addAttr(el, 'Keyed To', entries.join('; '));
      }
      break;
    }
    case 'hazard-event': {
      addAttr(el, 'Duration', formatLabel(def.eventType));
      break;
    }
    case 'hero-resource-event': {
      addAttr(el, 'Duration', formatLabel(def.eventType));
      if (def.marshallingPoints !== 0) addAttr(el, 'MP', def.marshallingPoints);
      break;
    }
    case 'hazard-corruption': {
      addAttr(el, 'Corruption', def.corruptionPoints);
      break;
    }
    case 'hero-site':
    case 'minion-site':
    case 'fallen-wizard-site':
    case 'balrog-site': {
      addAttr(el, 'Site Type', siteIconsHtml([def.siteType]));
      if (def.nearestHaven) addAttr(el, 'Nearest Haven', def.nearestHaven);
      if (def.sitePath.length > 0) addAttr(el, 'Path', regionIconsHtml(def.sitePath));
      if (def.havenPaths) {
        for (const [haven, path] of Object.entries(def.havenPaths)) {
          addAttr(el, haven, regionIconsHtml(path));
        }
      }
      if (def.playableResources.length > 0) addAttr(el, 'Resources', def.playableResources.map(formatLabel).join(', '));
      if (def.automaticAttacks.length > 0) {
        for (const aa of def.automaticAttacks) {
          addAttr(el, 'Auto-attack', `${aa.creatureType} (${aa.strikes}/${aa.prowess})`);
        }
      }
      break;
    }
    case 'region': {
      addAttr(el, 'Region Type', def.regionType);
      if (def.adjacentRegions.length > 0) addAttr(el, 'Adjacent', def.adjacentRegions.join(', '));
      break;
    }
  }
}

/**
 * Install click handlers on both deck boxes to toggle between compact
 * (dice/score/GI/name only) and full (with pile graphics) rendering.
 * Compact mode is the default; clicking the deck box expands it.
 * Clicking anywhere in the expanded box except on pile cells collapses it.
 */
let deckBoxToggleInstalled = false;
function installDeckBoxToggle(): void {
  if (deckBoxToggleInstalled) return;
  deckBoxToggleInstalled = true;

  for (const id of ['self-deck-box', 'opponent-deck-box']) {
    const box = document.getElementById(id);
    if (!box) continue;
    box.addEventListener('click', (e) => {
      const isCompact = box.classList.contains('deck-box--compact');
      if (isCompact) {
        // Expand: show piles
        box.classList.remove('deck-box--compact');
      } else {
        // If the click is on a pile cell, let it open the pile browser — don't collapse
        const target = e.target as HTMLElement;
        if (target.closest('.pile-cell')) return;
        // Otherwise collapse back to compact
        box.classList.add('deck-box--compact');
      }
    });
  }
}

/**
 * Set up card preview via event delegation on the visual view.
 * Hovering any card image shows a zoomed copy in the fixed preview area.
 */
export function setupCardPreview(cardPool: Readonly<Record<string, CardDefinition>>): void {
  setDebugCardPool(cardPool);
  installDeckBoxToggle();
  const view = document.getElementById('visual-view');
  const preview = document.getElementById('card-preview');
  if (!view || !preview) return;

  view.addEventListener('mouseover', (e) => {
    const img = (e.target as HTMLElement).closest('img');
    if (!img || !img.src) return;
    // Skip deck pile images, region type icons, and unknown card backs
    if (img.closest('.pile-cell, .region-type-icon')) return;
    if (!img.dataset.cardId) return;
    preview.innerHTML = '';
    const cardId = img.dataset.cardId;
    const def = cardId ? cardPool[cardId] : undefined;

    if (def) {
      const info = document.createElement('div');
      info.className = 'card-preview-info';

      // Name header
      const name = document.createElement('div');
      name.className = 'card-preview-name';
      name.textContent = def.name;
      info.appendChild(name);

      // Card image — use the definition's actual image if the displayed card
      // is face-down (e.g. on-guard cards showing card-back to the owner)
      const clone = document.createElement('img');
      const defImgPath = cardImageProxyPath(def);
      clone.src = defImgPath ?? img.src;
      clone.alt = img.alt;
      info.appendChild(clone);

      // Attributes
      buildCardAttributes(info, def);
      preview.appendChild(info);
    } else {
      const clone = document.createElement('img');
      clone.src = img.src;
      clone.alt = img.alt;
      preview.appendChild(clone);
    }
  });

  view.addEventListener('mouseout', (e) => {
    const img = (e.target as HTMLElement).closest('img');
    if (!img) return;
    preview.innerHTML = '';
  });

  view.addEventListener('click', () => {
    preview.innerHTML = '';
  });
}
