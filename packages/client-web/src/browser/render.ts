/**
 * @module render
 *
 * DOM rendering functions for the web client. Renders game state,
 * action buttons, draft info, and a message log.
 */

import type { PlayerView, GameAction, CardDefinition, CardDefinitionId } from '@meccg/shared';
import { describeAction, formatPlayerView, formatCardList } from '@meccg/shared';

/** Get an element by ID, throwing if not found. */
function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

/**
 * Maps ANSI SGR color codes to CSS color values.
 * Supports the codes used in format.ts: bold, dim, and 8 standard colors.
 */
const ANSI_TO_CSS: Record<string, string> = {
  '1': 'font-weight:bold',      // bold
  '2': 'opacity:0.6',           // dim
  '31': 'color:#e06060',        // red (hazard-creature)
  '32': 'color:#60c060',        // green (ally, resource-event)
  '33': 'color:#d0a040',        // yellow (item)
  '34': 'color:#6090e0',        // blue (character)
  '35': 'color:#c070c0',        // magenta (hazard-event, corruption)
  '36': 'color:#50b0b0',        // cyan (faction)
  '37': 'color:#d0d0d0',        // white (site)
  '90': 'color:#666',           // bright black / grey (unknown, debug)
};

/** Convert a string containing ANSI escape codes to HTML with colored spans. */
function ansiToHtml(text: string): string {
  // Escape HTML entities first
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let result = '';
  let openSpans = 0;

  // Match ANSI escape sequences: ESC[ followed by semicolon-separated numbers, ending with 'm'
  const parts = escaped.split(/\x1b\[([0-9;]*)m/);

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Text content
      result += parts[i];
    } else {
      // ANSI code(s)
      const codes = parts[i].split(';').filter(c => c !== '');
      for (const code of codes) {
        if (code === '0') {
          // Reset: close all open spans
          while (openSpans > 0) {
            result += '</span>';
            openSpans--;
          }
        } else {
          const css = ANSI_TO_CSS[code];
          if (css) {
            result += `<span style="${css}">`;
            openSpans++;
          }
        }
      }
    }
  }

  // Close any remaining open spans
  while (openSpans > 0) {
    result += '</span>';
    openSpans--;
  }

  return result;
}

/** Render the game state using the shared ANSI formatter, converted to HTML. */
export function renderState(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const el = $('state');
  el.innerHTML = ansiToHtml(formatPlayerView(view, cardPool));
}

/** Render draft-specific information with colored card names. */
export function renderDraft(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const el = $('draft');

  if (view.phaseState.phase !== 'character-draft') {
    el.innerHTML = '';
    return;
  }

  const draft = view.phaseState;
  const list = (ids: readonly CardDefinitionId[]) => formatCardList(ids, cardPool);

  const lines: string[] = [];
  lines.push(`Draft round: ${draft.round}`);
  lines.push(`Pool [0]: ${list(draft.draftState[0].pool)}`);
  lines.push(`Drafted [0]: ${list(draft.draftState[0].drafted)}`);
  lines.push(`Pool [1]: ${list(draft.draftState[1].pool)}`);
  lines.push(`Drafted [1]: ${list(draft.draftState[1].drafted)}`);
  if (draft.setAside.length > 0) {
    lines.push(`Set aside: ${list(draft.setAside)}`);
  }

  el.innerHTML = ansiToHtml(lines.join('\n'));
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
    btn.innerHTML = ansiToHtml(describeAction(action, cardPool));
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
