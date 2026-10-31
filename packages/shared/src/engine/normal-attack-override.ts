/**
 * @module normal-attack-override
 *
 * Collects the card effects that turn a detainment attack into a normal one
 * (CoE §3.II — detainment taps rather than wounds and awards no kill MP) and
 * shapes them for spreading into an `isDetainmentAttack` context:
 *
 * - `detainment-attacks-normal` on one of the defender's characters (Alatar
 *   wh-1), gated by an optional `when` condition evaluated against the
 *   player-state context ({@link buildPlayerStateContext});
 * - `auto-attacks-normal` on an in-play long-event (Awaken Defenders le-103),
 *   scoped to automatic-attacks at matching site types;
 * - turn-scoped `keyed-attacks-normal` constraints on the company (World
 *   Gnawed by the Nameless as-110).
 *
 * Lives outside `reducer-utils.ts` so it can evaluate the player-state context
 * from `legal-actions/organization.ts` without an import cycle.
 */

import type { GameState, PlayerState } from '../index.js';
import type { CompanyId, SiteType } from '../types/common.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { resolveDef } from './effects/index.js';
import { logDetail } from './legal-actions/log.js';
import { buildPlayerStateContext } from './legal-actions/organization.js';
import { getCardEffects } from './reducer-utils.js';

/**
 * True when `player` has an in-play character carrying a
 * `detainment-attacks-normal` effect whose `when` condition (if any) holds
 * against the player-state context — Alatar wh-1:
 * `{ "player.stagePoints": { "$gt": 7 } }`. While true, every attack the
 * engine would treat as detainment against the player's companies is
 * resolved as a normal attack instead.
 */
function playerConvertsDetainmentToNormal(state: GameState, player: PlayerState): boolean {
  let ctx: Record<string, unknown> | undefined;
  for (const char of Object.values(player.characters)) {
    const def = resolveDef(state, char.instanceId);
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'detainment-attacks-normal') continue;
      if (effect.when) {
        ctx ??= buildPlayerStateContext(state, player, player.id);
        if (!matchesCondition(effect.when, ctx)) continue;
      }
      logDetail(`detainment-attacks-normal: ${def?.name ?? '?'} — detainment attacks against ${player.name}'s companies attack normally`);
      return true;
    }
  }
  return false;
}

/**
 * Site types for which the given company currently converts keyed hazard
 * attacks into normal (non-detainment) attacks — the union of the `siteTypes`
 * of every active `keyed-attacks-normal` constraint targeting the company
 * (World Gnawed by the Nameless as-110, turn-scoped). Threaded into
 * `isDetainmentAttack` as `normalIfKeyedToSiteTypes` at hazard-creature
 * combat initiation. Empty array when no such constraint is active.
 */
function companyKeyedAttacksNormalSiteTypes(
  state: GameState,
  companyId: CompanyId,
): readonly SiteType[] {
  const types: SiteType[] = [];
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'keyed-attacks-normal') continue;
    if (c.target.kind !== 'company' || c.target.companyId !== companyId) continue;
    for (const s of c.kind.siteTypes) {
      if (!types.includes(s)) types.push(s);
    }
  }
  if (types.length > 0) {
    logDetail(`keyed-attacks-normal: company ${companyId as string} converts attacks keyed to [${types.join(', ')}] to normal`);
  }
  return types;
}

/**
 * True when some in-play long hazard-event (either player's `cardsInPlay`)
 * carries an `auto-attacks-normal` effect whose `siteTypes` include
 * `effectiveSiteType` — Awaken Defenders (le-103): "each detainment
 * automatic-attack at a Free-hold or Border-hold becomes a normal
 * automatic-attack." When true, the site's automatic-attacks are resolved as
 * normal attacks (threaded into `isDetainmentAttack` via
 * `defenderForcesNormalAttacks`, mirroring
 * {@link playerConvertsDetainmentToNormal}). Site-type-scoped and global, so it
 * applies to any company entering a matching site regardless of alignment.
 */
function siteTypeForcesAutoAttacksNormal(
  state: GameState,
  effectiveSiteType: SiteType,
): boolean {
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = resolveDef(state, card.instanceId);
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'auto-attacks-normal') continue;
        if (effect.siteTypes.includes(effectiveSiteType)) return true;
      }
    }
  }
  return false;
}

/**
 * The detainment-to-normal overrides in force for an attack against
 * `player`'s company — shaped to spread straight into an
 * `isDetainmentAttack` context.
 */
export interface NormalAttackOverride {
  /**
   * Every detainment attack resolves normally: the defender converts all
   * detainment attacks (Alatar wh-1), or — when `autoAttackSiteType` was
   * given — a global effect makes automatic-attacks at that site type normal
   * (Awaken Defenders le-103).
   */
  readonly defenderForcesNormalAttacks: boolean;
  /**
   * Site types whose keyed attacks against the company resolve normally
   * (World Gnawed by the Nameless as-110). Empty when no `companyId` was given.
   */
  readonly normalIfKeyedToSiteTypes: readonly SiteType[];
}

/**
 * Collects every source that turns a detainment attack against `player`'s
 * company into a normal attack, in one place:
 *
 * - `detainment-attacks-normal` on one of the player's characters (Alatar
 *   wh-1, `when`-gated) — always consulted;
 * - `auto-attacks-normal` on an in-play long-event (Awaken Defenders le-103)
 *   — only when `opts.autoAttackSiteType` is given, i.e. the attack is an
 *   automatic-attack at a site of that effective type;
 * - turn-scoped `keyed-attacks-normal` constraints on the company (World
 *   Gnawed by the Nameless as-110) — only when `opts.companyId` is given.
 */
export function normalAttackOverride(
  state: GameState,
  player: PlayerState,
  opts: { readonly companyId?: CompanyId; readonly autoAttackSiteType?: SiteType } = {},
): NormalAttackOverride {
  return {
    defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(state, player)
      || (opts.autoAttackSiteType !== undefined && siteTypeForcesAutoAttacksNormal(state, opts.autoAttackSiteType)),
    normalIfKeyedToSiteTypes: opts.companyId !== undefined
      ? companyKeyedAttacksNormalSiteTypes(state, opts.companyId)
      : [],
  };
}
