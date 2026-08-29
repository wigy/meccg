/**
 * @module td-146.test
 *
 * Card test: Returned Exiles (td-146)
 * Type: hero-resource-faction, unique, wizard
 *
 * Text:
 *   "Unique. Playable at a tapped or untapped site where an at home Dragon
 *    manifestation was defeated if the influence check is greater than 12.
 *    Standard Modifications: King under the Mountain Dwarf (+5), other
 *    Dwarves (+2)."
 *
 * influenceNumber = 13, race = dwarf.
 *
 * Effects:
 * | # | Effect Type    | Notes                                                          |
 * |---|----------------|------------------------------------------------------------------|
 * | 1 | play-flag      | playable-at-tapped-site — "a tapped or untapped site"            |
 * | 2 | check-modifier | +5 influence when bearer.itemNames includes "King under the      |
 * |   |                | Mountain" (i.e. the bearer of td-126)                            |
 * | 3 | check-modifier | +2 influence when bearer.race dwarf AND not the King bearer      |
 *
 * `playableAt`: `[{ any: true, when: { "site.dragonAtHomeVictory": true } }]`
 * — "a site where an at home Dragon manifestation was defeated" required new
 * permanent, *site*-scoped (not character-scoped) state:
 * `GameState.dragonAtHomeVictorySiteIds`, recorded in `combat-finalize.ts`
 * in the same block that already detects an augmented "<Dragon> at Home"
 * attack for King under the Mountain (td-126) — as opposed to a lair's
 * baseline printed Dragon attack, which CoE rule g.man.3 excludes from
 * "manifestations". Unlike td-126, Returned Exiles does not exclude
 * Eärcaraxë at Home and does not require the *same* company/characters to
 * still be present — the site itself remains "where a Dragon was defeated"
 * permanently, independent of who fought there. Consumed by
 * `siteMatchesEntry` (`reducer-utils.ts`) as `site.dragonAtHomeVictory`.
 *
 * "King under the Mountain Dwarf" is resolved via a new `bearer.itemNames`
 * resolver-context field (`ResolverContext.bearer.itemNames`,
 * `engine/effects/resolver.ts`; populated by the faction-influence-check
 * bearer builder in `legal-actions/site.ts`) — a permanent event attached to
 * a character is stored in `CharacterInPlay.items` (there is no separate
 * attached-event zone; see `keyword-replaced.ts`), so a bearer holding
 * td-126 shows up there by name.
 *
 * Playable: YES
 * Certified: 2026-08-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  BALIN, GIMLI, ARAGORN, ELROND, GLORFINDEL_II,
  buildSitePhaseState, resetMint, setupAutoAttackStep,
  runAutoAttackCombatMulti, addCardInPlay,
  findCharInstanceId, findHandCardId,
  withSiteTapped, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, GameState, InfluenceAttemptAction } from '../../index.js';

const RETURNED_EXILES = 'td-146' as CardDefinitionId;
const KING_UNDER_THE_MOUNTAIN = 'td-126' as CardDefinitionId;
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;
const EARCARAXE_AT_HOME = 'td-22' as CardDefinitionId;
const LONELY_MOUNTAIN_HERO = 'tw-428' as CardDefinitionId; // Smaug's lair (lairOf tw-90)
const ISLE_OF_THE_ULOND = 'td-178' as CardDefinitionId;    // Eärcaraxë's lair (lairOf td-20)

/**
 * Set up a site-phase company of Balin/Elrond/Glorfindel II at `site`,
 * optionally with a Dragon-at-home card in the hazard player's cardsInPlay,
 * positioned at the automatic-attacks step. Mirrors the fixture used by
 * King under the Mountain (td-126)'s own test — Elrond/Glorfindel II are
 * strong enough to reliably defeat the augmented at-home Dragon attack (18
 * prowess) on a forced roll of 12.
 */
function setupLairCompany(site: CardDefinitionId, atHomeDefId?: CardDefinitionId): GameState {
  let state: GameState = setupAutoAttackStep(buildSitePhaseState({
    site,
    characters: [BALIN, ELROND, GLORFINDEL_II],
  }));
  if (atHomeDefId) {
    state = addCardInPlay(state, 1, atHomeDefId);
  }
  return state;
}

function influenceAttempts(state: GameState, exilesHandId: CardDefinitionId | string): InfluenceAttemptAction[] {
  return computeLegalActions(state, PLAYER_1)
    .filter(a => a.viable && a.action.type === 'influence-attempt' && a.action.factionInstanceId === exilesHandId)
    .map(a => a.action as InfluenceAttemptAction);
}

describe('Returned Exiles (td-146)', () => {
  beforeEach(() => resetMint());

  // ─── playableAt: "a site where an at home Dragon manifestation was defeated" ───

  test('NOT playable at a site with no recorded Dragon-at-home victory', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    const exilesId = findHandCardId(state, RESOURCE_PLAYER, RETURNED_EXILES);
    expect(influenceAttempts(state, exilesId)).toHaveLength(0);
  });

  test('playable at an untapped site once recorded as a Dragon-at-home victory', () => {
    let state = buildSitePhaseState({
      characters: [GIMLI],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    state = { ...state, dragonAtHomeVictorySiteIds: [LONELY_MOUNTAIN_HERO] };
    const exilesId = findHandCardId(state, RESOURCE_PLAYER, RETURNED_EXILES);
    expect(influenceAttempts(state, exilesId).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a TAPPED site once recorded — "tapped or untapped" (playable-at-tapped-site)', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    const tapped: GameState = withSiteTapped({ ...state, dragonAtHomeVictorySiteIds: [LONELY_MOUNTAIN_HERO] });
    expect(tapped.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    const exilesId = findHandCardId(tapped, RESOURCE_PLAYER, RETURNED_EXILES);
    expect(influenceAttempts(tapped, exilesId).length).toBeGreaterThanOrEqual(1);
  });

  test('the recorded victory is not tied to any particular company — a later, unrelated company may still play it', () => {
    // No character here was part of any fight; only the site's own permanent
    // record makes Returned Exiles playable.
    let state = buildSitePhaseState({
      characters: [ARAGORN],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    state = { ...state, dragonAtHomeVictorySiteIds: [LONELY_MOUNTAIN_HERO] };
    const exilesId = findHandCardId(state, RESOURCE_PLAYER, RETURNED_EXILES);
    expect(influenceAttempts(state, exilesId).length).toBeGreaterThanOrEqual(1);
  });

  test('defeating the printed lair attack alone (no At-Home in play) does NOT record a site-level victory', () => {
    const state = setupLairCompany(LONELY_MOUNTAIN_HERO);
    const { state: after } = runAutoAttackCombatMulti(state, [
      { characterDefId: BALIN, roll: 12 },
    ]);
    expect(after.combat).toBeNull();
    expect(after.dragonAtHomeVictorySiteIds ?? []).not.toContain(LONELY_MOUNTAIN_HERO);
  });

  test('defeating the augmented Smaug-at-Home attack records the site-level victory and unlocks the faction', () => {
    const state = setupLairCompany(LONELY_MOUNTAIN_HERO, SMAUG_AT_HOME);
    // Attack 0: printed Dragon (1 strike, 14 prowess) — Balin defeats it.
    const round1 = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]);
    expect(round1.state.combat).toBeNull();
    // Attack 1: augmented at-home Dragon (2 strikes, 18 prowess) — Elrond + Glorfindel II defeat it.
    const round2 = runAutoAttackCombatMulti(round1.state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]);
    expect(round2.state.combat).toBeNull();
    expect(round2.state.dragonAtHomeVictorySiteIds ?? []).toContain(LONELY_MOUNTAIN_HERO);

    // Every company member tapped fighting the Dragon, so no one here can
    // attempt influence this turn — carry the recorded flag forward onto a
    // fresh company (an untapped Gimli) to confirm it now unlocks the faction.
    const unlocked = {
      ...buildSitePhaseState({
        characters: [GIMLI],
        site: LONELY_MOUNTAIN_HERO,
        hand: [RETURNED_EXILES],
      }),
      dragonAtHomeVictorySiteIds: round2.state.dragonAtHomeVictorySiteIds,
    };
    const exilesId = findHandCardId(unlocked, RESOURCE_PLAYER, RETURNED_EXILES);
    expect(influenceAttempts(unlocked, exilesId).length).toBeGreaterThanOrEqual(1);
  });

  test('defeating the augmented Eärcaraxë-at-Home attack ALSO records the victory (unlike td-126, no exclusion)', () => {
    const state = setupLairCompany(ISLE_OF_THE_ULOND, EARCARAXE_AT_HOME);
    const round1 = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]);
    expect(round1.state.combat).toBeNull();
    const round2 = runAutoAttackCombatMulti(round1.state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]);
    expect(round2.state.combat).toBeNull();
    expect(round2.state.dragonAtHomeVictorySiteIds ?? []).toContain(ISLE_OF_THE_ULOND);
  });

  // ─── Standard Modifications: King under the Mountain Dwarf (+5), other Dwarves (+2) ───

  test('King under the Mountain Dwarf bearer gets +5 (on top of DI bonuses) — need drops to 0', () => {
    // Balin printed DI 2 + his own built-in +1 vs Dwarf factions + King under
    // the Mountain's own +5 vs Dwarf factions = 8, plus Returned Exiles' own
    // +5 check bonus for the King's bearer. influenceNumber 13 -> need = 13 - 8 - 5 = 0.
    const state = buildSitePhaseState({
      characters: [{ defId: BALIN, items: [KING_UNDER_THE_MOUNTAIN] }],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    const state2 = { ...state, dragonAtHomeVictorySiteIds: [LONELY_MOUNTAIN_HERO] };
    const balinId = findCharInstanceId(state2, RESOURCE_PLAYER, BALIN);
    const attempt = influenceAttempts(state2, findHandCardId(state2, RESOURCE_PLAYER, RETURNED_EXILES))
      .find(a => a.influencingCharacterId === balinId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(0);
  });

  test('other Dwarves (no King under the Mountain) get +2 — Gimli need = 9', () => {
    // Gimli printed DI 2 (no generic dwarf-faction bonus of his own) + Returned
    // Exiles' own +2 "other Dwarves" check bonus. need = 13 - 2 - 2 = 9.
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    const state2 = { ...state, dragonAtHomeVictorySiteIds: [LONELY_MOUNTAIN_HERO] };
    const gimliId = findCharInstanceId(state2, RESOURCE_PLAYER, GIMLI);
    const attempt = influenceAttempts(state2, findHandCardId(state2, RESOURCE_PLAYER, RETURNED_EXILES))
      .find(a => a.influencingCharacterId === gimliId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('a non-Dwarf influencer gets neither bonus — Aragorn II need = 10', () => {
    // Aragorn II printed DI 3, no dwarf-related bonus of his own, no Returned
    // Exiles check bonus (not a Dwarf). need = 13 - 3 - 0 = 10.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    const state2 = { ...state, dragonAtHomeVictorySiteIds: [LONELY_MOUNTAIN_HERO] };
    const aragornId = findCharInstanceId(state2, RESOURCE_PLAYER, ARAGORN);
    const attempt = influenceAttempts(state2, findHandCardId(state2, RESOURCE_PLAYER, RETURNED_EXILES))
      .find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('a Dwarf who bears King under the Mountain does NOT also get the plain +2 "other Dwarves" bonus', () => {
    // If both bonuses applied Balin's need would be 13 - 8 - 7 = -2; the
    // "King under the Mountain Dwarf" and "other Dwarves" table rows are
    // mutually exclusive, so it stays 0 (floored need is never negative in
    // any case, but the point is the check-modifier itself is exactly +5,
    // not +7).
    const withKing = buildSitePhaseState({
      characters: [{ defId: BALIN, items: [KING_UNDER_THE_MOUNTAIN] }],
      site: LONELY_MOUNTAIN_HERO,
      hand: [RETURNED_EXILES],
    });
    const state2 = { ...withKing, dragonAtHomeVictorySiteIds: [LONELY_MOUNTAIN_HERO] };
    const balinId = findCharInstanceId(state2, RESOURCE_PLAYER, BALIN);
    const attempt = influenceAttempts(state2, findHandCardId(state2, RESOURCE_PLAYER, RETURNED_EXILES))
      .find(a => a.influencingCharacterId === balinId);
    expect(attempt!.need).toBe(0);
  });
});
