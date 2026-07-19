/**
 * @module wh-65.test — Delver's Harvest (Fallen-wizard Stage resource)
 *
 * Delver's Harvest is a Stage-alignment permanent-event worth 1 miscellaneous
 * marshalling point (authoritative DB `data/cards.json`, WH-65).
 *
 * Card text:
 *   "Playable during the site phase if one of your companies enters the Deep
 *    Mines site."
 *
 * Modeling (see `packages/shared/docs/card-effects-dsl.md`):
 *   - The card declares its own site-phase timing, an exception to rule 5.F1
 *     (Stage resource permanent-events are otherwise organization-phase only).
 *     This is expressed with a `play-condition` `requires: 'active-company'`
 *     whose condition gates on the active company's current site name being
 *     "Deep Mines". A Stage permanent-event carrying an `active-company`
 *     play-condition is offered ONLY by the site-phase play path
 *     (`legal-actions/site.ts`) and never during the organization phase.
 *   - It has no target; on resolution it enters the controller's `cardsInPlay`
 *     and scores its 1 misc MP through the normal in-play scoring pass. As a
 *     Stage resource it is exempt from the MEWH §4 flat-1 clamp (it already
 *     scores exactly 1 here, but the exemption keeps the value stable).
 *
 * | # | Rule                                                         | Status |
 * |---|--------------------------------------------------------------|--------|
 * | 1 | playable in the site phase when the company is at Deep Mines | OK     |
 * | 2 | not playable in the site phase at any other site            | OK     |
 * | 3 | not playable during the organization phase (5.F1 timing)    | OK     |
 * | 4 | on play it enters play and scores 1 miscellaneous MP         | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  resetMint,
  viableActions,
  findHandCardId,
  buildFallenWizardSitePhaseState,
  buildFallenWizardOrgPhaseState,
  playPermanentEventAndResolve,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──
const DELVERS_HARVEST = 'wh-65' as CardDefinitionId;
const DEEP_MINES = 'wh-55' as CardDefinitionId;        // Fallen-wizard R&L site
const ISENGARD = 'wh-56' as CardDefinitionId;          // Fallen-wizard Wizardhaven
const SARUMAN_FW = 'wh-9' as CardDefinitionId;         // Fallen-wizard avatar

describe('Delver\'s Harvest (wh-65)', () => {
  beforeEach(() => resetMint());

  // --- Rule 1: playable in the site phase at Deep Mines ---------------------

  test('offered during the site phase when the active company is at Deep Mines', () => {
    const s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [DELVERS_HARVEST],
    });
    const actions = viableActions(s, PLAYER_1, 'play-permanent-event');
    const harvestId = findHandCardId(s, RESOURCE_PLAYER, DELVERS_HARVEST);
    const offeredIds = actions.map(ea => (ea.action as { cardInstanceId?: unknown }).cardInstanceId);
    expect(offeredIds).toContain(harvestId);
  });

  // --- Rule 2: not playable at any other site -------------------------------

  test('not offered during the site phase at a site other than Deep Mines', () => {
    const s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: ISENGARD,
      hand: [DELVERS_HARVEST],
    });
    expect(viableActions(s, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // --- Rule 3: site-phase timing — never offered in the organization phase --

  test('not offered during the organization phase (site-phase timing, 5.F1)', () => {
    const s = buildFallenWizardOrgPhaseState({
      characters: [SARUMAN_FW],
      site: ISENGARD,
      hand: [DELVERS_HARVEST],
    });
    expect(viableActions(s, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // --- Rule 4: on play it enters play and scores 1 miscellaneous MP ---------

  test('playing it at Deep Mines puts it in play and scores 1 miscellaneous MP', () => {
    const s = buildFallenWizardSitePhaseState({
      characters: [SARUMAN_FW],
      site: DEEP_MINES,
      hand: [DELVERS_HARVEST],
    });
    expect(s.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);

    const harvestId = findHandCardId(s, RESOURCE_PLAYER, DELVERS_HARVEST);
    const after = playPermanentEventAndResolve(s, PLAYER_1, harvestId);

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === DELVERS_HARVEST,
    );
    expect(inPlay).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === DELVERS_HARVEST)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });
});
