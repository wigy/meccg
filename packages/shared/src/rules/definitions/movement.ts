/**
 * @module rules/definitions/movement
 *
 * Declarative rules for region movement eligibility during the declare-path
 * step (CoE step 2) of the Movement/Hazard phase. These rules constrain
 * which region paths a company may legally declare.
 *
 * The context builder must provide:
 * - `movement.regionDistance` — number of consecutive regions in the path
 *   (rules-style: origin and destination both count, so adjacent = 2)
 * - `ctx.maxRegions` — the effective max (for fail-message rendering only;
 *   the actual constraint is baked into the returned rule set)
 */

import type { RuleSet } from '../types.js';

/**
 * Base maximum region distance for region movement.
 * The rules say "four consecutive regions" counting both origin and
 * destination regions. Card effects may increase or decrease this.
 */
export const BASE_MAX_REGION_DISTANCE = 4;

/**
 * Creates a region-movement rule set parameterised by the effective maximum
 * region distance. The base value is {@link BASE_MAX_REGION_DISTANCE} (4);
 * callers should add/subtract any modifiers from card effects before calling.
 *
 * @param maxRegions - Maximum allowed region distance (inclusive).
 * @returns A rule set that rejects paths exceeding the limit.
 */
export function createMovementRules(maxRegions: number): RuleSet {
  return {
    name: 'Region Movement Eligibility',
    rules: [
      {
        id: 'max-region-distance',
        condition: {
          'movement.regionDistance': { $lte: maxRegions },
        },
        failMessage: 'Path crosses {{movement.regionDistance}} regions (max {{ctx.maxRegions}})',
      },
    ],
  };
}
