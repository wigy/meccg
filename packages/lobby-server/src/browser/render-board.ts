/**
 * @module render-board
 *
 * Renders the visual board area during setup phases: drafted characters,
 * company formations with sites, characters with items, and the set-aside
 * (collision) area. Handles item-draft target highlighting and character
 * placement interactions.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CardInstanceId, GameAction, CharacterInPlay, SiteInPlay, ViewCard, Alignment } from '@meccg/shared';
import { cardImageProxyPath, viableActions, isCharacterCard, resolveThrallCharacterPairings } from '@meccg/shared';
import { createCardImage, createCardImageFromDefId, createFaceDownCard, appendItemCards } from './render-utils.js';
import { getCachedInstanceLookup } from './render-text-format.js';
import { getSelectedItemDefId, setSelectedItemDefId, setTargetingInstruction } from './render-selection-state.js';
import { findSelfIndex } from './render-debug-panels.js';

/** Render a row of card images from definition IDs. */
function renderCardRow(el: HTMLElement, defIds: readonly CardDefinitionId[], cardPool: Readonly<Record<string, CardDefinition>>): void {
  for (const defId of defIds) {
    const img = createCardImageFromDefId(defId, cardPool);
    if (img) el.appendChild(img);
  }
}

/**
 * Render a player's drafted Fallen-wizard Stage resources (Thrall of the Voice,
 * Hidden Haven).
 *
 * An unassociated Stage resource shows full-size, exactly like a drafted
 * character. Once a site-targeting Stage resource (Hidden Haven) is paired with
 * a site, it shows as a minor item next to that site — mirroring how an attached
 * item renders beside its character. `siteDeck` is the site deck used to resolve
 * the paired site — the viewing player's own for their row, or the opponent's
 * (where the projection un-redacts the brought-out Hidden Haven site, CRF 22)
 * for theirs. Pass `undefined` only when no site deck is available.
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
 * Other character-bound Stage resources (Gandalf's Friend, Squire of the Hunt,
 * etc.) have no rules-mandated "best" character the way Thrall's agent/mind
 * preference does, so — unlike Thrall — they are NOT paired here. The engine
 * defers them to the item-draft step for the player to assign explicitly (see
 * `applyDraftResults`), so they render full-size in the Stage-resource row
 * like any other unpaired resource until then.
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
    const img = createCardImageFromDefId(card.definitionId, cardPool, 'drafted-card', card.instanceId as string);
    if (!img) continue;

    const thralls = thrallsByChar.get(card.instanceId as string) ?? [];
    if (thralls.length === 0) {
      el.appendChild(img);
      continue;
    }

    const group = document.createElement('div');
    group.className = 'drafted-card-group';
    group.appendChild(img);
    for (const thrall of thralls) {
      const tImg = createCardImageFromDefId(thrall.definitionId, cardPool, 'drafted-card drafted-item', thrall.instanceId as string);
      if (tImg) group.appendChild(tImg);
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
  bearerAlignment: Alignment,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  for (const charInstId of charInstIds) {
    const defId = cachedInstanceLookup(charInstId as CardInstanceId);
    if (!defId) continue;
    const img = createCardImageFromDefId(defId, cardPool, 'drafted-card', charInstId as string);
    if (!img) continue;

    const char = characters[charInstId as string];
    const hasItems = char && char.items.length > 0;

    if (!hasItems) {
      el.appendChild(img);
      continue;
    }

    const group = document.createElement('div');
    group.className = 'drafted-card-group';
    group.appendChild(img);
    appendItemCards(group, char, cardPool, view, bearerAlignment);
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
  bearerAlignment: Alignment,
): void {
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const sites = company.currentSite ? [company.currentSite] : [];
    if (i > 0 && (sites.length > 0 || company.characters.length > 0)) {
      const spacer = document.createElement('div');
      spacer.className = 'drafted-spacer';
      el.appendChild(spacer);
    }
    renderSitesAndCharacters(el, sites, company.characters, view, characters, cardPool, bearerAlignment);
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

      const placeAction = viableActions(view.legalActions).find(
        a => a.type === 'place-character' && a.characterInstanceId === charInstId,
      ) ?? null;
      const img = createCardImageFromDefId(defId, cardPool,
        placeAction ? 'drafted-card drafted-card-selectable' : 'drafted-card', charInstId as string);
      if (!img) continue;

      const char = view.self.characters[charInstId];
      const hasItems = char && char.items.length > 0;

      const group = hasItems ? document.createElement('div') : null;
      if (group) group.className = 'drafted-card-group';

      if (group && char) {
        group.appendChild(img);
        appendItemCards(group, char, cardPool, view, view.self.alignment);
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
  bearerAlignment: Alignment,
  separateSites = false,
): void {
  for (const site of sites) {
    const img = createCardImageFromDefId(site.definitionId, cardPool, 'drafted-card', site.instanceId as string);
    if (img) el.appendChild(img);
  }

  if (separateSites && sites.length > 0 && charInstIds.length > 0) {
    const spacer = document.createElement('div');
    spacer.className = 'drafted-spacer';
    el.appendChild(spacer);
  }
  renderCharactersWithItems(el, charInstIds, view, characters, cardPool, bearerAlignment);
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

    // Find the matching action for this character + selected item
    const charIdStr = charInstId as string;
    const targetAction = selectedItemDefId
      ? viableActions(view.legalActions).find(
        a => a.type === 'assign-starting-item'
          && a.itemDefId === selectedItemDefId
          && (a.characterInstanceId as string) === charIdStr,
      ) ?? null
      : null;

    const img = createCardImageFromDefId(defId, cardPool,
      targetAction ? 'drafted-card drafted-card-target' : 'drafted-card', charInstId as string);
    if (!img) continue;

    const char = view.self.characters[charIdStr as CardInstanceId];
    const hasItems = char && char.items.length > 0;

    const group = hasItems ? document.createElement('div') : null;
    if (group) group.className = 'drafted-card-group';

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
      appendItemCards(group, char, cardPool, view, view.self.alignment);
      el.appendChild(group);
    } else {
      el.appendChild(img);
    }
  }
}

/**
 * Compute the instruction prompt for the current setup step, or `null` when the
 * viewer has nothing to do (wrong phase, or already finished the step and is
 * waiting for the opponent).
 *
 * During setup the phase meter only shows a terse step label (e.g. "Deck
 * Draft"), which does not explain what the player must actually do — several
 * steps require clicking cards that carry no obvious call to action. This
 * mirrors the {@link module:company-view.selectCompanyPrompt} pattern used
 * during normal play: a prominent banner is the only on-screen text telling the
 * player what the game is waiting for. Returns a prompt only while the viewer
 * still holds a viable action for the step, so a player who has pressed
 * Done/Continue (and now has no viable actions) sees nothing.
 *
 * Exported for unit testing (pure — no DOM access).
 */
export function setupStepPrompt(
  view: PlayerView,
): { readonly title: string; readonly detail: string } | null {
  if (view.phaseState.phase !== 'setup') return null;
  // A player who has finished this step has no viable actions and is merely
  // waiting for the opponent — don't nag them with an instruction.
  if (viableActions(view.legalActions).length === 0) return null;

  switch (view.phaseState.setupStep.step) {
    case 'character-deck-draft':
      return {
        title: 'Build Your Play Deck',
        detail: 'Click each character you want in your play deck to add it (up to 10 non-avatars). Click Done when finished.',
      };
    case 'item-draft':
      return {
        title: 'Assign Starting Items',
        detail: 'Click an item, then the character to equip it. Click Continue when finished.',
      };
    case 'starting-site-selection':
      return {
        title: 'Choose Starting Sites',
        detail: 'Pick your starting sites from your site deck, then click Continue.',
      };
    case 'character-placement':
      return {
        title: 'Arrange Companies',
        detail: 'Organise your characters into companies, then click Done.',
      };
    default:
      return null;
  }
}

/**
 * Render the setup-step instruction banner at the top of the visual board when
 * a prompt is active (see {@link setupStepPrompt}). The banner is a managed
 * `#setup-banner` element that is removed and rebuilt on every render, so it
 * disappears once the step is done or the game leaves setup.
 */
function renderSetupBanner(view: PlayerView): void {
  document.getElementById('setup-banner')?.remove();
  // Tutorial games: the tutorial panel already tells the player what to do at
  // every step, so the generic setup prompt would be a confusing duplicate.
  if (view.tutorial) return;
  const prompt = setupStepPrompt(view);
  if (!prompt) return;
  const board = document.getElementById('visual-board');
  if (!board) return;

  const row = document.createElement('div');
  row.id = 'setup-banner';
  row.className = 'situation-banner-row';

  const banner = document.createElement('div');
  banner.className = 'situation-banner';
  banner.textContent = prompt.title;

  const detail = document.createElement('div');
  detail.className = 'situation-banner-detail';
  detail.textContent = prompt.detail;
  banner.appendChild(detail);

  row.appendChild(banner);
  board.prepend(row);
}

/** Render characters on the visual board during setup phases. */
export function renderDrafted(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  const _cachedInstanceLookup = getCachedInstanceLookup();
  // The banner reflects the current step (and clears itself outside setup), so
  // it must be refreshed before the early return below.
  renderSetupBanner(view);
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
    // Opponent's drafted Stage resources are public. Their site deck is hidden,
    // but a Hidden Haven's paired site is "brought out" and revealed (CRF 22),
    // so the projection un-redacts that one site in the opponent's site deck —
    // pass it through so the paired site resolves and renders beside the card.
    renderDraftedStageResources(oppEl, draft.draftState[oppIdx], view.opponent.siteDeck, cardPool, oppPairedThralls);

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
        const img = createCardImageFromDefId(defId, cardPool, 'set-aside-card');
        if (!img) continue;
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
    renderCharactersWithItems(oppEl, oppCharIds, view, view.opponent.characters, cardPool, view.opponent.alignment);
    return;
  }

  // During character-deck-draft, show company characters on the table
  if (step === 'character-deck-draft') {
    const selfCharIds = view.self.companies.flatMap(c => c.characters);
    renderCharactersWithItems(selfEl, selfCharIds, view, view.self.characters, cardPool, view.self.alignment);

    const oppCharIds = view.opponent.companies.flatMap(c => c.characters);
    renderCharactersWithItems(oppEl, oppCharIds, view, view.opponent.characters, cardPool, view.opponent.alignment);
  }

  // During site selection, show selected sites then a gap then company characters
  if (step === 'starting-site-selection') {
    const siteState = view.phaseState.setupStep.siteSelectionState;
    const selfIdx = view.selfIndex;
    const oppIdx = 1 - selfIdx;

    const selfChars = view.self.companies.flatMap(c => c.characters);
    renderSitesAndCharacters(selfEl, siteState[selfIdx].selectedSites, selfChars, view, view.self.characters, cardPool, view.self.alignment, true);
    const oppChars = view.opponent.companies.flatMap(c => c.characters);
    renderSitesAndCharacters(oppEl, siteState[oppIdx].selectedSites, oppChars, view, view.opponent.characters, cardPool, view.opponent.alignment, true);
  }

  // During character placement, show companies with clickable characters
  if (step === 'character-placement') {
    if (view.self.companies.length > 1 && onAction) {
      renderPlacementCompanies(selfEl, view, cardPool, onAction);
    } else {
      renderCompanies(selfEl, view.self.companies, view, view.self.characters, cardPool, view.self.alignment);
    }
    renderCompanies(oppEl, view.opponent.companies, view, view.opponent.characters, cardPool, view.opponent.alignment);
  }

  // During deck shuffle and initial draw, show companies on the table
  if (step === 'deck-shuffle' || step === 'initial-draw') {
    renderCompanies(selfEl, view.self.companies, view, view.self.characters, cardPool, view.self.alignment);
    renderCompanies(oppEl, view.opponent.companies, view, view.opponent.characters, cardPool, view.opponent.alignment);
  }
}
