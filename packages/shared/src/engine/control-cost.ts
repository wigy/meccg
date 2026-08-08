/**
 * @module engine/control-cost
 *
 * Single consumer path for the `control-restriction` effect (CoE "influence to
 * control"). A resource permanent-event played on one of your own characters
 * (Wizard's Myrmidon wh-84, The Forge-master wh-117) — or an item — may both
 *
 *  - override the influence-to-control *cost* (replacing the bearer's printed
 *    `mind`), and
 *  - restrict *which* control sources may hold the character under direct
 *    influence ("may only be controlled by general influence or a
 *    Fallen-wizard").
 *
 * Every control-cost read in the engine routes through {@link controlCostOf} so
 * the override is honored consistently across general-influence accounting,
 * direct-influence accounting, move-to-influence reassignment, and the
 * opponent/agent influence-away threshold. The bearer's `mind` is deliberately
 * left untouched for combat/setup purposes (defender-prowess-from-mind,
 * tap-low-mind, the Fallen-wizard mind≤5 setup gate).
 */

import type { GameState } from '../index.js';
import type { CharacterInPlay } from '../types/state-cards.js';
import type { CardEffect, ControlRestrictionEffect } from '../types/effects.js';
import { resolveDef } from './effects/resolver.js';
import { isAvatarCharacter } from '../types/cards.js';

/**
 * All control-restriction effects carried by a character, gathered from the
 * cards attached to it (its `items`, which is also where a resource
 * permanent-event played "on a character" is stored). Empty when the
 * character bears none. More than one may be attached at once — e.g. Wizard's
 * Myrmidon (wh-84) stacked with Squire of the Hunt (wh-95) or Gandalf's
 * Friend (wh-98) — per the CRF-22 ruling on Wizard's Myrmidon: "Can be played
 * with another card, like Squire of the Hunt, that reduces the influence
 * required to control the character. Use the lower number to control the
 * character." Callers must compare all of them, not just the first attached.
 */
function getControlRestrictions(
  state: GameState,
  char: CharacterInPlay,
): ControlRestrictionEffect[] {
  const restrictions: ControlRestrictionEffect[] = [];
  for (const item of char.items) {
    const def = resolveDef(state, item.instanceId);
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects;
    if (!effects) continue;
    for (const e of effects) {
      if (e.type === 'control-restriction') restrictions.push(e);
    }
  }
  return restrictions;
}

/**
 * The control-restriction with the lowest `cost` among those attached to
 * `char` — the one that governs both the control cost and (via its
 * `sources`) who may hold the character under direct influence, per the
 * CRF-22 "use the lower number" ruling. `undefined` when none are attached.
 */
function governingControlRestriction(
  state: GameState,
  char: CharacterInPlay,
): ControlRestrictionEffect | undefined {
  const restrictions = getControlRestrictions(state, char);
  if (restrictions.length === 0) return undefined;
  return restrictions.reduce((lowest, r) =>
    (r.cost ?? Infinity) < (lowest.cost ?? Infinity) ? r : lowest);
}

/**
 * Effective influence-to-control cost for a character. Returns the lowest
 * `control-restriction` `cost` among any attached (CRF-22: "use the lower
 * number to control the character" when several such cards are stacked);
 * otherwise `baseMind` (the caller's already-resolved value, normally
 * `effectiveStats.mind ?? charDef.mind`). Avatars have no control cost; pass
 * `null` as `baseMind` for them and `null` is returned.
 */
export function controlCostOf(
  state: GameState,
  char: CharacterInPlay,
  baseMind: number | null,
): number | null {
  if (baseMind === null) return null;
  const restriction = governingControlRestriction(state, char);
  return restriction?.cost ?? baseMind;
}

/**
 * Whether a prospective direct-influence controller may control `char` given
 * any attached `control-restriction`. `general` influence is always allowed and
 * is checked by the caller separately; this function answers the
 * direct-influence case. With a restriction listing `'fallen-wizard'`, only the
 * player's Fallen-wizard avatar (a mind-null wizard character of a Fallen-wizard
 * player) may control the character under direct influence. With no restriction,
 * any controller is allowed. When several restrictions are attached, the
 * lowest-cost one governs (see {@link governingControlRestriction}).
 */
export function directInfluenceControlAllowed(
  state: GameState,
  char: CharacterInPlay,
  controller: CharacterInPlay,
  controllerAlignment: string,
): boolean {
  const restriction = governingControlRestriction(state, char);
  if (!restriction?.sources) return true;
  if (restriction.sources.includes('fallen-wizard')) {
    const ctrlDef = resolveDef(state, controller.instanceId);
    return isAvatarCharacter(ctrlDef) && controllerAlignment === 'fallen-wizard';
  }
  return false;
}
