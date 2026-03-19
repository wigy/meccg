/**
 * @module render
 *
 * DOM rendering functions for the web client. Renders game state,
 * action buttons, draft info, and a message log.
 */

import type { PlayerView, GameAction, CardDefinition, CardDefinitionId } from '@meccg/shared';
import { describeAction } from '@meccg/shared';

/** Get an element by ID, throwing if not found. */
function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

/** Render the game state as formatted JSON. */
export function renderState(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const el = $('state');

  const resolveName = (id: string) => cardPool[id]?.name ?? id;

  // Build a readable summary
  const lines: string[] = [];
  lines.push(`Turn ${view.turnNumber} — Phase: ${view.phaseState.phase}`);
  lines.push(`Active: ${view.activePlayer ?? '(simultaneous)'}`);
  lines.push('');

  // Self
  const self = view.self;
  lines.push(`${self.name}${self.wizard ? ` (${self.wizard})` : ''}:`);
  lines.push(`  Hand: ${self.hand.length} cards | Deck: ${self.playDeckSize} | Discard: ${self.discardPile.length}`);
  for (const company of self.companies) {
    const site = resolveName(view.visibleInstances[company.currentSite as string] as string ?? '');
    lines.push(`  Company @ ${site}:`);
    for (const charId of company.characters) {
      const char = self.characters[charId as string];
      if (!char) continue;
      const charName = resolveName(view.visibleInstances[charId as string] as string ?? '');
      const status = char.status !== 'untapped' ? ` (${char.status})` : '';
      lines.push(`    ${charName}${status}`);
      for (const itemId of char.items) {
        const itemName = resolveName(view.visibleInstances[itemId as string] as string ?? '');
        lines.push(`      ${itemName}`);
      }
    }
  }

  // Opponent
  const opp = view.opponent;
  lines.push('');
  lines.push(`${opp.name}${opp.wizard ? ` (${opp.wizard})` : ''}:`);
  lines.push(`  Hand: ${opp.handSize} cards | Deck: ${opp.playDeckSize} | Discard: ${opp.discardPile.length}`);
  for (const company of opp.companies) {
    const site = resolveName(view.visibleInstances[company.currentSite as string] as string ?? '');
    lines.push(`  Company @ ${site}:`);
    for (const charId of company.characters) {
      const char = opp.characters[charId as string];
      if (!char) continue;
      const charName = resolveName(view.visibleInstances[charId as string] as string ?? '');
      lines.push(`    ${charName}`);
    }
  }

  el.textContent = lines.join('\n');
}

/** Render draft-specific information. */
export function renderDraft(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const el = $('draft');

  if (view.phaseState.phase !== 'character-draft') {
    el.textContent = '';
    return;
  }

  const draft = view.phaseState;
  const resolveName = (id: CardDefinitionId) => cardPool[id as string]?.name ?? id;
  const nameList = (ids: readonly CardDefinitionId[]) =>
    ids.length > 0 ? ids.map(id => resolveName(id)).join(', ') : '(none)';

  const lines: string[] = [];
  lines.push(`Draft round: ${draft.round}`);
  lines.push(`Pool [0]: ${nameList(draft.draftState[0].pool)}`);
  lines.push(`Drafted [0]: ${nameList(draft.draftState[0].drafted)}`);
  lines.push(`Pool [1]: ${nameList(draft.draftState[1].pool)}`);
  lines.push(`Drafted [1]: ${nameList(draft.draftState[1].drafted)}`);
  if (draft.setAside.length > 0) {
    lines.push(`Set aside: ${nameList(draft.setAside)}`);
  }

  el.textContent = lines.join('\n');
}

/** Render action buttons. */
export function renderActions(
  actions: readonly GameAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onClick: (action: GameAction) => void,
): void {
  const el = $('actions');
  el.innerHTML = '';

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.textContent = describeAction(action, cardPool);
    btn.addEventListener('click', () => onClick(action));
    el.appendChild(btn);
  }
}

/** Append a message to the log. Auto-scrolls to bottom. */
export function renderLog(message: string): void {
  const el = $('log');
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
