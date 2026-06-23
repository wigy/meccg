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
 * The control-restriction carried by a character, gathered from the cards
 * attached to it (its `items`, which is also where a resource permanent-event
 * played "on a character" is stored). Returns `undefined` when the character
 * bears no such effect. If several restrictions are attached the first found
 * wins — in practice these cards are unique-per-character and do not stack.
 */
export function getControlRestriction(
  state: GameState,
  char: CharacterInPlay,
): ControlRestrictionEffect | undefined {
  for (const item of char.items) {
    const def = resolveDef(state, item.instanceId);
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects;
    if (!effects) continue;
    for (const e of effects) {
      if (e.type === 'control-restriction') return e;
    }
  }
  return undefined;
}

/**
 * Effective influence-to-control cost for a character. Returns a
 * `control-restriction` `cost` override when one is attached; otherwise
 * `baseMind` (the caller's already-resolved value, normally
 * `effectiveStats.mind ?? charDef.mind`). Avatars have no control cost; pass
 * `null` as `baseMind` for them and `null` is returned.
 */
export function controlCostOf(
  state: GameState,
  char: CharacterInPlay,
  baseMind: number | null,
): number | null {
  if (baseMind === null) return null;
  const restriction = getControlRestriction(state, char);
  return restriction?.cost ?? baseMind;
}

/**
 * Whether a prospective direct-influence controller may control `char` given
 * any attached `control-restriction`. `general` influence is always allowed and
 * is checked by the caller separately; this function answers the
 * direct-influence case. With a restriction listing `'fallen-wizard'`, only the
 * player's Fallen-wizard avatar (a mind-null wizard character of a Fallen-wizard
 * player) may control the character under direct influence. With no restriction,
 * any controller is allowed.
 */
export function directInfluenceControlAllowed(
  state: GameState,
  char: CharacterInPlay,
  controller: CharacterInPlay,
  controllerAlignment: string,
): boolean {
  const restriction = getControlRestriction(state, char);
  if (!restriction?.sources) return true;
  if (restriction.sources.includes('fallen-wizard')) {
    const ctrlDef = resolveDef(state, controller.instanceId);
    return isAvatarCharacter(ctrlDef) && controllerAlignment === 'fallen-wizard';
  }
  return false;
}
