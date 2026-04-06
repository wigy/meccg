/**
 * @module render-board
 *
 * Renders the visual board area during setup phases: drafted characters,
 * company formations with sites, characters with items, and the set-aside
 * (collision) area. Handles item-draft target highlighting and character
 * placement interactions.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CardInstanceId, GameAction, CharacterInPlay, SiteInPlay, ViewCard } from '@meccg/shared';
import { cardImageProxyPath, viableActions } from '@meccg/shared';
import { createCardImage, createFaceDownCard, appendItemCards } from './render-utils.js';
import { getCachedInstanceLookup } from './render-text-format.js';
import { getSelectedItemDefId, setSelectedItemDefId, setTargetingInstruction } from './render-selection-state.js';
import { findSelfIndex } from './render-debug-panels.js';

/** Render a row of card images from definition IDs. */
function renderCardRow(el: HTMLElement, defIds: readonly CardDefinitionId[], cardPool: Readonly<Record<string, CardDefinition>>): void {
  for (const defId of defIds) {
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;
    el.appendChild(createCardImage(defId as string, def, imgPath));
  }
}

/** Render company characters with their items displayed to the right of each character. */
function renderCharactersWithItems(
  el: HTMLElement,
  charInstIds: readonly { toString(): string }[],
  view: PlayerView,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  for (const charInstId of charInstIds) {
    const defId = cachedInstanceLookup(charInstId as CardInstanceId);
    if (!defId) continue;
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const char = characters[charInstId as string];
    const hasItems = char && char.items.length > 0;

    const img = createCardImage(defId as string, def, imgPath, 'drafted-card', charInstId as string);
    if (!hasItems) {
      el.appendChild(img);
      continue;
    }

    const group = document.createElement('div');
    group.className = 'drafted-card-group';
    group.appendChild(img);
    appendItemCards(group, char, cardPool);
    el.appendChild(group);
  }
}

/** Render companies with their sites, characters, and items on the table. */
function renderCompanies(
  el: HTMLElement,
  companies: readonly { characters: readonly CardInstanceId[]; currentSite: SiteInPlay | null }[],
  view: PlayerView,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const sites = company.currentSite ? [company.currentSite] : [];
    if (i > 0 && (sites.length > 0 || company.characters.length > 0)) {
      const spacer = document.createElement('div');
      spacer.className = 'drafted-spacer';
      el.appendChild(spacer);
    }
    renderSitesAndCharacters(el, sites, company.characters, view, characters, cardPool);
  }
}

/**
 * Render self companies during character placement with clickable characters.
 * Each character with a place-character action gets a golden highlight and
 * clicking it directly moves the character to the other company.
 */
function renderPlacementCompanies(
  el: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  for (let i = 0; i < view.self.companies.length; i++) {
    const company = view.self.companies[i];
    if (i > 0) {
      const spacer = document.createElement('div');
      spacer.className = 'drafted-spacer';
      el.appendChild(spacer);
    }

    // Render site card
    if (company.currentSite) {
      const siteDefId = cachedInstanceLookup(company.currentSite.instanceId);
      if (siteDefId) renderCardRow(el, [siteDefId], cardPool);
    }

    // Render characters — clickable to move to the other company
    for (const charInstId of company.characters) {
      const defId = cachedInstanceLookup(charInstId);
      if (!defId) continue;
      const def = cardPool[defId as string];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;

      const placeAction = viableActions(view.legalActions).find(
        a => a.type === 'place-character' && a.characterInstanceId === charInstId,
      ) ?? null;
      const char = view.self.characters[charInstId as string];
      const hasItems = char && char.items.length > 0;

      const group = hasItems ? document.createElement('div') : null;
      if (group) group.className = 'drafted-card-group';

      const img = createCardImage(defId as string, def, imgPath,
        placeAction ? 'drafted-card drafted-card-selectable' : 'drafted-card', charInstId as string);

      if (group && char) {
        group.appendChild(img);
        appendItemCards(group, char, cardPool);
        el.appendChild(group);
      } else {
        el.appendChild(img);
      }

      if (placeAction) {
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => onAction(placeAction));
      }
    }
  }
}

/** Render sites and company characters on the table. Spacer added only when sites are unassigned. */
function renderSitesAndCharacters(
  el: HTMLElement,
  sites: readonly ViewCard[],
  charInstIds: readonly CardInstanceId[],
  view: PlayerView,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
  separateSites = false,
): void {
  for (const site of sites) {
    const def = cardPool[site.definitionId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;
    el.appendChild(createCardImage(site.definitionId as string, def, imgPath, 'drafted-card', site.instanceId as string));
  }

  if (separateSites && sites.length > 0 && charInstIds.length > 0) {
    const spacer = document.createElement('div');
    spacer.className = 'drafted-spacer';
    el.appendChild(spacer);
  }
  renderCharactersWithItems(el, charInstIds, view, characters, cardPool);
}

/**
 * Render self characters during item draft with target highlighting.
 * When an item is selected, valid target characters glow and become clickable.
 */
function renderItemDraftTargets(
  el: HTMLElement,
  view: PlayerView,
  charInstanceIds: readonly { toString(): string }[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const selectedItemDefId = getSelectedItemDefId();
  for (const charInstId of charInstanceIds) {
    const defId = cachedInstanceLookup(charInstId as CardInstanceId);
    if (!defId) continue;
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    // Find the matching action for this character + selected item
    const charIdStr = charInstId as string;
    const targetAction = selectedItemDefId
      ? viableActions(view.legalActions).find(
        a => a.type === 'assign-starting-item'
          && a.itemDefId === selectedItemDefId
          && (a.characterInstanceId as string) === charIdStr,
      ) ?? null
      : null;

    const char = view.self.characters[charIdStr];
    const hasItems = char && char.items.length > 0;

    const group = hasItems ? document.createElement('div') : null;
    if (group) group.className = 'drafted-card-group';

    const img = createCardImage(defId as string, def, imgPath,
      targetAction ? 'drafted-card drafted-card-target' : 'drafted-card', charInstId as string);

    if (targetAction && onAction) {
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
        setSelectedItemDefId(null);
        setTargetingInstruction(null);
        onAction(targetAction);
      });
    }

    if (group && char) {
      group.appendChild(img);
      appendItemCards(group, char, cardPool);
      el.appendChild(group);
    } else {
      el.appendChild(img);
    }
  }
}

/** Render characters on the visual board during setup phases. */
export function renderDrafted(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  const _cachedInstanceLookup = getCachedInstanceLookup();
  const selfEl = document.getElementById('drafted-self');
  const oppEl = document.getElementById('drafted-opponent');
  const setAsideEl = document.getElementById('set-aside');
  if (!selfEl || !oppEl) return;
  selfEl.innerHTML = '';
  oppEl.innerHTML = '';
  if (setAsideEl) setAsideEl.innerHTML = '';

  if (view.phaseState.phase !== 'setup') return;

  const step = view.phaseState.setupStep.step;

  if (step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    if (draft.step !== 'character-draft') return;
    const selfIdx = findSelfIndex(draft.draftState[0].pool, draft.draftState[1].pool);
    const oppIdx = 1 - selfIdx;

    /** Extract definition IDs from draft CardInstance arrays. */
    const draftDefIds = (cards: readonly { readonly definitionId: CardDefinitionId }[]): CardDefinitionId[] =>
      cards.map(c => c.definitionId);

    renderCardRow(selfEl, draftDefIds(draft.draftState[selfIdx].drafted), cardPool);

    // Show face-down pick if player has picked this round
    if (draft.draftState[selfIdx].currentPick !== null) {
      selfEl.appendChild(createFaceDownCard('Your pick (face down)'));
    }

    renderCardRow(oppEl, draftDefIds(draft.draftState[oppIdx].drafted), cardPool);

    // Show face-down pick if opponent has picked this round
    if (draft.draftState[oppIdx].currentPick !== null) {
      oppEl.appendChild(createFaceDownCard('Opponent pick (face down)'));
    }

    // Show set-aside (collisioned) characters on the left
    if (setAsideEl && draft.setAside.length > 0) {
      const label = document.createElement('div');
      label.className = 'set-aside-label';
      label.textContent = 'Set Aside';
      setAsideEl.appendChild(label);
      const resolvedSetAside = draftDefIds(draft.setAside);
      for (let j = 0; j < resolvedSetAside.length; j++) {
        const defId = resolvedSetAside[j];
        const def = cardPool[defId as string];
        if (!def) continue;
        const imgPath = cardImageProxyPath(def);
        if (!imgPath) continue;
        const img = createCardImage(defId as string, def, imgPath, 'set-aside-card');
        const baseZ = j + 1;
        img.style.zIndex = String(baseZ);
        img.addEventListener('mouseenter', () => { img.style.zIndex = '200'; });
        img.addEventListener('mouseleave', () => { img.style.zIndex = String(baseZ); });
        setAsideEl.appendChild(img);
      }
    }
    return;
  }

  // During item-draft, show company characters as clickable targets
  if (step === 'item-draft') {
    const selfCharIds = view.self.companies.flatMap(c => c.characters);
    renderItemDraftTargets(selfEl, view, selfCharIds, cardPool, onAction);

    const oppCharIds = view.opponent.companies.flatMap(c => c.characters);
    renderCharactersWithItems(oppEl, oppCharIds, view, view.opponent.characters, cardPool);
    return;
  }

  // During character-deck-draft, show company characters on the table
  if (step === 'character-deck-draft') {
    const selfCharIds = view.self.companies.flatMap(c => c.characters);
    renderCharactersWithItems(selfEl, selfCharIds, view, view.self.characters, cardPool);

    const oppCharIds = view.opponent.companies.flatMap(c => c.characters);
    renderCharactersWithItems(oppEl, oppCharIds, view, view.opponent.characters, cardPool);
  }

  // During site selection, show selected sites then a gap then company characters
  if (step === 'starting-site-selection') {
    const siteState = view.phaseState.setupStep.siteSelectionState;
    const selfIdx = view.selfIndex;
    const oppIdx = 1 - selfIdx;

    const selfChars = view.self.companies.flatMap(c => c.characters);
    renderSitesAndCharacters(selfEl, siteState[selfIdx].selectedSites, selfChars, view, view.self.characters, cardPool, true);
    const oppChars = view.opponent.companies.flatMap(c => c.characters);
    renderSitesAndCharacters(oppEl, siteState[oppIdx].selectedSites, oppChars, view, view.opponent.characters, cardPool, true);
  }

  // During character placement, show companies with clickable characters
  if (step === 'character-placement') {
    if (view.self.companies.length > 1 && onAction) {
      renderPlacementCompanies(selfEl, view, cardPool, onAction);
    } else {
      renderCompanies(selfEl, view.self.companies, view, view.self.characters, cardPool);
    }
    renderCompanies(oppEl, view.opponent.companies, view, view.opponent.characters, cardPool);
  }

  // During deck shuffle and initial draw, show companies on the table
  if (step === 'deck-shuffle' || step === 'initial-draw') {
    renderCompanies(selfEl, view.self.companies, view, view.self.characters, cardPool);
    renderCompanies(oppEl, view.opponent.companies, view, view.opponent.characters, cardPool);
  }
}
