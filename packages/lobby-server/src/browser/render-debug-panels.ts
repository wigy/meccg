/**
 * @module render-debug-panels
 *
 * Rendering functions for the text-based debug view panels.
 * These show the raw game state, draft info, movement/hazard phase info,
 * site phase info, and Free Council info in the debug (text) view.
 */

import type { PlayerView, CardDefinition } from '@meccg/shared';
import { formatPlayerView, formatCardList, formatCardName, buildInstanceLookup, Phase, isCardHidden } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId } from '@meccg/shared';
import { $ } from './render-utils.js';
import {
  textToHtml, tagCardImages, renderCollapsibleJson,
  resetJsonNodeCounter, setCachedInstanceLookup, getCachedInstanceLookup,
  hideHoverImg, makeCardListsCollapsible, injectMPTooltips,
  injectDiceMarkers, hydrateDicePlaceholders, injectActivePlayerFrame,
  injectCombatFrame, injectChainFrame,
} from './render-text-format.js';

/** Render the game state using the shared ANSI formatter, converted to HTML. */
export function renderState(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  hideHoverImg();
  const el = $('state');
  const formatted = injectChainFrame(injectCombatFrame(injectActivePlayerFrame(injectDiceMarkers(injectMPTooltips(makeCardListsCollapsible(textToHtml(formatPlayerView(view, cardPool))))))));
  resetJsonNodeCounter();
  setCachedInstanceLookup(buildInstanceLookup(view));
  const jsonId = 'raw-state-json';
  const rawJson = `\n\n<span class="pile-toggle" style="width:auto;padding:0 0.4em" onclick="const t=document.getElementById('${jsonId}');t.classList.toggle('hidden');this.textContent=this.textContent==='+ Raw JSON'?'− Raw JSON':'+ Raw JSON'">+ Raw JSON</span>`
    + `<span id="${jsonId}" class="hidden">\n${renderCollapsibleJson(view, '')}</span>`;
  el.innerHTML = formatted + rawJson;
  hydrateDicePlaceholders(el);
  tagCardImages(el, cardPool);
}

/** Render draft-specific information with colored card names. */
export function renderDraft(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const section = $('draft-section');
  const el = $('draft');

  if (view.phaseState.phase !== 'setup' || view.phaseState.setupStep.step !== 'character-draft') {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const draft = view.phaseState.setupStep;
  const instanceLookup = getCachedInstanceLookup();
  const resolve = (ids: readonly CardInstanceId[]) =>
    ids.map(id => instanceLookup(id) ?? id as unknown as CardDefinitionId);
  const list = (ids: readonly CardInstanceId[]) => formatCardList(resolve(ids), cardPool);
  const instIds = (cards: readonly { readonly instanceId: CardInstanceId }[]) =>
    cards.map(c => c.instanceId);

  const lines: string[] = [];
  lines.push(`Draft round: ${draft.round}`);
  lines.push(`Pool [0]: ${list(instIds(draft.draftState[0].pool))}`);
  lines.push(`Drafted [0]: ${list(instIds(draft.draftState[0].drafted))}`);
  lines.push(`Pool [1]: ${list(instIds(draft.draftState[1].pool))}`);
  lines.push(`Drafted [1]: ${list(instIds(draft.draftState[1].drafted))}`);
  if (draft.setAside.length > 0) {
    lines.push(`Set aside: ${list(instIds(draft.setAside))}`);
  }

  el.innerHTML = textToHtml(lines.join('\n'));
  tagCardImages(el, cardPool);
}

/** Render Movement/Hazard phase information with key state details. */
export function renderMHInfo(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyNames: Readonly<Record<string, string>>,
): void {
  const section = $('mh-section');
  const el = $('mh-info');

  if (view.phaseState.phase !== Phase.MovementHazard) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const mh = view.phaseState;
  const lines: string[] = [];

  lines.push(`Step: ${mh.step}`);

  // Active company
  const selfIsResource = view.activePlayer === view.self.id;
  const resourceCompanies = selfIsResource ? view.self.companies : view.opponent.companies;
  if (mh.step !== 'select-company' && mh.activeCompanyIndex < resourceCompanies.length) {
    const activeCompany = resourceCompanies[mh.activeCompanyIndex];
    const name = companyNames[activeCompany.id as string] ?? `company #${mh.activeCompanyIndex}`;
    lines.push(`Active company: ${name}`);
  }

  // Handled companies
  if (mh.handledCompanyIds.length > 0) {
    const names = mh.handledCompanyIds.map(id => companyNames[id as string] ?? id).join(', ');
    lines.push(`Handled: ${names}`);
  }

  // Movement info
  if (mh.maxRegionDistance) {
    lines.push(`Max regions: ${mh.maxRegionDistance}`);
  }
  if (mh.movementType) {
    lines.push(`Movement type: ${mh.movementType}`);
  }
  if (mh.declaredRegionPath && mh.declaredRegionPath.length > 0) {
    const regionNames = mh.declaredRegionPath.map(id => {
      const def = cardPool[id as string];
      return def?.name ?? `${id}`;
    });
    lines.push(`Region path: ${regionNames.join(' → ')}`);
  }
  if (mh.resolvedSitePathNames.length > 0) {
    lines.push(`Site path: ${mh.resolvedSitePathNames.join(' → ')}`);
  }
  if (mh.destinationSiteName) {
    lines.push(`Destination: ${mh.destinationSiteName} (${mh.destinationSiteType ?? '?'})`);
  }

  // Hazard tracking
  const remaining = mh.hazardLimit - mh.hazardsPlayedThisCompany;
  lines.push(`Hazard limit: ${mh.hazardsPlayedThisCompany}/${mh.hazardLimit} played (${remaining} remaining)`);

  // Draw tracking
  lines.push(`Draws: resource ${mh.resourceDrawCount}/${mh.resourceDrawMax}, hazard ${mh.hazardDrawCount}/${mh.hazardDrawMax}`);

  // Pass state
  const passInfo: string[] = [];
  if (mh.resourcePlayerPassed) passInfo.push('resource');
  if (mh.hazardPlayerPassed) passInfo.push('hazard');
  if (passInfo.length > 0) {
    lines.push(`Passed: ${passInfo.join(', ')}`);
  }

  // Flags
  if (mh.onGuardPlacedThisCompany) lines.push('On-guard card placed');
  if (mh.returnedToOrigin) lines.push('Returned to origin');

  el.innerHTML = textToHtml(lines.join('\n'));
}

/** Render site phase debug info panel (step, active company, handled companies, flags). */
export function renderSiteInfo(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyNames: Readonly<Record<string, string>>,
): void {
  const section = $('site-section');
  const el = $('site-info');

  if (view.phaseState.phase !== Phase.Site) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const site = view.phaseState;
  const lines: string[] = [];

  lines.push(`Step: ${site.step}`);

  // Active company
  const selfIsResource = view.activePlayer === view.self.id;
  const resourceCompanies = selfIsResource ? view.self.companies : view.opponent.companies;
  if (site.step !== 'select-company' && site.activeCompanyIndex < resourceCompanies.length) {
    const activeCompany = resourceCompanies[site.activeCompanyIndex];
    const name = companyNames[activeCompany.id as string] ?? `company #${site.activeCompanyIndex}`;
    lines.push(`Active company: ${name}`);
  }

  // Handled companies
  if (site.handledCompanyIds.length > 0) {
    const names = site.handledCompanyIds.map(id => companyNames[id as string] ?? id).join(', ');
    lines.push(`Handled: ${names}`);
  }

  // Entry and resource flags
  if (site.siteEntered) lines.push('Site entered');
  if (site.resourcePlayed) lines.push('Resource played');
  if (site.minorItemAvailable) lines.push('Minor item available');

  // Declared attacks
  if (site.declaredAgentAttack) {
    lines.push(`Agent attack declared`);
  }

  // Auto-attacks
  if (site.automaticAttacksResolved > 0) {
    lines.push(`Auto-attacks resolved: ${site.automaticAttacksResolved}`);
  }

  el.innerHTML = textToHtml(lines.join('\n'));
}

/** Render Free Council debug info panel (step, current player, checked characters). */
export function renderFreeCouncilInfo(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const section = $('fc-section');
  const el = $('fc-info');

  if (view.phaseState.phase !== Phase.FreeCouncil) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const fc = view.phaseState;

  /** Format a character instance ID as a colored, hoverable card name. */
  function charName(id: string): string {
    const char = view.self.characters[id] ?? view.opponent.characters[id];
    if (!char) return id;
    const def = cardPool[char.definitionId as string];
    return def ? formatCardName(def) : id;
  }

  const lines: string[] = [];

  lines.push(`Step: ${fc.step}`);
  if (fc.tiebreaker) lines.push('Tiebreaker round');

  const currentName = fc.currentPlayer === view.self.id
    ? view.self.name : view.opponent.name;
  lines.push(`Current player: ${currentName}`);
  if (fc.firstPlayerDone) lines.push('First player done');

  // Checked characters
  if (fc.checkedCharacters.length > 0) {
    lines.push(`Checked: ${fc.checkedCharacters.map(charName).join(', ')}`);
  }

  // Unchecked characters for current player
  const isSelfTurn = fc.currentPlayer === view.self.id;
  const chars = isSelfTurn ? view.self.characters : view.opponent.characters;
  const checkedSet = new Set(fc.checkedCharacters);
  const unchecked = Object.keys(chars).filter(id => !checkedSet.has(id));
  if (unchecked.length > 0) {
    lines.push(`Unchecked: ${unchecked.map(charName).join(', ')}`);
  }

  el.innerHTML = textToHtml(lines.join('\n'));
  tagCardImages(el, cardPool);
}

/**
 * Check whether a card list contains real card IDs (not hidden placeholders).
 * Exported for use by other render modules (hand, board).
 */
export function hasRealCards(cards: readonly ({ definitionId: CardDefinitionId } | CardInstanceId)[]): boolean {
  if (cards.length === 0) return false;
  const first = cards[0];
  // ViewCard objects have a definitionId property; raw CardInstanceId values are strings
  if (typeof first === 'object' && first !== null && 'definitionId' in first) {
    return !isCardHidden(first.definitionId);
  }
  return (first as string) !== 'unknown-card' && (first as string) !== 'unknown-instance';
}

/**
 * Given two card lists (one per player), return the index whose cards are real
 * (not redacted to placeholders). Defaults to 0 when both are empty.
 */
export function findSelfIndex(
  a: readonly ({ definitionId: CardDefinitionId } | CardInstanceId)[],
  b: readonly ({ definitionId: CardDefinitionId } | CardInstanceId)[],
): number {
  return hasRealCards(a) ? 0 : hasRealCards(b) ? 1 : 0;
}
