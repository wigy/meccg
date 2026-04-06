/**
 * @module render-actions
 *
 * Renders the action button panel in the debug view.
 * Viable actions appear as clickable buttons; non-viable actions are
 * shown disabled with their rejection reason.
 */

import type { EvaluatedAction, CardDefinition, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { describeAction } from '@meccg/shared';
import { $ } from './render-utils.js';
import { textToHtml, tagCardImages } from './render-text-format.js';

/** Render action buttons (viable actions clickable, non-viable shown disabled with reason). */
export function renderActions(
  evaluated: readonly EvaluatedAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onClick: (action: GameAction) => void,
  instanceLookup?: (id: CardInstanceId) => CardDefinitionId | undefined,
  companyNames?: Readonly<Record<string, string>>,
): void {
  const el = $('actions');
  el.innerHTML = '';

  /** Create a "+" toggle that reveals the raw JSON of an action. */
  function addJsonToggle(container: HTMLElement, action: GameAction): void {
    const toggle = document.createElement('span');
    toggle.className = 'action-json-toggle';
    toggle.textContent = '+';
    toggle.title = 'Show JSON';
    const pre = document.createElement('pre');
    pre.className = 'action-json hidden';
    pre.textContent = JSON.stringify(action, null, 2);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      pre.classList.toggle('hidden');
      const nowVisible = !pre.classList.contains('hidden');
      toggle.textContent = nowVisible ? '−' : '+';
      toggle.title = nowVisible ? 'Hide JSON' : 'Show JSON';
    });
    container.appendChild(toggle);
    container.appendChild(pre);
  }

  // Viable actions first — clickable (pass first, regressive actions shown lighter)
  const viable = evaluated.filter(e => e.viable);
  viable.sort((a, b) => {
    const aPass = a.action.type === 'pass' || a.action.type === 'draft-stop' ? 0 : 1;
    const bPass = b.action.type === 'pass' || b.action.type === 'draft-stop' ? 0 : 1;
    return aPass - bPass;
  });
  for (const ea of viable) {
    const btn = document.createElement('button');
    const isRegress = 'regress' in ea.action && ea.action.regress;
    if (isRegress) btn.classList.add('action-regress');
    btn.innerHTML = textToHtml(describeAction(ea.action, cardPool, instanceLookup, companyNames));
    tagCardImages(btn, cardPool);
    addJsonToggle(btn, ea.action);
    btn.addEventListener('click', () => onClick(ea.action));
    el.appendChild(btn);
  }

  // Non-viable actions — disabled with reason
  const nonViable = evaluated.filter(e => !e.viable);
  if (nonViable.length > 0) {
    for (const ea of nonViable) {
      const btn = document.createElement('button');
      btn.disabled = true;
      btn.title = ea.reason ?? '';
      btn.innerHTML = textToHtml(describeAction(ea.action, cardPool, instanceLookup, companyNames))
        + (ea.reason ? ` <span class="action-reason">— ${ea.reason}</span>` : '');
      tagCardImages(btn, cardPool);
      addJsonToggle(btn, ea.action);
      el.appendChild(btn);
    }
  }
}
