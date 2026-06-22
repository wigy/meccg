/**
 * @module wh-75.test
 *
 * Card test: Hidden Haven (wh-75)
 * Type: hero-resource-event (permanent) · alignment: fallen-wizard · Stage resource
 *
 * Card text:
 *   "Playable on a non-Dragon's lair Ruins & Lairs in a Wilderness, Border-land,
 *    or Shadow-land. This site becomes one of your Wizardhavens and loses all
 *    automatic-attacks. Nothing is considered playable as written on the site
 *    card. If one of your companies is at this site, all attacks against it are
 *    canceled."
 *
 * ⚠️ NOT CERTIFIED — this card requires several engine mechanics that are not
 * yet implemented. Only the play-target gating below is exercised here; the
 * full transformation is intentionally left for a follow-up.
 *
 * | # | Rule                                                          | Status          |
 * |---|---------------------------------------------------------------|-----------------|
 * | 1 | playable on a non-lair, non-Under-deeps Ruins & Lairs         | PARTIAL (no region gate) |
 * | 2 | "…in a Wilderness, Border-land, or Shadow-land" ({w}/{b}/{s}) | NOT IMPLEMENTED — site filter cannot read a site's own region type |
 * | 3 | the site becomes one of your Wizardhavens                     | NOT IMPLEMENTED — `isHavenForPlayer` + the ~15 `siteType==='haven'` consumers read the *static* site definition (healing, haven-jump movement, draws, mind-limit, …) and would not honor a dynamic override |
 * | 4 | loses all automatic-attacks                                   | NOT IMPLEMENTED — no constraint kind removes a site's auto-attacks (as-88 only converts them to detainment) |
 * | 5 | nothing is considered playable as written on the site card   | NOT IMPLEMENTED — no playability-as-written override constraint |
 * | 6 | all attacks against a company at this site are canceled       | NOT IMPLEMENTED — the Wizardhaven "all attacks canceled" mechanic does not exist anywhere in the engine (the printed Isengard, wh-56, is itself uncertified and has no effects) |
 *
 * What IS modelled and tested here: the `play-target` site filter (target
 * `site`, filtered to a Ruins & Lairs that is neither a Dragon's lair —
 * `lairOf` present — nor an Under-deeps site — `adjacentSites` present), which
 * gates where the permanent event may be played. This mirrors the certified
 * Hold Rebuilt and Repaired (as-88) gating. The region-type tightening
 * ({w}/{b}/{s}) is a known over-permission gap noted above.
 *
 * Playable: PARTIALLY — see the table. Do NOT certify until rules 2–6 are
 * implemented and exercised.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, buildFallenWizardSitePhaseState,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const HIDDEN_HAVEN = 'wh-75' as CardDefinitionId;

// A character a Fallen-wizard may field.
const ARAGORN = 'tw-120' as CardDefinitionId;

// Sites (hero versions, alignment-appropriate for a Fallen-wizard player).
const WORTHY_HILLS = 'as-142' as CardDefinitionId;   // Ruins & Lairs, non-lair, non-Under-deeps
const GOLD_HILL = 'td-176' as CardDefinitionId;       // Ruins & Lairs Dragon's lair (lairOf present)
const UNDER_VAULTS = 'dm-41' as CardDefinitionId;     // Under-deeps Ruins & Lairs (adjacentSites present)
const MORIA = 'tw-413' as CardDefinitionId;           // shadow-hold (not Ruins & Lairs)

function hiddenHavenInstanceId(state: GameState): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HIDDEN_HAVEN)!.instanceId;
}

function viablePlays(state: GameState, id: CardInstanceId) {
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-permanent-event'
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
  );
}

describe('Hidden Haven (wh-75) — play-target gating (NOT CERTIFIED)', () => {
  beforeEach(() => resetMint());

  test('playable on a non-lair, non-Under-deeps Ruins & Lairs during the site phase', () => {
    const state = buildFallenWizardSitePhaseState({ site: WORTHY_HILLS, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    const id = hiddenHavenInstanceId(state);
    const plays = viablePlays(state, id);
    expect(plays).toHaveLength(1);
    // The play binds the card to the site it transforms.
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(WORTHY_HILLS);
  });

  test("NOT playable on a Dragon's lair Ruins & Lairs", () => {
    const state = buildFallenWizardSitePhaseState({ site: GOLD_HILL, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    expect(viablePlays(state, hiddenHavenInstanceId(state))).toHaveLength(0);
  });

  test('NOT playable on an Under-deeps Ruins & Lairs', () => {
    const state = buildFallenWizardSitePhaseState({ site: UNDER_VAULTS, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    expect(viablePlays(state, hiddenHavenInstanceId(state))).toHaveLength(0);
  });

  test('NOT playable on a site that is not Ruins & Lairs', () => {
    const state = buildFallenWizardSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    expect(viablePlays(state, hiddenHavenInstanceId(state))).toHaveLength(0);
  });
});
