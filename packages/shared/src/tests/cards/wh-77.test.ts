/**
 * @module wh-77.test
 *
 * Card test: Mischief in a Mean Way (wh-77)
 * Type: minion-resource-event (permanent) · alignment: stage · Fallen-wizard Stage resource
 *
 * Card text:
 *   "Playable during the site phase on a Border-hold [{B}] site if you have 10
 *    or more stage points. This site becomes one of your Wizardhavens [{H}] and
 *    loses all automatic-attacks. Nothing is considered playable as written on
 *    the site. If one of your companies is at this site, all attacks against it
 *    are canceled. Other Fallen-wizards may not use this site as a Wizardhaven
 *    [{H}]. Discard this card when the site is discarded or returned to its
 *    location deck. It cannot be discarded otherwise."
 *
 * This is a site-phase Fallen-wizard Wizardhaven-conversion, reusing the Hidden
 * Haven (wh-75) / Chambers in the Royal Court (wh-97) machinery on a **Border-hold**:
 *   - `play-condition` `active-company` (`{ site.type: "border-hold" }`) — the
 *     Stage-resource exception to rule 5.F1 that admits this card into the SITE
 *     phase (like Delver's Harvest wh-65) instead of only the organization
 *     phase, and confirms the active company is at a Border-hold;
 *   - `play-condition` `player-state` (`{ player.stagePoints: { $gte: 10 } }`) —
 *     "if you have 10 or more stage points" (the Gatherer of Loyalties wh-70 gate);
 *   - `play-target` site (`{ siteType: "border-hold" }`) — binds the card to the
 *     company's current Border-hold (embeds `targetSiteDefinitionId` in the play
 *     action so the conversion attaches to that site);
 *   - five `on-event self-enters-play → add-constraint` effects (all `until-cleared`,
 *     discarded by `discardOrphanedSiteAttachedEvents` once no company occupies the
 *     bound site = "discard this card when the site is discarded / returned to its
 *     location deck; it cannot be discarded otherwise"):
 *       - `site-type-override` (→ haven): effective-type readers see a haven;
 *       - `wizardhaven-conversion` (player-scoped): the site is a Wizardhaven for
 *         the converting Fallen-wizard only — "Other Fallen-wizards may not use
 *         this site as a Wizardhaven";
 *       - `skip-automatic-attacks`: "loses all automatic-attacks";
 *       - `site-nothing-playable` (→ `site-nothing-playable-as-written`): the
 *         site's printed playable resources are suppressed;
 *       - `cancel-attacks-at-site`: attacks against a company staying here are canceled.
 *   - `stage-points` (2): the card's own gear-icon stage-point contribution while in play.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | playable during the site phase on a Border-hold               | OK     |
 * | 2 | only with 10 or more stage points                             | OK     |
 * | 3 | NOT playable on a non-Border-hold site                        | OK     |
 * | 4 | playing binds the card to the site and installs 5 constraints | OK     |
 * | 5 | contributes 2 stage points (it is a Stage resource)           | OK     |
 * | 6 | the site becomes one of your Wizardhavens (effective haven)   | OK     |
 * | 7 | …for the converting FW only (not other Fallen-wizards)        | OK     |
 * | 8 | loses all automatic-attacks                                   | OK     |
 * | 9 | nothing is considered playable as written on the site         | OK     |
 * |10 | all attacks against a company at this site are canceled       | OK     |
 * |11 | discarded when the site leaves play                           | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildFallenWizardSitePhaseState, playPermanentEventAndResolve,
  dispatch, phaseStateAs,
} from '../test-helpers.js';
import { computeLegalActions, SiteType, Alignment } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, SitePhaseState } from '../../index.js';
import { getEffectiveSiteType, siteAttacksCanceled } from '../../engine/effective.js';
import { isHavenForPlayer, isWizardhavenConversionFor, discardOrphanedSiteAttachedEvents, defById } from '../../engine/reducer-utils.js';

const MISCHIEF = 'wh-77' as CardDefinitionId;

// A character a Fallen-wizard may field.
const ARAGORN = 'tw-120' as CardDefinitionId;

// Cameth Brin (le-358): a minion Border-hold with a "Men — 1 strike, 7 prowess"
// automatic-attack and printed minor/major item resources (its detainment only
// bites a covert company; the overt test company faces the attack normally).
const CAMETH_BRIN = 'le-358' as CardDefinitionId;
// A shadow-hold — a non-Border-hold site, for the negative play-target test.
const MORIA = 'tw-413' as CardDefinitionId;

// A minor item playable at Cameth Brin (minor) before conversion. Ringwraith-
// aligned so a Fallen-wizard may play it at the ringwraith-aligned Border-hold
// (minion resource at a minion site — no cross-alignment block).
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;

// A hazard creature used as a revealed on-guard attack for the cancellation test.
const STOUT_MEN = 'as-21' as CardDefinitionId;

function mischiefInstanceId(state: GameState): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MISCHIEF)!.instanceId;
}

function viablePlays(state: GameState, id: CardInstanceId) {
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-permanent-event'
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
  );
}

/** Play Mischief in a Mean Way on the company's current Border-hold and resolve it. */
function convert(state: GameState, site: CardDefinitionId): GameState {
  return playPermanentEventAndResolve(
    state, PLAYER_1, mischiefInstanceId(state), undefined, { targetSiteDefinitionId: site },
  );
}

describe('Mischief in a Mean Way (wh-77)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 + 2: play gating (site phase, Border-hold, ≥10 stage points) ─────

  test('playable during the site phase on a Border-hold with 10+ stage points', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10,
    });
    const plays = viablePlays(state, mischiefInstanceId(state));
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(CAMETH_BRIN);
  });

  test('NOT playable with fewer than 10 stage points', () => {
    const state = buildFallenWizardSitePhaseState({
      site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 9,
    });
    expect(viablePlays(state, mischiefInstanceId(state))).toHaveLength(0);
  });

  test('NOT playable on a non-Border-hold site even with 10+ stage points', () => {
    const state = buildFallenWizardSitePhaseState({
      site: MORIA, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10,
    });
    expect(viablePlays(state, mischiefInstanceId(state))).toHaveLength(0);
  });

  // ── Rule 4: playing binds to the site and installs the five constraints ─────

  test('playing it binds the card to the site and installs all five constraints', () => {
    const before = buildFallenWizardSitePhaseState({
      site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10,
    });
    const after = convert(before, CAMETH_BRIN);

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === MISCHIEF);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(CAMETH_BRIN);

    const sourced = after.activeConstraints.filter(c => c.source === inPlay!.instanceId);
    const kinds = sourced.map(c => (c.kind.type === 'site-flag' ? c.kind.flag : c.kind.type));
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

  // ── Rule 5: contributes 2 stage points ──────────────────────────────────────

  test('once in play it contributes 2 stage points (it is a Stage resource)', () => {
    const before = buildFallenWizardSitePhaseState({
      site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10,
    });
    // The pre-set total (10) is a derived field; on entering play the engine
    // recomputes the stage-point total from in-play Stage cards — this card alone
    // contributes 2, proving the `stage-points` effect is counted.
    const after = convert(before, CAMETH_BRIN);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ── Rule 6 + 7: the site becomes one of YOUR Wizardhavens ───────────────────

  test('after conversion the effective site type is a haven', () => {
    const before = buildFallenWizardSitePhaseState({
      site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10,
    });
    expect(getEffectiveSiteType(before, CAMETH_BRIN, SiteType.BorderHold)).toBe(SiteType.BorderHold);

    const after = convert(before, CAMETH_BRIN);
    expect(getEffectiveSiteType(after, CAMETH_BRIN, SiteType.BorderHold)).toBe(SiteType.Haven);
  });

  test('the Wizardhaven is for the converting Fallen-wizard only (not other Fallen-wizards)', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10 }),
      CAMETH_BRIN,
    );
    const siteDef = defById(after, CAMETH_BRIN);

    // Without the conversion context, a Border-hold is not a haven for the FW.
    expect(isHavenForPlayer(siteDef, Alignment.FallenWizard)).toBe(false);
    // With it, the bound site is a Wizardhaven for the converting player only.
    expect(isWizardhavenConversionFor(after, CAMETH_BRIN, PLAYER_1)).toBe(true);
    expect(isHavenForPlayer(siteDef, Alignment.FallenWizard, {
      state: after, siteDefinitionId: CAMETH_BRIN, playerId: PLAYER_1,
    })).toBe(true);
    // …and not for the opponent ("Other Fallen-wizards may not use this site").
    expect(isWizardhavenConversionFor(after, CAMETH_BRIN, after.players[HAZARD_PLAYER].id)).toBe(false);
  });

  // ── Rule 8: loses all automatic-attacks ─────────────────────────────────────

  function atEnterOrSkip(state: GameState): GameState {
    const base = state.phaseState as SitePhaseState;
    return { ...state, phaseState: { ...base, step: 'enter-or-skip', siteEntered: false } };
  }

  test('without conversion, entering the Border-hold faces its automatic-attack', () => {
    const state = atEnterOrSkip(
      buildFallenWizardSitePhaseState({ site: CAMETH_BRIN, characters: [ARAGORN] }),
    );
    const cid = state.players[RESOURCE_PLAYER].companies[0].id;
    const entered = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect(phaseStateAs<SitePhaseState>(entered).step).toBe('reveal-on-guard-attacks');
  });

  test('after conversion, entering the site skips all automatic-attacks', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10 }),
      CAMETH_BRIN,
    );
    const cid = after.players[RESOURCE_PLAYER].companies[0].id;
    const entered = dispatch(atEnterOrSkip(after), { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect(phaseStateAs<SitePhaseState>(entered).step).toBe('declare-agent-attack');
  });

  // ── Rule 9: nothing playable as written on the site card ────────────────────

  test('a minor item playable at the printed Border-hold is no longer playable after conversion', () => {
    const before = buildFallenWizardSitePhaseState({
      site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF, SAW_TOOTHED_BLADE], stagePoints: 10,
    });
    const bladeId = before.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SAW_TOOTHED_BLADE)!.instanceId;

    const bladePlayable = (s: GameState) => computeLegalActions(s, PLAYER_1).some(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === bladeId,
    );

    expect(bladePlayable(before)).toBe(true);
    const after = convert(before, CAMETH_BRIN);
    expect(bladePlayable(after)).toBe(false);
  });

  // ── Rule 10: all attacks against a company at this site are canceled ─────────

  test('a revealed on-guard creature attack is canceled (discarded, no combat)', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10 }),
      CAMETH_BRIN,
    );
    expect(siteAttacksCanceled(after, CAMETH_BRIN)).toBe(true);

    const ogId = 'wh77-og-creature-1' as CardInstanceId;
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

  // ── Rule 11: discarded when the site leaves play ────────────────────────────

  test('the card and all its constraints are discarded once the site leaves play', () => {
    const after = convert(
      buildFallenWizardSitePhaseState({ site: CAMETH_BRIN, characters: [ARAGORN], hand: [MISCHIEF], stagePoints: 10 }),
      CAMETH_BRIN,
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === MISCHIEF)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(5);

    // The company moves on — its current site is no longer Cameth Brin.
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
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MISCHIEF)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MISCHIEF)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});
