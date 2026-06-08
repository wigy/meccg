/**
 * @module wh-54.test
 *
 * Card test: Vile Fumes (wh-54)
 * Type: minion-resource-item (subtype: Special Item; keyword: Technology)
 * Effects: 0 (no DSL effects array)
 *
 * Card text:
 *   "Technology. Playable at a tapped or untapped Shadow-hold [{S}],
 *    Dark-hold [{D}], or a site with a Dwarf automatic-attack. Discard
 *    during the site phase at a Border-hold [{B}] or Shadow-hold [{S}]
 *    to make all versions of the site Ruins & Lairs [{R}]. Its normal
 *    automatic-attacks are replaced with: Gas — each character faces 1
 *    strike with 7 prowess (cannot be canceled). Keep Vile Fumes with
 *    the site until the site is discarded or returned to its location
 *    deck."
 *
 * NOT CERTIFIED. Vile Fumes is an item that, when discarded during the
 * site phase, permanently transforms a *site instance*: it changes the
 * site type to Ruins & Lairs and replaces the site's printed
 * automatic-attacks with a single uncancelable "Gas" attack. None of
 * the required engine mechanics exist today:
 *
 *   1. Special-item playability override gated on site-type
 *      (Shadow-hold / Dark-hold), a Dwarf automatic-attack at the site,
 *      and a *tapped-or-untapped* allowance. `item-play-site` filters by
 *      site name/definition only and cannot override the untapped-site
 *      requirement, nor inspect a site's auto-attack race.
 *   2. An item-driven "discard during the site phase to transform this
 *      site" grant-action. No grant-action transforms a site.
 *   3. A site-type override that persists for the *life of the site
 *      instance* ("until the site is discarded or returned to its
 *      location deck"). Existing `site-type-override` constraints are
 *      turn/phase-scoped only.
 *   4. Replacing a site's automatic-attacks with a custom attack. The
 *      engine can augment (`permanent-event-auto-attack`), skip
 *      (`skip-automatic-attacks`), or cancel-first
 *      (`cancel-first-attack-if-in-play`) attacks, but cannot replace
 *      them with a bespoke attack — and the `uncancelable` flag is wired
 *      only to Forewarned Is Forearmed, not to a site auto-attack.
 *
 * Implementing these is multi-system engine work spanning playability,
 * site-phase actions, persistent site-instance constraints, auto-attack
 * derivation, and combat cancellation — out of scope for a single-card
 * certification. The rules below are recorded as a living spec until that
 * support lands.
 */

import { describe, test } from 'vitest';

describe('Vile Fumes (wh-54)', () => {
  test.todo(
    'playable at a tapped or untapped Shadow-hold, Dark-hold, or a site with a Dwarf automatic-attack',
  );
  test.todo(
    'discard during the site phase at a Border-hold or Shadow-hold to make all versions of the site Ruins & Lairs',
  );
  test.todo(
    'transformed site’s automatic-attacks are replaced with Gas: each character faces 1 strike, 7 prowess (cannot be canceled)',
  );
  test.todo(
    'Vile Fumes stays with the site until the site is discarded or returned to its location deck',
  );
});
