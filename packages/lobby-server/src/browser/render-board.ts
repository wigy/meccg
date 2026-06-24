/**
 * @module render-board
 *
 * Renders the visual board area during setup phases: drafted characters,
 * company formations with sites, characters with items, and the set-aside
 * (collision) area. Handles item-draft target highlighting and character
 * placement interactions.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CardInstanceId, GameAction, CharacterInPlay, SiteInPlay, ViewCard } from '@meccg/shared';
import { cardImageProxyPath, viableActions, isCharacterCard, resolveThrallCharacterPairings } from '@meccg/shared';
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

/**
 * Render a player's drafted Fallen-wizard Stage resources (Thrall of the Voice,
 * Hidden Haven).
 *
 * An unassociated Stage resource shows full-size, exactly like a drafted
 * character. Once a site-targeting Stage resource (Hidden Haven) is paired with
 * a site, it shows as a minor item next to that site — mirroring how an attached
 * item renders beside its character. `siteDeck` is the viewing player's own site
 * deck (used to resolve the paired site); pass `undefined` for the opponent,
 * whose site deck is hidden.
 *
 * `skipInstanceIds` lists Stage resources already rendered beside their drafted
 * character (a Thrall of the Voice placed with a character) — they are omitted
 * here so a card is never shown twice.
 */
function renderDraftedStageResources(
  el: HTMLElement,
  dps: {
    readonly draftedStageResources: readonly { readonly definitionId: CardDefinitionId; readonly instanceId: CardInstanceId }[];
    readonly stageResourceSites?: readonly { readonly stageResourceInstanceId: CardInstanceId; readonly siteInstanceId: CardInstanceId }[];
  },
  siteDeck: readonly { readonly definitionId: CardDefinitionId; readonly instanceId: CardInstanceId }[] | undefined,
  cardPool: Readonly<Record<string, CardDefinition>>,
  skipInstanceIds: ReadonlySet<string>,
): void {
  const pairings = dps.stageResourceSites ?? [];
  for (const sr of dps.draftedStageResources) {
    if (skipInstanceIds.has(sr.instanceId as string)) continue;
    const srDef = cardPool[sr.definitionId as string];
    if (!srDef) continue;
    const srImgPath = cardImageProxyPath(srDef);
    if (!srImgPath) continue;

    const pairing = pairings.find(p => p.stageResourceInstanceId === sr.instanceId);
    const site = pairing && siteDeck ? siteDeck.find(c => c.instanceId === pairing.siteInstanceId) : undefined;
    const siteDef = site ? cardPool[site.definitionId as string] : undefined;
    const siteImgPath = siteDef ? cardImageProxyPath(siteDef) : undefined;

    if (site && siteDef && siteImgPath) {
      // Paired Hidden Haven: show the site full-size with the Stage resource as
      // a minor item beside it (like an item attached to a character).
      const group = document.createElement('div');
      group.className = 'drafted-card-group';
      group.appendChild(createCardImage(site.definitionId as string, siteDef, siteImgPath, 'drafted-card', site.instanceId as string));
      group.appendChild(createCardImage(sr.definitionId as string, srDef, srImgPath, 'drafted-card drafted-item', sr.instanceId as string));
      el.appendChild(group);
    } else {
      // Unassociated Stage resource: show full-size, exactly like a character.
      el.appendChild(createCardImage(sr.definitionId as string, srDef, srImgPath, 'drafted-card', sr.instanceId as string));
    }
  }
}

/**
 * Render the drafted characters in a flat row, hanging each character-bound
 * Stage resource (Thrall of the Voice) beside the character it will be placed
 * with — mirroring how a starting item renders beside its character, rather than
 * floating in the Stage-resource row. The pairing is resolved by the shared
 * {@link resolveThrallCharacterPairings} so the display matches the placement the
 * engine applies when the draft is finalised.
 *
 * @returns the instance ids of the Stage resources rendered beside a character,
 *   so the caller can omit them from the separate Stage-resource row.
 */
function renderDraftedCharactersWithThralls(
  el: HTMLElement,
  drafted: readonly { readonly definitionId: CardDefinitionId; readonly instanceId: CardInstanceId }[],
  draftedStageResources: readonly { readonly definitionId: CardDefinitionId; readonly instanceId: CardInstanceId }[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): ReadonlySet<string> {
  const charRefs = drafted.filter(c => isCharacterCard(cardPool[c.definitionId as string]));
  const pairings = resolveThrallCharacterPairings(charRefs, draftedStageResources, defId => cardPool[defId as string]);
  const thrallsByChar = new Map<string, { definitionId: CardDefinitionId; instanceId: CardInstanceId }[]>();
  const pairedResourceIds = new Set<string>();
  for (const pairing of pairings) {
    const sr = draftedStageResources.find(s => s.instanceId === pairing.stageResourceInstanceId);
    if (!sr) continue;
    pairedResourceIds.add(sr.instanceId as string);
    const list = thrallsByChar.get(pairing.characterInstanceId as string) ?? [];
    list.push(sr);
    thrallsByChar.set(pairing.characterInstanceId as string, list);
  }

  for (const card of drafted) {
    const def = cardPool[card.definitionId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;
    const img = createCardImage(card.definitionId as string, def, imgPath, 'drafted-card', card.instanceId as string);

    const thralls = thrallsByChar.get(card.instanceId as string) ?? [];
    if (thralls.length === 0) {
      el.appendChild(img);
      continue;
    }

    const group = document.createElement('div');
    group.className = 'drafted-card-group';
    group.appendChild(img);
    for (const thrall of thralls) {
      const tDef = cardPool[thrall.definitionId as string];
      if (!tDef) continue;
      const tImgPath = cardImageProxyPath(tDef);
      if (!tImgPath) continue;
      group.appendChild(createCardImage(thrall.definitionId as string, tDef, tImgPath, 'drafted-card drafted-item', thrall.instanceId as string));
    }
    el.appendChild(group);
  }
  return pairedResourceIds;
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

    // Drafted characters, each with its paired Thrall of the Voice hanging beside
    // it like a starting item. Returns the Thralls so rendered so they are not
    // also shown in the separate Stage-resource row below.
    const selfPairedThralls = renderDraftedCharactersWithThralls(
      selfEl, draft.draftState[selfIdx].drafted, draft.draftState[selfIdx].draftedStageResources, cardPool);
    // Remaining drafted Stage resources (Hidden Haven, or an unplaced Thrall) sit
    // alongside the drafted characters: full-size until associated, then as a
    // minor item beside the paired site.
    renderDraftedStageResources(selfEl, draft.draftState[selfIdx], view.self.siteDeck, cardPool, selfPairedThralls);

    // Show face-down pick if player has picked this round
    if (draft.draftState[selfIdx].currentPick !== null) {
      selfEl.appendChild(createFaceDownCard('Your pick (face down)'));
    }

    const oppPairedThralls = renderDraftedCharactersWithThralls(
      oppEl, draft.draftState[oppIdx].drafted, draft.draftState[oppIdx].draftedStageResources, cardPool);
    // Opponent's drafted Stage resources are public, but their site deck is
    // hidden, so paired sites are not resolvable — show them full-size.
    renderDraftedStageResources(oppEl, draft.draftState[oppIdx], undefined, cardPool, oppPairedThralls);

    // Show face-down pick if opponent has picked this round
    if (draft.draftState[oppIdx].currentPick !== null) {
      oppEl.appendChild(createFaceDownCard('Opponent pick (face down)'));
    }

    // Show this player's set-aside (collisioned) characters on the left
    const selfSetAside = draft.setAside[selfIdx];
    if (setAsideEl && selfSetAside.length > 0) {
      const label = document.createElement('div');
      label.className = 'set-aside-label';
      label.textContent = 'Set Aside';
      setAsideEl.appendChild(label);
      const resolvedSetAside = draftDefIds(selfSetAside);
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
