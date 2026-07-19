/**
 * @module wh-97.test
 *
 * Card test: Chambers in the Royal Court (wh-97)
 * Type: minion-resource-event (permanent) · alignment: stage · `gandalf-specific`
 *
 * Card text:
 *   "Gandalf specific. Playable on one of your hero Free-hold [{F}] sites in
 *    play. This site becomes a Wizardhaven [{H}] for your companies, loses all
 *    automatic-attacks against your companies, and is one of Gandalf's home
 *    sites. Nothing is considered playable as written on the site card. If one
 *    of your companies is at this site, all attacks against it are canceled.
 *    Other Fallen-wizards may not use this site as a Wizardhaven [{H}]. Discard
 *    this card when the site is discarded or returned to its location deck. It
 *    cannot be discarded otherwise. Cannot be duplicated on a given site."
 *
 * Gandalf's own Wizardhaven-conversion, mirroring Hidden Haven (wh-75) but for a
 * hero Free-hold and as a `gandalf-specific` Stage resource (played during the
 * organization phase, rule 5.F1, like Guarded Haven wh-74). Modelled as a
 * permanent event bound to the targeted site:
 *  - `gandalf-specific` keyword — only playable by the Fallen-wizard whose
 *    revealed avatar is Gandalf (`wizardSpecificName` gate in
 *    `playPermanentEventActions`).
 *  - `play-target` (target `site`) filter `{cardType: hero-site, siteType:
 *    free-hold}` — "your hero Free-hold [{F}] … in play" (a company's current
 *    site). Matched on the *printed* site type, so an already-converted site
 *    (effective type `haven`) is not re-targetable via the printed-type gate,
 *    and the site duplication-limit bars a second copy anyway.
 *  - On `self-enters-play` it adds the same five `until-cleared` constraints as
 *    Hidden Haven, all sourced from the card and discarded by
 *    `discardOrphanedSiteAttachedEvents` once no company occupies the bound site
 *    (= "when the site is discarded or returned to its location deck"; it cannot
 *    be discarded otherwise since it is a site-bound permanent event):
 *      - `site.type` override → haven ("becomes a Wizardhaven [{H}]");
 *      - `wizardhaven-conversion` (player-scoped) → the site is a Wizardhaven
 *        for the converting player only ({@link isHavenForPlayer}); "Other
 *        Fallen-wizards may not use this site as a Wizardhaven" is exactly this
 *        player-scoping — an opponent gets no Wizardhaven benefit;
 *      - `skip-automatic-attacks` → "loses all automatic-attacks" (hero
 *        Free-holds carry none printed, so this is a safeguard);
 *      - `site-nothing-playable-as-written` → the site's printed playable
 *        resource categories are suppressed;
 *      - `cancel-attacks-at-site` → attacks against a company staying at the
 *        site are canceled.
 *  - "and is one of Gandalf's home sites" — Gandalf (wh-4) prints home site
 *    "Any Free-hold". A Fallen-wizard avatar is home-site-only (havens excluded),
 *    so this clause is what lets Gandalf be (re-)brought into play at the
 *    Free-hold; `homesiteMatchesSite` now resolves the "Any Free-hold" form
 *    against the *printed* type, so the site stays one of Gandalf's home sites
 *    even after it becomes a Wizardhaven.
 *  - `duplication-limit` scope `site` — "Cannot be duplicated on a given site."
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Gandalf specific — only a Gandalf Fallen-wizard may play it    | OK     |
 * | 2 | playable on your hero Free-hold [{F}] in play                  | OK     |
 * | 2b| not a Free-hold / not hero / not a site → not playable         | OK     |
 * | 3 | the site becomes a Wizardhaven [{H}] for your companies        | OK     |
 * | 4 | loses all automatic-attacks (constraint installed)            | OK     |
 * | 5 | nothing is considered playable as written on the site card    | OK     |
 * | 6 | all attacks against a company at this site are canceled        | OK     |
 * | 7 | is one of Gandalf's home sites (Gandalf playable there)        | OK     |
 * | 8 | other Fallen-wizards may not use it as a Wizardhaven           | OK     |
 * | 9 | discarded when the site leaves play                            | OK     |
 * |10 | cannot be duplicated on a given site                          | OK     |
 * |11 | Stage resource: contributes 1 stage point while in play       | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildFallenWizardOrgPhaseState, playPermanentEventAndResolve,
} from '../test-helpers.js';
import { computeLegalActions, SiteType, Phase, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, SitePhaseState,
} from '../../index.js';
import { getEffectiveSiteType, siteAttacksCanceled } from '../../engine/effective.js';
import { isHavenForPlayer, isWizardhavenConversionFor, discardOrphanedSiteAttachedEvents, defById } from '../../engine/reducer-utils.js';

const CHAMBERS = 'wh-97' as CardDefinitionId;

// Avatars.
const GANDALF = 'wh-4' as CardDefinitionId;    // Fallen-wizard avatar, home site "Any Free-hold"
const PALLANDO = 'wh-7' as CardDefinitionId;   // a different Fallen-wizard avatar (home site The White Towers)

// A non-avatar hero character a Fallen-wizard can field, to keep a company alive
// when Gandalf is moved to hand for the home-site tests.
const ARAGORN = 'tw-120' as CardDefinitionId;

// Sites.
// tw-420 is the *hero* Rhosgobel: a hero-site Free-hold that plays minor items
// (its printed playable resource) — used to exercise "nothing playable as
// written". Distinct from wh-57 (the Radagast Wizardhaven site).
const HERO_FREEHOLD = 'tw-420' as CardDefinitionId;
const WELLINGHALL = 'tw-437' as CardDefinitionId;   // hero-site Free-hold, no printed resources
const HIMRING = 'tw-401' as CardDefinitionId;       // hero-site Ruins & Lairs (not a Free-hold)
const MINION_FREEHOLD = 'as-144' as CardDefinitionId; // Eagles' Eyrie: minion-site Free-hold (not "hero")
const ISENGARD = 'wh-56' as CardDefinitionId;        // Fallen-wizard haven (a haven that is not a Free-hold)

// A hero minor item with no play-site restriction — playable at the hero
// Rhosgobel (plays minor) before conversion, suppressed after.
const STING = 'tw-333' as CardDefinitionId;

function handInstance(state: GameState, defId: CardDefinitionId, playerIndex = RESOURCE_PLAYER): CardInstanceId {
  return state.players[playerIndex].hand.find(c => c.definitionId === defId)!.instanceId;
}

function chambersPlays(state: GameState, id: CardInstanceId) {
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-permanent-event'
      && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
  );
}

/** Play Chambers on the company's current hero Free-hold and resolve it. */
function convert(state: GameState, site: CardDefinitionId): GameState {
  return playPermanentEventAndResolve(
    state, PLAYER_1, handInstance(state, CHAMBERS), undefined, { targetSiteDefinitionId: site },
  );
}

/** Is `charId` (in hand) offered as a play-character at `siteInstanceId`? */
function canPlayCharacterAtSite(state: GameState, charInstanceId: CardInstanceId, siteInstanceId: CardInstanceId): boolean {
  return computeLegalActions(state, PLAYER_1).some(
    a => a.viable && a.action.type === 'play-character'
      && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === charInstanceId
      && (a.action as { atSite?: CardInstanceId }).atSite === siteInstanceId,
  );
}

describe('Chambers in the Royal Court (wh-97)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Gandalf specific ────────────────────────────────────────────────

  test('playable when the Fallen-wizard avatar is Gandalf', () => {
    const state = buildFallenWizardOrgPhaseState({ site: HERO_FREEHOLD, characters: [GANDALF], hand: [CHAMBERS] });
    const plays = chambersPlays(state, handInstance(state, CHAMBERS));
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(HERO_FREEHOLD);
  });

  test('NOT playable when the Fallen-wizard avatar is not Gandalf', () => {
    const state = buildFallenWizardOrgPhaseState({ site: HERO_FREEHOLD, characters: [PALLANDO], hand: [CHAMBERS] });
    expect(chambersPlays(state, handInstance(state, CHAMBERS))).toHaveLength(0);
  });

  // ── Rule 2: playable on your hero Free-hold [{F}] in play ────────────────────

  test('NOT playable on a hero site that is not a Free-hold (Ruins & Lairs)', () => {
    const state = buildFallenWizardOrgPhaseState({ site: HIMRING, characters: [GANDALF], hand: [CHAMBERS] });
    expect(chambersPlays(state, handInstance(state, CHAMBERS))).toHaveLength(0);
  });

  test('NOT playable on a Free-hold that is not a hero site (a minion Free-hold)', () => {
    const state = buildFallenWizardOrgPhaseState({ site: MINION_FREEHOLD, characters: [GANDALF], hand: [CHAMBERS] });
    expect(chambersPlays(state, handInstance(state, CHAMBERS))).toHaveLength(0);
  });

  // ── Playing it binds the card and installs the five site constraints ────────

  test('playing it binds the card to the site and installs the five constraints', () => {
    const before = buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS] });
    const after = convert(before, WELLINGHALL);

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === CHAMBERS);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(WELLINGHALL);

    const sourced = after.activeConstraints.filter(c => c.source === inPlay!.instanceId);
    const kinds = sourced.map(c => (c.kind.type === 'site-flag' ? c.kind.flag : c.kind.type));
    expect(kinds).toContain('attribute-modifier');            // site.type → haven
    expect(kinds).toContain('wizardhaven-conversion');
    expect(kinds).toContain('skip-automatic-attacks');        // Rule 4
    expect(kinds).toContain('site-nothing-playable-as-written'); // Rule 5
    expect(kinds).toContain('cancel-attacks-at-site');        // Rule 6

    const siteTypeOverride = sourced.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    expect(siteTypeOverride?.kind.type === 'attribute-modifier' && siteTypeOverride.kind.value).toBe(SiteType.Haven);
  });

  // ── Rule 11: contributes 1 stage point ──────────────────────────────────────

  test('playing it contributes 1 stage point (it is a Stage resource)', () => {
    const before = buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS] });
    const beforeSp = before.players[RESOURCE_PLAYER].stagePoints;
    const after = convert(before, WELLINGHALL);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(beforeSp + 1);
  });

  // ── Rule 3 + 8: becomes a Wizardhaven for your companies only ────────────────

  test('after conversion the effective site type is a haven', () => {
    const before = buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS] });
    expect(getEffectiveSiteType(before, WELLINGHALL, SiteType.FreeHold)).toBe(SiteType.FreeHold);

    const after = convert(before, WELLINGHALL);
    expect(getEffectiveSiteType(after, WELLINGHALL, SiteType.FreeHold)).toBe(SiteType.Haven);
  });

  test('the conversion makes the site a Wizardhaven for the converting player only', () => {
    const after = convert(
      buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS] }),
      WELLINGHALL,
    );
    const siteDef = defById(after, WELLINGHALL);

    // Before conversion a Free-hold is not a Wizardhaven for a Fallen-wizard.
    expect(isHavenForPlayer(siteDef, after.players[RESOURCE_PLAYER].alignment)).toBe(false);
    // With the conversion, it is — for the converting player …
    expect(isWizardhavenConversionFor(after, WELLINGHALL, PLAYER_1)).toBe(true);
    expect(isHavenForPlayer(siteDef, after.players[RESOURCE_PLAYER].alignment, {
      state: after, siteDefinitionId: WELLINGHALL, playerId: PLAYER_1,
    })).toBe(true);
    // … and NOT for the opponent ("Other Fallen-wizards may not use it").
    expect(isWizardhavenConversionFor(after, WELLINGHALL, PLAYER_2)).toBe(false);
    expect(isHavenForPlayer(siteDef, after.players[HAZARD_PLAYER].alignment, {
      state: after, siteDefinitionId: WELLINGHALL, playerId: PLAYER_2,
    })).toBe(false);
  });

  // ── Rule 6: attacks against a company staying at the site are canceled ───────

  test('attacks against a company at the site are canceled', () => {
    const before = buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS] });
    expect(siteAttacksCanceled(before, WELLINGHALL)).toBe(false);
    const after = convert(before, WELLINGHALL);
    expect(siteAttacksCanceled(after, WELLINGHALL)).toBe(true);
  });

  // ── Rule 5: nothing is considered playable as written on the site card ───────

  test('a minor item playable at the printed hero Free-hold is suppressed after conversion', () => {
    // Play Chambers on the hero Rhosgobel (plays minor items), then drop into the
    // site phase to check item playability at the converted site.
    const orgBase = buildFallenWizardOrgPhaseState({
      site: HERO_FREEHOLD, characters: [GANDALF], hand: [CHAMBERS, STING],
    });

    const toSitePhase = (s: GameState): GameState => {
      const sitePhaseState: SitePhaseState = {
        phase: Phase.Site,
        step: 'play-resources',
        activeCompanyIndex: 0,
        handledCompanyIds: [],
        siteEntered: true,
        resourcePlayed: false,
        minorItemAvailable: false,
        hoardBountyAvailable: false,
        thoroughSearchAvailable: false,
        declaredAgentAttack: null,
        automaticAttacksResolved: 0,
        awaitingOnGuardReveal: false,
        pendingResourceAction: null,
        opponentInteractionThisTurn: null,
        pendingOpponentInfluence: null,
      };
      return { ...s, phaseState: sitePhaseState };
    };

    const stingId = handInstance(orgBase, STING);
    const stingPlayable = (s: GameState): boolean => computeLegalActions(s, PLAYER_1).some(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === stingId,
    );

    // Before conversion, Sting is playable at the printed Free-hold …
    expect(stingPlayable(toSitePhase(orgBase))).toBe(true);
    // … but once Chambers converts the site, nothing written on the site card is
    // playable, so Sting is no longer offered there.
    const converted = convert(orgBase, HERO_FREEHOLD);
    expect(stingPlayable(toSitePhase(converted))).toBe(false);
  });

  // ── Rule 7: is one of Gandalf's home sites ──────────────────────────────────

  test("Gandalf's \"Any Free-hold\" home site lets him be played at a Free-hold but not at a non-Free-hold haven", () => {
    // A Fallen-wizard avatar is home-site-only (havens excluded), so this
    // exercises the home-site match, not the haven path. Gandalf sits in hand;
    // Aragorn keeps a company alive at each site.
    const atFreehold = buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [ARAGORN], hand: [GANDALF] });
    const gandalfId = handInstance(atFreehold, GANDALF);
    const freeholdInstance = atFreehold.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    expect(canPlayCharacterAtSite(atFreehold, gandalfId, freeholdInstance)).toBe(true);

    // At a Fallen-wizard haven that is NOT a Free-hold, Gandalf (home-site-only)
    // may not be brought into play.
    const atHaven = buildFallenWizardOrgPhaseState({ site: ISENGARD, characters: [ARAGORN], hand: [GANDALF] });
    const havenGandalf = handInstance(atHaven, GANDALF);
    const havenInstance = atHaven.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    expect(canPlayCharacterAtSite(atHaven, havenGandalf, havenInstance)).toBe(false);
  });

  test('the converted site remains one of Gandalf\'s home sites (playable there after it becomes a Wizardhaven)', () => {
    // Convert the Free-hold with Gandalf as avatar, then simulate Gandalf being
    // returned to hand: he must still be playable at the site — now a Wizardhaven —
    // because its printed type (Free-hold) still matches his home site.
    const converted = convert(
      buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF, ARAGORN], hand: [CHAMBERS] }),
      WELLINGHALL,
    );
    const p1 = converted.players[RESOURCE_PLAYER];
    const company = p1.companies[0];
    const gandalfInstance = company.characters.find(
      cId => p1.characters[cId]?.definitionId === GANDALF,
    )!;
    const siteInstance = company.currentSite!.instanceId;

    // Move Gandalf from the company/roster into hand (leaving Aragorn behind).
    const withGandalfInHand: GameState = {
      ...converted,
      players: [
        {
          ...p1,
          companies: [{ ...company, characters: company.characters.filter(c => c !== gandalfInstance) }],
          characters: Object.fromEntries(
            Object.entries(p1.characters).filter(([id]) => id !== (gandalfInstance as string)),
          ),
          hand: [...p1.hand, { instanceId: gandalfInstance, definitionId: GANDALF, status: CardStatus.Untapped }],
        },
        converted.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };

    // The site now reads as a haven, yet Gandalf can still be brought into play
    // there via the (printed-Free-hold) home site.
    expect(getEffectiveSiteType(withGandalfInHand, WELLINGHALL, SiteType.FreeHold)).toBe(SiteType.Haven);
    expect(canPlayCharacterAtSite(withGandalfInHand, gandalfInstance, siteInstance)).toBe(true);
  });

  // ── Rule 10: cannot be duplicated on a given site ───────────────────────────

  test('a second copy cannot be played at a site that already holds one', () => {
    const state = buildFallenWizardOrgPhaseState({
      site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS, CHAMBERS],
    });
    const first = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === CHAMBERS)!.instanceId;
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, first, undefined, { targetSiteDefinitionId: WELLINGHALL },
    );
    const second = after.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === CHAMBERS)!.instanceId;
    expect(chambersPlays(after, second)).toHaveLength(0);
  });

  // ── Rule 9: discarded when the site leaves play (not otherwise) ──────────────

  test('persists while a company occupies the bound site', () => {
    const after = convert(
      buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS] }),
      WELLINGHALL,
    );
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === CHAMBERS)).toBe(true);
  });

  test('the card and all its constraints are discarded once the site leaves play', () => {
    const after = convert(
      buildFallenWizardOrgPhaseState({ site: WELLINGHALL, characters: [GANDALF], hand: [CHAMBERS] }),
      WELLINGHALL,
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === CHAMBERS)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId).length).toBeGreaterThan(0);

    // The company moves on — its current site is no longer the Free-hold.
    const movedCompany = {
      ...after.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...after.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: HIMRING },
    };
    const moved: GameState = {
      ...after,
      players: [
        { ...after.players[RESOURCE_PLAYER], companies: [movedCompany] },
        after.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === CHAMBERS)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === CHAMBERS)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});
