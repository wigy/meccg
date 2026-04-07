/**
 * @module render-chain
 *
 * Renders the chain of effects panel in the visual view.
 * Shows chain entries in LIFO order with card thumbnails, descriptions,
 * and status badges (resolved/negated).
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CardInstanceId, GameAction, ChainEntry } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';
import { getCachedInstanceLookup } from './render-text-format.js';

/**
 * Render the chain of effects panel in the visual view.
 *
 * When a chain is active, displays a floating panel on the right side
 * showing all chain entries in LIFO order (top = resolves first),
 * the current mode (declaring/resolving), and who has priority.
 */
export function renderChainPanel(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  _onAction: (action: GameAction) => void,
): void {
  const panel = document.getElementById('chain-panel');
  if (!panel) return;

  const chain = view.chain;
  if (!chain) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  panel.classList.remove('hidden');
  panel.innerHTML = '';

  // Header: mode and priority
  const header = document.createElement('div');
  header.className = 'chain-header';
  const modeLabel = chain.mode === 'declaring' ? 'Declaring' : 'Resolving';
  const isSelfPriority = chain.priority === view.self.id;
  const priorityName = isSelfPriority ? view.self.name : view.opponent.name;
  header.innerHTML = `<span class="chain-title">Chain of Effects</span>`
    + `<span class="chain-mode chain-mode--${chain.mode}">${modeLabel}</span>`;
  panel.appendChild(header);

  if (chain.mode === 'declaring') {
    const priorityEl = document.createElement('div');
    priorityEl.className = 'chain-priority';
    priorityEl.innerHTML = isSelfPriority
      ? '<span class="chain-priority--self">Your priority</span>'
      : `<span class="chain-priority--opp">${priorityName}'s priority</span>`;
    panel.appendChild(priorityEl);
  }

  // Chain entries in LIFO order (last entry = top of stack = resolves first)
  const entries = [...chain.entries].reverse();
  const list = document.createElement('div');
  list.className = 'chain-entries';

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'chain-entry';
    if (entry.resolved) row.classList.add('chain-entry--resolved');
    if (entry.negated) row.classList.add('chain-entry--negated');
    // Instance ID for FLIP animation tracking
    if (entry.card) {
      row.dataset.instanceId = entry.card.instanceId as string;
    }

    // Card thumbnail
    const thumb = createChainThumb(entry.card?.definitionId ?? null, cardPool);
    row.appendChild(thumb);

    // Card name and payload description
    const desc = document.createElement('span');
    desc.className = 'chain-entry__desc';
    desc.innerHTML = formatChainEntry(entry, view, cardPool);
    row.appendChild(desc);

    // Status badge
    if (entry.negated) {
      const status = document.createElement('span');
      status.className = 'chain-entry__status chain-entry__status--negated';
      status.textContent = 'negated';
      row.appendChild(status);
    } else if (entry.resolved) {
      const status = document.createElement('span');
      status.className = 'chain-entry__status chain-entry__status--resolved';
      status.textContent = 'resolved';
      row.appendChild(status);
    }

    list.appendChild(row);
  }
  panel.appendChild(list);

  // Nested chain indicator
  if (chain.parentChain) {
    const nested = document.createElement('div');
    nested.className = 'chain-nested';
    nested.textContent = `Sub-chain (${chain.restriction})`;
    panel.appendChild(nested);
  }
}

/**
 * Format a single chain entry into HTML for the chain panel.
 * Shows the card name (if known) and a description of the payload type,
 * including the target for short-events.
 */
function formatChainEntry(
  entry: ChainEntry,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const cardName = resolveCardName(entry.card?.definitionId ?? null, cardPool);
  const declarer = entry.declaredBy === view.self.id ? 'You' : view.opponent.name;

  switch (entry.payload.type) {
    case 'short-event': {
      const targetName = entry.payload.targetInstanceId
        ? resolveInstanceName(entry.payload.targetInstanceId, cachedInstanceLookup, cardPool)
        : null;
      const arrow = targetName ? ` <span class="chain-arrow">\u2192</span> ${targetName}` : '';
      return `<span class="chain-card-name">${cardName}</span>${arrow}`
        + `<span class="chain-declarer">${declarer}</span>`;
    }
    case 'creature':
      return `<span class="chain-card-name">${cardName}</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'corruption-card':
      return `<span class="chain-card-name">${cardName}</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'passive-condition':
      return `<span class="chain-card-name">${cardName}</span>`
        + ` <span class="chain-trigger">(${entry.payload.trigger})</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'activated-ability':
      return `<span class="chain-card-name">${cardName}</span> ability`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'on-guard-reveal':
      return `<span class="chain-card-name">${cardName}</span> on-guard`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'body-check':
      return `<span class="chain-card-name">${cardName}</span> body check`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'permanent-event':
      return `<span class="chain-card-name">${cardName}</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'long-event':
      return `<span class="chain-card-name">${cardName}</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'influence-attempt':
      return `<span class="chain-card-name">${cardName}</span> influence`
        + `<span class="chain-declarer">${declarer}</span>`;
  }
}

/** Create a small card thumbnail for a chain entry row. */
function createChainThumb(
  defId: CardDefinitionId | null,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const img = document.createElement('img');
  img.className = 'chain-entry__thumb';
  if (defId) {
    const def = cardPool[defId as string];
    if (def) {
      const imgPath = cardImageProxyPath(def);
      if (imgPath) {
        img.src = imgPath;
        img.alt = def.name;
        img.dataset.cardId = defId as string;
        return img;
      }
    }
  }
  img.src = '/images/card-back.jpg';
  img.alt = 'Unknown card';
  return img;
}

/** Resolve a card definition ID to its display name. */
function resolveCardName(
  defId: CardDefinitionId | null,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  if (!defId) return 'Unknown';
  const def = cardPool[defId as string];
  return def ? def.name : (defId as string);
}

/** Resolve a card instance ID to its display name via instance lookup. */
function resolveInstanceName(
  instanceId: CardInstanceId,
  instanceLookup: (id: CardInstanceId) => CardDefinitionId | undefined,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const defId = instanceLookup(instanceId);
  if (!defId) return '?';
  return resolveCardName(defId, cardPool);
}
