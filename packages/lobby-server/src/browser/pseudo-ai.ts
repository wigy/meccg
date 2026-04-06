/**
 * @module pseudo-ai
 *
 * Pseudo-AI mode: the human player controls both sides of the game.
 * This module manages the second WebSocket connection (for the AI player),
 * renders the action panel where the human picks AI actions, and handles
 * communication between the two connections.
 */

import type { ClientMessage, GameAction, JoinMessage, ServerMessage } from '@meccg/shared';
import { Alignment, buildCompanyNames, buildInstanceLookup, describeAction } from '@meccg/shared';
import { appState, cardPool, buildJoinFromDeck, type FullDeck } from './app-state.js';

/** A described action for the pseudo-AI panel: pre-rendered text + the raw action and viability. */
export interface DescribedAction {
  readonly text: string;
  readonly action: GameAction;
  readonly viable: boolean;
  /** From EvaluatedAction -- why the action is not viable. */
  readonly reason?: string;
}

/** Send a pseudo-AI action pick via the AI's game WebSocket. */
export function sendPseudoAiPick(action: GameAction): void {
  if (!appState.pseudoAiWs || appState.pseudoAiWs.readyState !== WebSocket.OPEN) return;
  const msg: ClientMessage = { type: 'action', action };
  appState.pseudoAiWs.send(JSON.stringify(msg));
}

/** Clean action text for display: extract card names from markers, strip IDs and brackets. */
export function cleanActionText(text: string): string {
  // \x02id\x02name\x02 -> name
  // eslint-disable-next-line no-control-regex
  let s = text.replace(/\x02[^\x02]*\x02([^\x02]*)\x02/g, '$1');
  // Remove any remaining control chars, bracketed content, and bare IDs
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f]+/g, '');
  s = s.replace(/\{[^}]*\}/g, '');
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/\[[^\]]*\]/g, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Action types that represent "pass" or "do nothing". */
const PASS_ACTION_TYPES = new Set(['pass', 'draft-stop']);

/** Render the pseudo-AI action panel with pre-described actions. */
export function renderPseudoAiActions(actions: readonly DescribedAction[]): void {
  const panel = document.getElementById('pseudo-ai-panel')!;
  const container = document.getElementById('pseudo-ai-actions')!;
  const nonViableToggle = document.getElementById('pseudo-ai-nonviable-toggle')!;

  container.innerHTML = '';

  const viable = actions.filter(a => a.viable);
  const nonViable = actions.filter(a => !a.viable);

  // Sort: pass actions first
  viable.sort((a, b) => {
    const aPass = PASS_ACTION_TYPES.has(a.action.type) ? 0 : 1;
    const bPass = PASS_ACTION_TYPES.has(b.action.type) ? 0 : 1;
    return aPass - bPass;
  });

  // Show panel and pulsing border when there are actions to pick
  const instruction = document.getElementById('pseudo-ai-instruction')!;
  if (viable.length > 0) {
    panel.classList.remove('hidden');
    panel.classList.add('waiting');
    instruction.classList.remove('hidden');
  } else {
    panel.classList.remove('waiting');
    instruction.classList.add('hidden');
  }

  // Render viable actions as clickable buttons
  for (const da of viable) {
    const btn = document.createElement('button');
    btn.textContent = cleanActionText(da.text);
    if ('regress' in da.action && da.action.regress) {
      btn.classList.add('action-regress');
    }
    btn.addEventListener('click', () => {
      sendPseudoAiPick(da.action);
      container.innerHTML = '';
      nonViableToggle.classList.add('hidden');
      panel.classList.remove('waiting');
      panel.classList.add('hidden');
      instruction.classList.add('hidden');
    });
    container.appendChild(btn);
  }

  // Non-viable actions: hidden by default, toggleable
  if (nonViable.length > 0) {
    nonViableToggle.classList.remove('hidden');
    nonViableToggle.textContent = `+ Show non-viable (${nonViable.length})`;

    const nonViableContainer = document.createElement('div');
    nonViableContainer.classList.add('hidden');
    nonViableContainer.id = 'pseudo-ai-nonviable-list';

    for (const da of nonViable) {
      const btn = document.createElement('button');
      btn.disabled = true;
      btn.textContent = da.reason
        ? `${cleanActionText(da.text)} \u2014 ${da.reason}`
        : cleanActionText(da.text);
      if (da.reason) {
        btn.title = da.reason;
      }
      nonViableContainer.appendChild(btn);
    }
    container.appendChild(nonViableContainer);

    const newToggle = nonViableToggle.cloneNode(true) as HTMLButtonElement;
    nonViableToggle.replaceWith(newToggle);
    let showing = false;
    newToggle.addEventListener('click', () => {
      showing = !showing;
      nonViableContainer.classList.toggle('hidden', !showing);
      newToggle.textContent = showing
        ? `\u2212 Hide non-viable (${nonViable.length})`
        : `+ Show non-viable (${nonViable.length})`;
    });
  } else {
    nonViableToggle.classList.add('hidden');
  }
}

/** Connect a second WebSocket to the game server as the AI player (pseudo-AI mode). */
export function connectPseudoAi(aiName: string, aiDeck?: FullDeck | null): void {
  if (!appState.gamePort || !appState.pseudoAiToken) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.hostname}:${appState.gamePort}`;
  appState.pseudoAiWs = new WebSocket(url);

  appState.pseudoAiWs.onopen = () => {
    let joinMsg: JoinMessage;
    if (aiDeck) {
      joinMsg = buildJoinFromDeck(aiDeck, aiName);
    } else {
      // Rejoin -- server already has the deck from autosave
      joinMsg = { type: 'join', name: aiName, alignment: Alignment.Wizard, draftPool: [], playDeck: [], siteDeck: [], sideboard: [] };
    }
    const msg: ClientMessage = { ...joinMsg, token: appState.pseudoAiToken } as ClientMessage;
    appState.pseudoAiWs!.send(JSON.stringify(msg));
  };

  appState.pseudoAiWs.onmessage = (event) => {
    const msg = JSON.parse(event.data as string) as ServerMessage;
    if (msg.type === 'state') {
      const actions = msg.view.legalActions;
      if (actions && actions.length > 0) {
        const aiLookup = buildInstanceLookup(msg.view);
        const aiCompanyNames = {
          ...buildCompanyNames(msg.view.self.companies, msg.view.self.characters, cardPool),
          ...buildCompanyNames(msg.view.opponent.companies as never, msg.view.opponent.characters, cardPool),
        };
        const described: DescribedAction[] = actions.map(ea => ({
          text: describeAction(ea.action, cardPool, aiLookup, aiCompanyNames),
          action: ea.action,
          viable: ea.viable,
          reason: ea.reason,
        }));
        renderPseudoAiActions(described);
      }
    }
  };

  appState.pseudoAiWs.onclose = () => {
    appState.pseudoAiWs = null;
  };
}
