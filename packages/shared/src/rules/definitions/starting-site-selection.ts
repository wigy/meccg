/**
 * @module rules/definitions/starting-site-selection
 *
 * Declarative rules for starting site selection. Each player selects one or
 * two sites from their site deck to form initial companies, limited to the
 * alignment's allowed starting sites.
 *
 * The context builder (server-side) must provide:
 * - `card.name` — site name for messages
 * - `ctx.isAllowedSite` — whether this site is in the alignment's allowed starting sites
 * - `ctx.alreadySelected` — whether this site instance was already selected
 */

import type { RuleSet } from '../types.js';

/** Rules governing which sites can be selected as starting locations. */
export const SITE_SELECTION_RULES: RuleSet = {
  name: 'Starting Site Selection Eligibility',
  rules: [
    {
      id: 'is-allowed-site',
      condition: { 'ctx.isAllowedSite': true },
      failMessage: '{{card.name}} is not an allowed starting site for this alignment',
    },
    {
      id: 'not-already-selected',
      condition: { 'ctx.alreadySelected': false },
      failMessage: '{{card.name}} is already selected',
    },
  ],
};
