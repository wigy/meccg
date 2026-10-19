/**
 * @module combat-discard-item-panel
 *
 * Combat-arena panel for the `discard-item-from-company` combat sub-phase.
 *
 * After a successful strike from a creature with a `discard-item` strike
 * effect (Thief tw-102, An Article Missing dm-43, Pick-pocket tw-79), the
 * engine pauses combat in `discard-item-from-company` and offers the defender
 * one `discard-item-from-company` action per item in `combat.discardItemOptions`.
 * The company view is hidden behind the combat arena during combat, so the
 * choice must be clickable from inside the arena itself.
 */

import type { CardDefinition, CombatState, DiscardItemFromCompanyAction, GameAction } from '@meccg/shared';
import { createCardImageFromDefId } from './render-utils.js';

/**
 * Render the forced-discard panel: one clickable card per item the defender
 * may discard. Clicking an item dispatches its `discard-item-from-company`
 * action. Items without a matching viable action are not rendered.
 */
export function renderDiscardItemPanel(
  combat: CombatState,
  cardPool: Readonly<Record<string, CardDefinition>>,
  discardActions: readonly DiscardItemFromCompanyAction[],
  onAction: (action: GameAction) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'combat-salvage-panel';

  const label = document.createElement('div');
  label.className = 'combat-salvage-label';
  label.textContent = 'Strike succeeded — click an item to discard:';
  panel.appendChild(label);

  const itemsRow = document.createElement('div');
  itemsRow.className = 'combat-salvage-items';

  for (const item of combat.discardItemOptions ?? []) {
    const action = discardActions.find(a => a.itemInstanceId === item.instanceId);
    if (!action) continue;
    const itemEl = createCardImageFromDefId(
      item.definitionId,
      cardPool,
      'company-card company-card--item combat-card--assignable',
      item.instanceId as string,
    );
    if (!itemEl) continue;
    itemEl.style.cursor = 'pointer';
    itemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      onAction(action);
    });
    itemsRow.appendChild(itemEl);
  }

  panel.appendChild(itemsRow);
  return panel;
}
