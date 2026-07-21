/**
 * @module as-164.test
 *
 * Card test: The Under-galleries (as-164)
 * Type: minion-site (dark-hold, under-deeps) in Ûdun — the Ringwraith-player
 * twin of the Balrog version (ba-99) and the hero version (dm-37), but printed
 * with the simpler minion text: a single detainment automatic-attack, no
 * dynamic second attack and no "attacks normally" Special.
 *
 * Text:
 *   Adjacent Sites: Any site in Udûn (0), The Under-courts (4), The Sulfur-deeps (7)
 *   Playable: Information, Items (minor)
 *   Automatic-attacks: Trolls — 4 strikes with 10 prowess (detainment)
 *
 * Data encoding (filled/added this pass; the imported data dropped both):
 *   - `adjacentSites` from the printed Adjacent Sites line (cards.json
 *     authoritative): the `"*region:Udûn"` wildcard at roll 0 ("Any site in
 *     Udûn"), The Under-courts (4), The Sulfur-deeps (7) — mirroring the ba-99 /
 *     dm-37 twins, whose descent origin is also the Udûn-region wildcard.
 *   - `combat-detainment` (unfiltered) — the printed "(detainment)" marker on
 *     the automatic-attack, unconditional for any defender (as-152 / as-161
 *     precedent). `keywords: ["under-deeps"]` was already present.
 *
 * Note on "Any site in Udûn (0)": the entire card pool (checked against the
 * authoritative cards.json) contains NO surface site in region Udûn/Ûdun — the
 * only three sites in that region are the Under-galleries twins themselves, all
 * Under-deeps sites. So the region-wildcard descent has no live target to plan a
 * move from; it is encoded (matching the certified twins) and its resolver
 * branch is exercised negatively (a non-Udûn Darkhaven is not adjacent), but no
 * positive surface-descent plan-movement can exist. The two real Under-deeps
 * neighbors (The Under-courts, The Sulfur-deeps) are fully tested below.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                      |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path          |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                          |
 * | 4 | region            | OK     | "Ûdun"                                         |
 * | 5 | playableResources | OK     | [information, minor] — matches printed line     |
 * | 6 | automaticAttacks  | OK     | Trolls, 4 strikes, 10 prowess                  |
 * | 7 | resourceDraws     | OK     | 2                                              |
 * | 8 | hazardDraws       | OK     | 2                                              |
 * | 9 | keywords          | OK     | ["under-deeps"]                                |
 * | 10| adjacentSites     | OK     | Udûn wildcard (0), Under-courts (4), Sulfur (7)|
 * | 11| effects           | OK     | combat-detainment — added this pass            |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                       |
 * |---|------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED | select-company, enter-or-skip, play-resources|
 * | 2 | Item playability (minor only)            | IMPLEMENTED | site.ts enforces playableResources           |
 * | 3 | Under-deeps movement (adjacency + rolls) | IMPLEMENTED | organization-companies.ts / mh-steps.ts      |
 * | 4 | Region-wildcard adjacency ("Any site in") | IMPLEMENTED | resolveAdjacency "*region:" branch           |
 * | 5 | Automatic attack (Trolls 4x10)           | IMPLEMENTED | reducer-site.ts                              |
 * | 6 | Detainment marker on the auto-attack     | IMPLEMENTED | combat-detainment via isDetainmentAttack     |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LORIEN,
  resetMint, pool,
  buildTestState, buildMinionSitePhaseState, setupAutoAttackStep,
  viableFor, viableActions, dispatch,
  findHandCardId,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isUnderDeepsAdjacent, resolveAdjacency } from '../../engine/legal-actions/organization-companies.js';
import { getUnderDeepsRequiredRoll } from '../../engine/mh-steps.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type { CardDefinitionId, GameState, SiteCard, PlanMovementAction } from '../../index.js';

const THE_UNDER_GALLERIES = 'as-164' as CardDefinitionId; // this card (minion under-deeps dark-hold)
const THE_UNDER_COURTS = 'as-163' as CardDefinitionId;    // minion under-deeps dark-hold (roll 4)
const THE_SULFUR_DEEPS = 'as-161' as CardDefinitionId;    // minion under-deeps dark-hold (roll 7, reverse edge)
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;       // Darkhaven in Angmar, NOT in Udûn (negative case)
const DOL_GULDUR = 'le-367' as CardDefinitionId;          // Darkhaven in Southern Mirkwood (start site)

const THE_MOUTH = 'le-24' as CardDefinitionId;            // minion Man, prowess 6
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;   // minor minion item
const HIGH_HELM = 'le-313' as CardDefinitionId;           // major minion item

/** A throwaway state (just to supply a populated cardPool to the adjacency helpers). */
function anyState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
}

/** Ringwraith-player company (The Mouth) at `site` in the organization phase, `deck` in the site deck. */
function orgAt(site: CardDefinitionId, deck: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [THE_MOUTH] }], hand: [], siteDeck: deck },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
}

describe('The Under-galleries (as-164)', () => {
  beforeEach(() => resetMint());

  // ─── Under-deeps adjacency and movement rolls ──────────────────────────────

  test('adjacent to The Under-courts at roll 4 (forward edge, minion roll)', () => {
    const state = anyState();
    const underGalleries = pool[THE_UNDER_GALLERIES as string] as SiteCard;
    const underCourts = pool[THE_UNDER_COURTS as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, underGalleries, underCourts)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, underGalleries, underCourts)).toBe(4);
  });

  test('adjacent to The Sulfur-deeps at roll 7 in both directions', () => {
    const state = anyState();
    const underGalleries = pool[THE_UNDER_GALLERIES as string] as SiteCard;
    const sulfurDeeps = pool[THE_SULFUR_DEEPS as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, underGalleries, sulfurDeeps)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, underGalleries, sulfurDeeps)).toBe(7);
    // Reverse edge: as-161 also lists The Under-galleries at 7.
    expect(getUnderDeepsRequiredRoll(state, sulfurDeeps, underGalleries)).toBe(7);
  });

  test('the "Any site in Udûn" region wildcard does NOT over-match a non-Udûn Darkhaven', () => {
    // Geann a-Lisch sits in Angmar, not Udûn — the "*region:Udûn" wildcard must
    // not resolve it, and it is not a named neighbor either.
    const state = anyState();
    const underGalleries = pool[THE_UNDER_GALLERIES as string] as SiteCard;
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    expect(resolveAdjacency(state, underGalleries, geann.name)).toBeUndefined();
    expect(isUnderDeepsAdjacent(state, underGalleries, geann)).toBe(false);
  });

  test('plan-movement offers moving on from The Under-galleries to The Under-courts', () => {
    const state = orgAt(THE_UNDER_GALLERIES, [THE_UNDER_COURTS]);
    const underCourtsInst = state.players[0].siteDeck.find(s => s.definitionId === THE_UNDER_COURTS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === underCourtsInst)).toBe(true);
  });

  test('plan-movement offers moving on from The Under-galleries to The Sulfur-deeps', () => {
    const state = orgAt(THE_UNDER_GALLERIES, [THE_SULFUR_DEEPS]);
    const sulfurDeepsInst = state.players[0].siteDeck.find(s => s.definitionId === THE_SULFUR_DEEPS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === sulfurDeepsInst)).toBe(true);
  });

  test('plan-movement does NOT offer The Under-galleries from a non-adjacent Darkhaven (Geann a-Lisch)', () => {
    const state = orgAt(GEANN_A_LISCH, [THE_UNDER_GALLERIES]);
    const galleriesInst = state.players[0].siteDeck.find(s => s.definitionId === THE_UNDER_GALLERIES)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === galleriesInst)).toBe(false);
  });

  // ─── Automatic attack: Trolls — 4 strikes with 10 prowess (detainment) ─────

  test('minion company entering The Under-galleries faces the Trolls attack as detainment', () => {
    const state = buildMinionSitePhaseState({ site: THE_UNDER_GALLERIES, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.detainment).toBe(true);
  });

  test('the printed detainment marker is unconditional — the attack is detainment even against a hero defender', () => {
    // Against a hero (Wizard) defender §3.II.2.R1 cannot fire (it only covers
    // Ringwraith/Balrog defenders), so only the card-level combat-detainment
    // effect — the printed "(detainment)" marker — makes this true.
    const siteDef = pool[THE_UNDER_GALLERIES as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Wizard,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  test('baseline: the same dark-hold auto-attack WITHOUT the marker is NOT detainment vs a hero defender', () => {
    const detainment = isDetainmentAttack({
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Wizard,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  // ─── Item playability: minor only (Information + minor Items) ───────────────

  test('a minor item is playable at The Under-galleries but a major item is not', () => {
    const state = buildMinionSitePhaseState({
      site: THE_UNDER_GALLERIES,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
  });
});
