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
 * Modelled as a permanent event bound to the targeted site. The `play-target`
 * (target `site`) filter admits a Ruins & Lairs that is neither a Dragon's lair
 * (`lairOf`) nor an Under-deeps site (`adjacentSites`) AND sits in a Wilderness,
 * Border-land, or Shadow-land region (the site's own region type, resolved via
 * {@link siteRegionTypeOf} and injected into the filter context). On entering
 * play it adds five `until-cleared` constraints, all sourced from the card and
 * discarded by `discardOrphanedSiteAttachedEvents` once no company occupies the
 * bound site:
 *   - `site.type` override → haven (effective-type readers see a haven);
 *   - `wizardhaven-conversion` (player-scoped) → {@link isHavenForPlayer} treats
 *     the site as the converting Fallen-wizard's Wizardhaven even though its
 *     printed type is Ruins & Lairs and its alignment is not `fallen-wizard`;
 *   - `skip-automatic-attacks` → the site's automatic-attacks are removed;
 *   - `site-nothing-playable-as-written` → the site's printed playable resources
 *     and the factions/allies playable there as written are suppressed;
 *   - `cancel-attacks-at-site` → on-guard creature attacks and declared agent
 *     attacks against a company at the site are canceled.
 *
 * "Becomes a Wizardhaven" is modelled as the haven *benefits* (a safe site read
 * as a haven by the effective-type and `isHavenForPlayer` gates: healing,
 * bringing characters into play, race-mixing/size exemptions). It does not
 * synthesize haven-jump movement routes, which require a printed `havenPaths`
 * the card does not grant.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | playable on a non-lair, non-Under-deeps Ruins & Lairs         | OK     |
 * | 2 | "…in a Wilderness, Border-land, or Shadow-land"               | OK     |
 * | 3 | the site becomes one of your Wizardhavens                     | OK     |
 * | 4 | loses all automatic-attacks                                   | OK     |
 * | 5 | nothing is considered playable as written on the site card    | OK     |
 * | 6 | all attacks against a company at this site are canceled        | OK     |
 * | 7 | discarded when the site leaves play                            | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildFallenWizardSitePhaseState, playPermanentEventAndResolve,
  dispatch, phaseStateAs,
} from '../test-helpers.js';
import { computeLegalActions, SiteType, Alignment } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, SitePhaseState } from '../../index.js';
import { getEffectiveSiteType, siteAttacksCanceled } from '../../engine/effective.js';
import { isHavenForPlayer, isWizardhavenConversionFor, discardOrphanedSiteAttachedEvents, defById } from '../../engine/reducer-utils.js';

const HIDDEN_HAVEN = 'wh-75' as CardDefinitionId;

// A character a Fallen-wizard may field.
const ARAGORN = 'tw-120' as CardDefinitionId;

// Sites (alignment-appropriate Ruins & Lairs for a Fallen-wizard player).
const WORTHY_HILLS = 'as-142' as CardDefinitionId;   // Ruins & Lairs in Cardolan (wilderness), non-lair, non-Under-deeps
const BANDIT_LAIR = 'le-351' as CardDefinitionId;     // Ruins & Lairs in Brown Lands (shadow); 1 automatic-attack; plays minor items
const GOLD_HILL = 'td-176' as CardDefinitionId;       // Ruins & Lairs Dragon's lair (lairOf present)
const UNDER_VAULTS = 'dm-41' as CardDefinitionId;     // Under-deeps Ruins & Lairs (adjacentSites present)
const MORIA = 'tw-413' as CardDefinitionId;           // shadow-hold (not Ruins & Lairs)
const HIMRING = 'as-150' as CardDefinitionId;         // Ruins & Lairs in Elven Shores (coastal) — excluded region type

// A minor item playable at Bandit Lair (Ruins & Lairs, plays "minor") before
// conversion. Ringwraith-aligned so a Fallen-wizard may play it at the
// ringwraith-aligned site (no cross-alignment site-tap block), and with no
// play-site restriction of its own.
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;

// A hazard creature, used as a revealed on-guard attack for the cancellation test.
const STOUT_MEN = 'as-21' as CardDefinitionId;

function hiddenHavenInstanceId(state: GameState): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HIDDEN_HAVEN)!.instanceId;
}

function viablePlays(state: GameState, id: CardInstanceId) {
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-permanent-event'
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
  );
}

/** Play Hidden Haven on the company's current Ruins & Lairs and resolve it. */
function convert(state: GameState, site: CardDefinitionId): GameState {
  return playPermanentEventAndResolve(
    state, PLAYER_1, hiddenHavenInstanceId(state), undefined, { targetSiteDefinitionId: site },
  );
}

describe('Hidden Haven (wh-75)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 + 2: play-target gating, including region type ───────────────────

  test('playable on a non-lair, non-Under-deeps Ruins & Lairs in a Wilderness', () => {
    const state = buildFallenWizardSitePhaseState({ site: WORTHY_HILLS, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    const plays = viablePlays(state, hiddenHavenInstanceId(state));
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(WORTHY_HILLS);
  });

  test('playable on a Ruins & Lairs in a Shadow-land', () => {
    const state = buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    expect(viablePlays(state, hiddenHavenInstanceId(state))).toHaveLength(1);
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

  test('NOT playable on a Ruins & Lairs in a Coastal-sea region (wrong region type)', () => {
    const state = buildFallenWizardSitePhaseState({ site: HIMRING, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    expect(viablePlays(state, hiddenHavenInstanceId(state))).toHaveLength(0);
  });

  // ── Playing it binds to the site and installs the five constraints ──────────

  test('playing it binds the card to the site and installs all five constraints', () => {
    const before = buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    const after = convert(before, BANDIT_LAIR);

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === HIDDEN_HAVEN);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(BANDIT_LAIR);

    const sourced = after.activeConstraints.filter(c => c.source === inPlay!.instanceId);
    const kinds = sourced.map(c => c.kind.type);
    expect(kinds).toContain('attribute-modifier');            // site.type → haven
    expect(kinds).toContain('wizardhaven-conversion');
    expect(kinds).toContain('skip-automatic-attacks');
    expect(kinds).toContain('site-nothing-playable-as-written');
    expect(kinds).toContain('cancel-attacks-at-site');

    const siteTypeOverride = sourced.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    expect(siteTypeOverride?.kind.type === 'attribute-modifier' && siteTypeOverride.kind.value).toBe(SiteType.Haven);
  });

  // ── Rule 2: the site becomes one of your Wizardhavens ───────────────────────

  test('after conversion the effective site type is a haven', () => {
    const before = buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    expect(getEffectiveSiteType(before, BANDIT_LAIR, SiteType.RuinsAndLairs)).toBe(SiteType.RuinsAndLairs);

    const after = convert(before, BANDIT_LAIR);
    expect(getEffectiveSiteType(after, BANDIT_LAIR, SiteType.RuinsAndLairs)).toBe(SiteType.Haven);
  });

  test('the conversion is what makes the site a haven for the Fallen-wizard', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] }),
      BANDIT_LAIR,
    );
    const siteDef = defById(after, BANDIT_LAIR);

    // Without the conversion context, a Ruins & Lairs is not a haven for the FW.
    expect(isHavenForPlayer(siteDef, Alignment.FallenWizard)).toBe(false);
    // With it, the bound site is a Wizardhaven for the converting player only.
    expect(isWizardhavenConversionFor(after, BANDIT_LAIR, PLAYER_1)).toBe(true);
    expect(isHavenForPlayer(siteDef, Alignment.FallenWizard, {
      state: after, siteDefinitionId: BANDIT_LAIR, playerId: PLAYER_1,
    })).toBe(true);
    // …and not for the opponent (the card grants "one of *your* Wizardhavens").
    expect(isWizardhavenConversionFor(after, BANDIT_LAIR, after.players[HAZARD_PLAYER].id)).toBe(false);
  });

  // ── Rule 3: loses all automatic-attacks ─────────────────────────────────────

  function atEnterOrSkip(state: GameState): GameState {
    const base = state.phaseState as SitePhaseState;
    return { ...state, phaseState: { ...base, step: 'enter-or-skip', siteEntered: false } };
  }

  test('without conversion, entering the Ruins & Lairs faces its automatic-attacks', () => {
    const state = atEnterOrSkip(
      buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN] }),
    );
    const cid = state.players[RESOURCE_PLAYER].companies[0].id;
    const entered = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect(phaseStateAs<SitePhaseState>(entered).step).toBe('reveal-on-guard-attacks');
  });

  test('after conversion, entering the site skips all automatic-attacks', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] }),
      BANDIT_LAIR,
    );
    const cid = after.players[RESOURCE_PLAYER].companies[0].id;
    const entered = dispatch(atEnterOrSkip(after), { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect(phaseStateAs<SitePhaseState>(entered).step).toBe('declare-agent-attack');
  });

  // ── Rule 4: nothing playable as written on the site card ────────────────────

  test('a minor item playable at the printed Ruins & Lairs is no longer playable after conversion', () => {
    const before = buildFallenWizardSitePhaseState({
      site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN, SAW_TOOTHED_BLADE],
    });
    const oldTreasureId = before.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SAW_TOOTHED_BLADE)!.instanceId;

    const playableBefore = (s: GameState) => computeLegalActions(s, PLAYER_1).some(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === oldTreasureId,
    );

    expect(playableBefore(before)).toBe(true);
    const after = convert(before, BANDIT_LAIR);
    expect(playableBefore(after)).toBe(false);
  });

  // ── Rule 5: all attacks against a company at this site are canceled ──────────

  test('a revealed on-guard creature attack is canceled (discarded, no combat)', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] }),
      BANDIT_LAIR,
    );
    expect(siteAttacksCanceled(after, BANDIT_LAIR)).toBe(true);

    // Place a revealed on-guard hazard creature on the company and move to the
    // resolve-attacks step.
    const ogId = 'wh75-og-creature-1' as CardInstanceId;
    const player = after.players[RESOURCE_PLAYER];
    const company = player.companies[0];
    const withOnGuard: GameState = {
      ...after,
      players: [
        {
          ...player,
          companies: [{ ...company, onGuardCards: [{ instanceId: ogId, definitionId: STOUT_MEN, revealed: true }] }],
        },
        after.players[HAZARD_PLAYER],
      ] as GameState['players'],
      phaseState: { ...(after.phaseState as SitePhaseState), step: 'resolve-attacks' },
    };

    const resolved = dispatch(withOnGuard, { type: 'pass', player: PLAYER_1 });
    // No combat was initiated…
    expect(resolved.combat).toBeNull();
    // …the creature was discarded to its owner (the hazard player)…
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === STOUT_MEN)).toBe(true);
    // …and the step advanced to play-resources.
    expect(phaseStateAs<SitePhaseState>(resolved).step).toBe('play-resources');
  });

  // ── Rule 7: discarded when the site leaves play ─────────────────────────────

  test('the card and all its constraints are discarded once the site leaves play', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] }),
      BANDIT_LAIR,
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === HIDDEN_HAVEN)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(5);

    // The company moves on — its current site is no longer Bandit Lair.
    const movedCompany = {
      ...after.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...after.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: MORIA },
    };
    const moved: GameState = {
      ...after,
      players: [
        { ...after.players[RESOURCE_PLAYER], companies: [movedCompany] },
        after.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HIDDEN_HAVEN)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HIDDEN_HAVEN)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});
