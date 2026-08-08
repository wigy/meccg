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
 *   - `site-nothing-playable-as-written` → the site's printed playable resource
 *     categories (its `playableResources`: items, gold-ring, information) are
 *     suppressed. Factions and allies are NOT written on the site card — their
 *     playability comes from the faction/ally card naming the site (CoE 2.V.3) —
 *     so they remain playable at the converted site (the canonical combo: clear
 *     a Ruins & Lairs' automatic-attacks, then safely influence the faction that
 *     names it, e.g. Misty Mountain Wargs at Ettenmoors);
 *   - `cancel-attacks-at-site` → attacks against a company staying at the site
 *     are canceled: Site-phase on-guard creatures (reducer-site.ts) and
 *     movement/hazard keyed creatures (chain-reducer `initiateCreatureCombat`).
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
 * | 5b| …but a faction that names the site stays playable (regression) | OK     |
 * | 6 | all attacks against a company at this site are canceled        | OK     |
 * | 7 | discarded when the site leaves play                            | OK     |
 * | 8 | drafted as a Stage resource during the character draft (1.50)  | OK     |
 * | 9 | at draft, pair it with an eligible R&L from the site deck      | OK     |
 * |10 | the paired site auto-becomes a starting Wizardhaven (CRF 22)   | OK     |
 * |11 | both players reveal it on the same site → set aside (CRF 22)   | OK     |
 * |12 | Stage resource: contributes 1 stage point while in play       | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildFallenWizardSitePhaseState, buildFallenWizardOrgPhaseState, playPermanentEventAndResolve,
  dispatch, phaseStateAs, createGame, draftInstId, siteDeckInstId, runActions, makePlayDeck, pool, RIVENDELL,
  makeMHState, playCreatureHazardAndResolve, findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions, SiteType, Alignment, RegionType, Phase, CardStatus, reduce } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, GameConfig, SitePhaseState } from '../../index.js';
import { getEffectiveSiteType, siteAttacksCanceled } from '../../engine/effective.js';
import { isHavenForPlayer, isWizardhavenConversionFor, discardOrphanedSiteAttachedEvents, defById } from '../../engine/reducer-utils.js';

const HIDDEN_HAVEN = 'wh-75' as CardDefinitionId;

// A character a Fallen-wizard may field.
const ARAGORN = 'tw-120' as CardDefinitionId;
// A low-mind (5), non-agent character a Fallen-wizard may freely draft.
const BALIN = 'tw-123' as CardDefinitionId;

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

// Ettenmoors (le-373): Ruins & Lairs in Rhudaur (wilderness) — Hidden-Haven
// eligible. Its printed playable resources are minor items, and it carries
// Troll/Wolf automatic-attacks. Misty Mountain Wargs (le-272) is the unique
// faction that names Ettenmoors on its own card; Troll-chief (le-45) is a Troll
// Leader who can attempt the influence (and take the faction under leader
// control). Mirrors the reported game (mquxfmpa-ht4isa, seq 228).
const ETTENMOORS = 'le-373' as CardDefinitionId;
const MISTY_MOUNTAIN_WARGS = 'le-272' as CardDefinitionId;
const TROLL_CHIEF = 'le-45' as CardDefinitionId;

// A hazard creature, used as a revealed on-guard attack for the cancellation test.
const STOUT_MEN = 'as-21' as CardDefinitionId;

// A creature keyed to Ruins & Lairs (site type), used for the movement/hazard
// keyed-creature cancellation test.
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;

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
    // The site-flag markers are identified by their `flag`; other kinds by `type`.
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

  test('playing it contributes 1 stage point (it is a Stage resource)', () => {
    const before = buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] });
    const beforeSp = before.players[RESOURCE_PLAYER].stagePoints;
    const after = convert(before, BANDIT_LAIR);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(beforeSp + 1);
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

  // Regression (game mskidoss-noauyv, seq 1380): a company stayed at a Ruins &
  // Lairs converted by Hidden Haven, carrying a storable item. The organization
  // phase's store-item computation read the site's *printed* type instead of its
  // effective type, so it never offered to store the item even though the site
  // was now a Haven for storing purposes too (CoE rule 2.II.4: "at a haven",
  // with no exception for a site converted via override).
  test('a converted site permits storing an item during organization', () => {
    const converted = convert(
      buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] }),
      BANDIT_LAIR,
    );

    // Rebuild a fresh organization-phase state at the same (printed) site, with
    // Aragorn carrying a storable item, then graft on the conversion's
    // constraints — mirroring the reported game, where the company stayed at
    // the converted site into the organization phase.
    const orgState: GameState = {
      ...buildFallenWizardOrgPhaseState({
        site: BANDIT_LAIR,
        characters: [{ defId: ARAGORN, items: [SAW_TOOTHED_BLADE] }],
      }),
      activeConstraints: converted.activeConstraints,
    };

    const aragornId = findCharInstanceId(orgState, RESOURCE_PLAYER, ARAGORN);
    const itemInstId = orgState.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

    const stores = computeLegalActions(orgState, PLAYER_1).filter(
      a => a.viable && a.action.type === 'store-item'
        && (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === itemInstId,
    );
    expect(stores).toHaveLength(1);
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

  // Regression (game mquxfmpa-ht4isa, seq 228): a Fallen-wizard had Hidden Haven
  // on Ettenmoors (its starting Wizardhaven) with a Troll-chief company there and
  // Misty Mountain Wargs in hand. The faction names Ettenmoors on its OWN card, so
  // "nothing playable as written on the site card" must NOT suppress it — the
  // wargs should still be playable. The engine wrongly blocked them.
  test('a faction that names the converted site is STILL playable after conversion', () => {
    const before = buildFallenWizardSitePhaseState({
      site: ETTENMOORS, characters: [TROLL_CHIEF], hand: [HIDDEN_HAVEN, MISTY_MOUNTAIN_WARGS],
    });
    const wargsId = before.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MISTY_MOUNTAIN_WARGS)!.instanceId;

    const wargsInfluenceAttempt = (s: GameState) => computeLegalActions(s, PLAYER_1).some(
      a => a.viable && a.action.type === 'influence-attempt'
        && (a.action as { factionInstanceId?: CardInstanceId }).factionInstanceId === wargsId,
    );

    // Playable as a normal influence attempt before conversion …
    expect(wargsInfluenceAttempt(before)).toBe(true);
    // … and still playable after Hidden Haven converts Ettenmoors to a Wizardhaven
    // (this is the whole point: clear the Troll/Wolf auto-attacks, then influence
    // the wargs safely).
    const after = convert(before, ETTENMOORS);
    expect(wargsInfluenceAttempt(after)).toBe(true);
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

  test('a creature keyed against the staying company in the M/H phase is canceled (discarded, no combat)', () => {
    // Convert Bandit Lair into the FW's Wizardhaven, then switch the company's
    // non-moving turn into its movement/hazard phase. (Regression: previously the
    // `cancel-attacks-at-site` constraint was only honoured for Site-phase on-guard
    // creatures, so a creature keyed against the staying company during M/H still
    // resolved into combat — game mqtbg9mu-u4g9gt, Cave-drake at Ettenmoors.)
    const after = convert(
      buildFallenWizardSitePhaseState({ site: BANDIT_LAIR, characters: [ARAGORN], hand: [HIDDEN_HAVEN] }),
      BANDIT_LAIR,
    );
    expect(siteAttacksCanceled(after, BANDIT_LAIR)).toBe(true);

    const company = after.players[RESOURCE_PLAYER].companies[0];
    // The staying company has no destination — it is at the Wizardhaven.
    expect(company.destinationSite).toBeNull();

    // Give the hazard player a Cave-drake (keyed to Ruins & Lairs) and put the
    // active FW company into its play-hazards step against the Ruins & Lairs site.
    const drakeId = 'wh75-mh-cave-drake' as CardInstanceId;
    const mhReady: GameState = {
      ...after,
      activePlayer: PLAYER_1,
      players: [
        after.players[RESOURCE_PLAYER],
        {
          ...after.players[HAZARD_PLAYER],
          hand: [...after.players[HAZARD_PLAYER].hand, { instanceId: drakeId, definitionId: CAVE_DRAKE, status: CardStatus.Untapped }],
        },
      ] as GameState['players'],
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Brown Lands'],
        destinationSiteType: SiteType.RuinsAndLairs,
      }),
    };
    expect(mhReady.phaseState.phase).toBe(Phase.MovementHazard);

    const resolved = playCreatureHazardAndResolve(
      mhReady, PLAYER_2, drakeId, company.id,
      { method: 'site-type' as const, value: 'ruins-and-lairs' },
    );

    // No combat was initiated…
    expect(resolved.combat).toBeNull();
    // …and the Cave-drake was discarded to its owner (the hazard player).
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === CAVE_DRAKE)).toBe(true);
    // The creature did not vanish: exactly one copy is reachable in the discard.
    expect(resolved.players[HAZARD_PLAYER].discardPile.filter(c => c.instanceId === drakeId)).toHaveLength(1);
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

  // ── Rule 8: drafted as a Stage resource during the character draft (1.50) ────

  test('is draftable during the character draft and lands in hand for the starting site', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Hidden Haven is offered as a draftable Stage resource for the FW player.
    const hhInst = draftInstId(state, 0, HIDDEN_HAVEN);
    const offered = computeLegalActions(state, PLAYER_1).find(
      a => a.action.type === 'draft-pick'
        && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === hhInst,
    );
    expect(offered?.viable).toBe(true);

    // The FW drafts Hidden Haven — it resolves into the Stage resources at once
    // (CoE 1.9.F4) without using a character pick — and the opponent drafts their
    // only character. The FW then drafts a character as the round's pick, which
    // reveals against the opponent's, empties both pools and finalises the draft.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) },
    ]);

    // After finalize, Hidden Haven is in the FW player's hand, ready to be played
    // on the starting Ruins & Lairs.
    expect(state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === HIDDEN_HAVEN)).toBe(true);
  });
});

// ── CRF 22: choose the starting site when Hidden Haven is revealed at draft ──
//
// "If you start with Hidden Haven, you must bring out your starting site when
//  you reveal Hidden Haven." (CRF 22, Stage Resources). The drafting player
// pairs Hidden Haven with an eligible Ruins & Lairs from their own site deck;
// at draft finalize that site auto-becomes a starting Wizardhaven. "If both
// players reveal this … on the same site … it is set aside" — a same-site-
// definition collision sets both Hidden Havens aside (to hand) instead.
describe('Hidden Haven (wh-75) — draft site pairing (CRF 22)', () => {
  beforeEach(() => resetMint());

  test('offers pairing for an eligible Ruins & Lairs from the site deck, not ineligible sites', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(),
          siteDeck: [WORTHY_HILLS, MORIA, GOLD_HILL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    // The FW drafts Hidden Haven — it resolves into the Stage resources at once
    // and (being pairable) keeps the draft open with the pairing offers showing;
    // the opponent drafts their only character.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, HIDDEN_HAVEN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);

    // Only the lone eligible Ruins & Lairs (Worthy Hills) is offered — not the
    // shadow-hold (Moria) nor the Dragon's lair (Gold Hill).
    const pairOffers = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'select-stage-resource-site',
    );
    expect(pairOffers).toHaveLength(1);
    expect((pairOffers[0].action as { siteInstanceId?: CardInstanceId }).siteInstanceId)
      .toBe(siteDeckInstId(state, 0, WORTHY_HILLS));
  });

  test('revealing Hidden Haven and pairing its site makes both public to the opponent (revealedInstances)', () => {
    // Regression (game mquqgy3v-pina1b, seq 5): a Fallen-wizard drafted Hidden
    // Haven and paired it with a Ruins & Lairs (Ettenmoors). CRF 22 requires the
    // card to be revealed and its site "brought out" when revealed, so both
    // identities are public — yet neither landed in `revealedInstances`, leaving
    // the paired site looking like an unknown card to the opponent.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    const hhInst = draftInstId(state, 0, HIDDEN_HAVEN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);

    // A revealed Stage resource is public the moment it is drafted, before any
    // pairing is chosen.
    expect(state.revealedInstances[hhInst]).toBe(HIDDEN_HAVEN);

    const siteInst = siteDeckInstId(state, 0, WORTHY_HILLS);
    // The paired site is still in the (private) site deck — its identity is only
    // public if it has been accrued into revealedInstances.
    expect(state.revealedInstances[siteInst]).toBeUndefined();

    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_1,
      stageResourceInstanceId: hhInst, siteInstanceId: siteInst,
    }]);

    // Pairing "brings out" the site (CRF 22): the opponent can now see which
    // Ruins & Lairs the Hidden Haven names.
    expect(state.revealedInstances[siteInst]).toBe(WORTHY_HILLS);
    expect(state.revealedInstances[hhInst]).toBe(HIDDEN_HAVEN);
  });

  test('cannot stop drafting while a pairable Hidden Haven is unpaired', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    // Drafting Hidden Haven puts it in play immediately and (being pairable) keeps
    // the draft open with the pairing requirement outstanding.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, HIDDEN_HAVEN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);

    const stop = computeLegalActions(state, PLAYER_1).find(a => a.action.type === 'draft-stop');
    expect(stop?.viable).toBe(false);
    // The reducer also rejects a forced stop while the pairing is outstanding.
    expect(reduce(state, { type: 'draft-stop', player: PLAYER_1 }).error).toBeTruthy();
  });

  test('a revealed Hidden Haven blocks the next pick until its site is paired', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BALIN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    const hhInst = draftInstId(state, 0, HIDDEN_HAVEN);
    // The FW drafts Hidden Haven (resolves immediately); the opponent picks too.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);

    // The FW must now pair the Hidden Haven before the draft can
    // move forward: the pairing offer is the only viable thing — picking another
    // character and stopping are both suppressed until the site is chosen
    // (CRF 22: "you must bring out your starting site when you reveal Hidden
    // Haven").
    const before = computeLegalActions(state, PLAYER_1).filter(a => a.viable);
    expect(before.some(a => a.action.type === 'select-stage-resource-site')).toBe(true);
    expect(before.some(a => a.action.type === 'draft-pick')).toBe(false);
    expect(before.find(a => a.action.type === 'draft-stop')?.viable ?? false).toBe(false);
    // The reducer also rejects a forced character pick while the pairing is
    // outstanding — the engine, not just the UI, enforces the requirement.
    expect(
      reduce(state, { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) }).error,
    ).toBeTruthy();

    // Pairing resolves the requirement; the FW may then continue drafting.
    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_1,
      stageResourceInstanceId: hhInst, siteInstanceId: siteDeckInstId(state, 0, WORTHY_HILLS),
    }]);
    const after = computeLegalActions(state, PLAYER_1).filter(a => a.viable);
    expect(after.some(a => a.action.type === 'draft-pick')).toBe(true);
  });

  test('drafting Hidden Haven and pairing its site resolves the round with no forced character pick (the game proceeds)', () => {
    // Regression (game mqw50bgr-g0h33w): after drafting Hidden Haven and choosing
    // its site, the draft would not advance until the Fallen-wizard ALSO drafted a
    // character ("game does not go on until I draft something else"). Drafting a
    // Stage resource is now the player's whole action for the round (wigy ruling):
    // once the site is brought out and the opponent has picked, the round resolves
    // at once — the FW adds no character and play continues.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BALIN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    const hhInst = draftInstId(state, 0, HIDDEN_HAVEN);
    // The opponent makes their (face-down) pick; the Fallen-wizard drafts Hidden
    // Haven, which must still have its site brought out before the round resolves.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhInst },
    ]);
    // Pairing the site completes the FW's round action — the round resolves now,
    // without the FW being forced to draft a character.
    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_1,
      stageResourceInstanceId: hhInst, siteInstanceId: siteDeckInstId(state, 0, WORTHY_HILLS),
    }]);
    const step = (state.phaseState as { setupStep: { round: number; draftState: readonly { drafted: readonly unknown[]; currentPick: unknown }[] } }).setupStep;
    expect(step.round).toBe(2);                          // the round resolved and advanced
    expect(step.draftState[1].drafted).toHaveLength(1);  // the opponent's character was revealed/added
    expect(step.draftState[0].drafted).toHaveLength(0);  // the FW added no character that round
    expect(step.draftState[1].currentPick).toBeNull();   // the opponent's pick was consumed
  });

  test('pairing then finishing the draft converts the site to a starting Wizardhaven', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    // The instance id is stable from the pool through draftedStageResources, so
    // capture it before drafting and reuse it for the pairing.
    const hhInst = draftInstId(state, 0, HIDDEN_HAVEN);
    // The FW drafts Hidden Haven (resolves immediately) and the opponent picks
    // their only character; then pair the site.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);
    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_1,
      stageResourceInstanceId: hhInst,
      siteInstanceId: siteDeckInstId(state, 0, WORTHY_HILLS),
    }]);
    // The FW drafts the remaining character, which reveals against the opponent's
    // pending pick, empties both pools, and finalises the draft.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) },
    ]);

    const p1 = state.players[RESOURCE_PLAYER];
    // The paired Ruins & Lairs is now the base company's starting site …
    expect(p1.companies[0].currentSite?.definitionId).toBe(WORTHY_HILLS);
    // … removed from the site deck …
    expect(p1.siteDeck.some(c => c.definitionId === WORTHY_HILLS)).toBe(false);
    // … Hidden Haven is in play, bound to that site (not left in hand) …
    const inPlay = p1.cardsInPlay.find(c => c.definitionId === HIDDEN_HAVEN);
    expect(inPlay?.attachedToSite).toBe(WORTHY_HILLS);
    expect(p1.hand.some(c => c.definitionId === HIDDEN_HAVEN)).toBe(false);
    // … and the Wizardhaven conversion is active for the owning player only.
    expect(isWizardhavenConversionFor(state, WORTHY_HILLS, PLAYER_1)).toBe(true);
    expect(isWizardhavenConversionFor(state, WORTHY_HILLS, PLAYER_2)).toBe(false);
  });

  test('a Hidden Haven pairing auto-skips the starting-site-selection step for that player', () => {
    // The paired Hidden Haven site IS the Fallen-wizard's starting site
    // (rule 1.10.F1 / CRF 22), so they must not be prompted to choose one again —
    // the starting-site-selection step is skipped for them, while the opponent
    // (whose site is not pre-placed) still selects normally. The opponent's site
    // deck carries two Rivendell copies so their pick remains a genuine choice
    // (a single legal site would instead be auto-resolved — see wh-75's
    // sibling test coverage in rule-1.47-starting-sites.test.ts).
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ARAGORN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL, RIVENDELL], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    const hhInst = draftInstId(state, 0, HIDDEN_HAVEN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);
    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_1,
      stageResourceInstanceId: hhInst, siteInstanceId: siteDeckInstId(state, 0, WORTHY_HILLS),
    }]);
    // The FW takes its remaining character; the draft finalises and (no items, no
    // deck-draft) the game lands in the starting-site-selection step.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) },
    ]);

    const ps = state.phaseState as { setupStep: { step: string; siteSelectionState: readonly { done: boolean }[] } };
    expect(ps.setupStep.step).toBe('starting-site-selection');
    // The Fallen-wizard is auto-done (skipped); the opponent is not.
    expect(ps.setupStep.siteSelectionState[0].done).toBe(true);
    expect(ps.setupStep.siteSelectionState[1].done).toBe(false);
    // The FW is offered nothing in this step; the opponent is offered site picks.
    expect(computeLegalActions(state, PLAYER_1).filter(a => a.viable)).toHaveLength(0);
    expect(computeLegalActions(state, PLAYER_2).some(a => a.viable && a.action.type === 'select-starting-site')).toBe(true);
    // The FW's company already sits at the brought-out Hidden Haven site.
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite?.definitionId).toBe(WORTHY_HILLS);

    // The opponent selecting their site completes the step with no soft-lock.
    state = runActions(state, [
      { type: 'select-starting-site', player: PLAYER_2, siteInstanceId: siteDeckInstId(state, 1, RIVENDELL) },
      { type: 'pass', player: PLAYER_2 },
    ]);
    expect((state.phaseState as { setupStep: { step: string } }).setupStep.step).not.toBe('starting-site-selection');
  });

  test('collision: both players pairing the same site set both Hidden Havens aside', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.FallenWizard,
          draftPool: [HIDDEN_HAVEN, BALIN], playDeck: makePlayDeck(), siteDeck: [WORTHY_HILLS], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);
    // Both reveal (draft) Hidden Haven — Stage resources resolve immediately.
    // Capture each instance id before drafting (stable through the draft).
    const hhP1 = draftInstId(state, 0, HIDDEN_HAVEN);
    const hhP2 = draftInstId(state, 1, HIDDEN_HAVEN);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhP1 }]);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_2, characterInstanceId: hhP2 }]);
    // Both pair the SAME site definition (distinct instances in each deck).
    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_1,
      stageResourceInstanceId: hhP1, siteInstanceId: siteDeckInstId(state, 0, WORTHY_HILLS),
    }]);
    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_2,
      stageResourceInstanceId: hhP2, siteInstanceId: siteDeckInstId(state, 1, WORTHY_HILLS),
    }]);
    // Both stop (now allowed — each Hidden Haven is paired) → draft finalises.
    state = runActions(state, [{ type: 'draft-stop', player: PLAYER_1 }]);
    state = runActions(state, [{ type: 'draft-stop', player: PLAYER_2 }]);

    // CRF 22: same-site reveal → both Hidden Havens set aside (to hand), no
    // conversion, and each paired site stays in its owner's site deck.
    for (const idx of [RESOURCE_PLAYER, HAZARD_PLAYER]) {
      const p = state.players[idx];
      expect(p.hand.some(c => c.definitionId === HIDDEN_HAVEN)).toBe(true);
      expect(p.cardsInPlay.some(c => c.definitionId === HIDDEN_HAVEN)).toBe(false);
      expect(p.siteDeck.some(c => c.definitionId === WORTHY_HILLS)).toBe(true);
      expect(p.companies[0].currentSite).toBeNull();
    }
    expect(isWizardhavenConversionFor(state, WORTHY_HILLS, PLAYER_1)).toBe(false);
    expect(isWizardhavenConversionFor(state, WORTHY_HILLS, PLAYER_2)).toBe(false);
  });
});
