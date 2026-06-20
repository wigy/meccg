/**
 * @module engine/ally-stats
 *
 * Effective-stat helpers for allies. Most allies derive their mind, prowess,
 * and body from their card definition (an {@link AllyCard}). A few allies are
 * created by an effect rather than played as ally cards — most notably a hazard
 * creature converted into an ally by *Ready to His Will* (le-220) — and carry
 * their stats on the {@link AllyInPlay} instance via `statOverride` because the
 * underlying card definition (a creature) has no ally stats.
 *
 * Every place that reads an ally's mind/prowess/body should go through these
 * helpers so the override is honoured identically on the read (legal-action)
 * and write (reducer) paths.
 */

import type { GameState } from '../types/state.js';
import type { AllyInPlay } from '../types/state-cards.js';
import { defById } from './reducer-utils.js';
import { isAllyCard } from '../types/cards.js';

/**
 * Effective combat prowess of an ally: the instance `statOverride` if present,
 * otherwise the ally card definition's prowess (0 if the definition is not an
 * ally card).
 */
export function allyEffectiveProwess(state: GameState, ally: AllyInPlay): number {
  if (ally.statOverride) return ally.statOverride.prowess;
  const def = defById(state, ally.definitionId);
  return isAllyCard(def) ? def.prowess : 0;
}

/**
 * Effective body of an ally for body checks: the instance `statOverride` if
 * present, otherwise the ally card definition's body. Returns `undefined` when
 * neither supplies a body so callers can apply their own default.
 */
export function allyEffectiveBody(state: GameState, ally: AllyInPlay): number | undefined {
  if (ally.statOverride) return ally.statOverride.body;
  const def = defById(state, ally.definitionId);
  return isAllyCard(def) ? def.body : undefined;
}

/**
 * Effective mind of an ally (used for influence checks, Stay Her Appetite,
 * etc.): the instance `statOverride` if present, otherwise the ally card
 * definition's mind (0 if the definition is not an ally card).
 */
export function allyEffectiveMind(state: GameState, ally: AllyInPlay): number {
  if (ally.statOverride) return ally.statOverride.mind;
  const def = defById(state, ally.definitionId);
  return isAllyCard(def) ? def.mind : 0;
}
