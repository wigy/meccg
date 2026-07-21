/**
 * @module as-161.test
 *
 * Card test: The Sulfur-deeps (as-161)
 * Type: minion-site (dark-hold, under-deeps) in Southern Mirkwood — the
 * Ringwraith-player twin of the Balrog version (ba-97), but printed with a
 * simpler text: no dynamic second automatic-attack and no "attacks normally"
 * Special, just a single detainment automatic-attack.
 *
 * Text:
 *   Adjacent Sites: Dol Guldur (0), The Under-courts (4), The Pûkel-deeps (9),
 *                   The Under-gates (4), The Under-galleries (7)
 *   Playable: Items (minor)
 *   Automatic-attacks: Trolls — 2 strikes with 10 prowess (detainment)
 *
 * Data encoding (filled/added this pass; the imported data dropped all three):
 *   - `keywords: ["under-deeps"]` — the site is an Under-deeps site (empty
 *     sitePath/nearestHaven, reachable only via Under-deeps movement).
 *   - `adjacentSites` from the printed Adjacent Sites line (cards.json
 *     authoritative): Dol Guldur (0), The Under-courts (4), The Pûkel-deeps (9),
 *     The Under-gates (4), The Under-galleries (7).
 *   - `combat-detainment` (unfiltered) — the printed "(detainment)" marker on
 *     the automatic-attack, unconditional for any defender (as-152 The
 *     Iron-deeps precedent).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                      |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path          |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                          |
 * | 4 | region            | OK     | "Southern Mirkwood"                            |
 * | 5 | playableResources | OK     | [minor] — matches "Playable: Items (minor)"    |
 * | 6 | automaticAttacks  | OK     | Trolls, 2 strikes, 10 prowess                  |
 * | 7 | resourceDraws     | OK     | 1                                              |
 * | 8 | hazardDraws       | OK     | 1                                              |
 * | 9 | keywords          | OK     | ["under-deeps"] — added this pass              |
 * | 10| adjacentSites     | OK     | 5 entries — added this pass                     |
 * | 11| effects           | OK     | combat-detainment — added this pass            |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                       |
 * |---|------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED | select-company, enter-or-skip, play-resources|
 * | 2 | Item playability (minor only)            | IMPLEMENTED | site.ts enforces playableResources           |
 * | 3 | Under-deeps movement (adjacency + rolls) | IMPLEMENTED | organization-companies.ts / mh-steps.ts      |
 * | 4 | Automatic attack (Trolls 2x10)           | IMPLEMENTED | reducer-site.ts                              |
 * | 5 | Detainment marker on the auto-attack     | IMPLEMENTED | combat-detainment via isDetainmentAttack     |
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
import { isUnderDeepsAdjacent } from '../../engine/legal-actions/organization-companies.js';
import { getUnderDeepsRequiredRoll } from '../../engine/mh-steps.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type { CardDefinitionId, GameState, SiteCard, PlanMovementAction } from '../../index.js';

const THE_SULFUR_DEEPS = 'as-161' as CardDefinitionId;    // this card (minion under-deeps dark-hold)
const DOL_GULDUR = 'le-367' as CardDefinitionId;          // Darkhaven — the surface site (roll 0)
const THE_UNDER_COURTS = 'as-163' as CardDefinitionId;    // minion under-deeps dark-hold (roll 4)
const THE_UNDER_GATES = 'as-165' as CardDefinitionId;     // minion under-deeps shadow-hold (roll 4)
const THE_UNDER_GALLERIES = 'as-164' as CardDefinitionId; // minion under-deeps dark-hold (roll 7)
const GEANN_A_LISCH = 'le-374' as CardDefinitionId;       // Darkhaven, NOT adjacent (negative case)

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

describe('The Sulfur-deeps (as-161)', () => {
  beforeEach(() => resetMint());

  // ─── Under-deeps adjacency and movement rolls ──────────────────────────────

  test('adjacent to its surface site Dol Guldur; descent and ascent both require roll 0', () => {
    const state = anyState();
    const sulfurDeeps = pool[THE_SULFUR_DEEPS as string] as SiteCard;
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, dolGuldur, sulfurDeeps)).toBe(true);
    // Descent (surface origin): always roll 0. Ascent: the printed Dol Guldur (0).
    expect(getUnderDeepsRequiredRoll(state, dolGuldur, sulfurDeeps)).toBe(0);
    expect(getUnderDeepsRequiredRoll(state, sulfurDeeps, dolGuldur)).toBe(0);
  });

  test('adjacent to The Under-courts/Under-gates at roll 4, The Under-galleries at roll 7 (minion rolls, not the Balrog twin values)', () => {
    const state = anyState();
    const sulfurDeeps = pool[THE_SULFUR_DEEPS as string] as SiteCard;
    const underCourts = pool[THE_UNDER_COURTS as string] as SiteCard;
    const underGates = pool[THE_UNDER_GATES as string] as SiteCard;
    const underGalleries = pool[THE_UNDER_GALLERIES as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, sulfurDeeps, underCourts)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, sulfurDeeps, underCourts)).toBe(4);
    expect(isUnderDeepsAdjacent(state, sulfurDeeps, underGates)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, sulfurDeeps, underGates)).toBe(4);
    expect(isUnderDeepsAdjacent(state, sulfurDeeps, underGalleries)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, sulfurDeeps, underGalleries)).toBe(7);
  });

  test('NOT adjacent to an unlisted Darkhaven (Geann a-Lisch)', () => {
    const state = anyState();
    const sulfurDeeps = pool[THE_SULFUR_DEEPS as string] as SiteCard;
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, sulfurDeeps, geann)).toBe(false);
    expect(isUnderDeepsAdjacent(state, geann, sulfurDeeps)).toBe(false);
  });

  test('plan-movement offers descent from Dol Guldur to The Sulfur-deeps', () => {
    const state = orgAt(DOL_GULDUR, [THE_SULFUR_DEEPS]);
    const sulfurDeepsInst = state.players[0].siteDeck.find(s => s.definitionId === THE_SULFUR_DEEPS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === sulfurDeepsInst)).toBe(true);
  });

  test('plan-movement offers moving on from The Sulfur-deeps to The Under-gates', () => {
    const state = orgAt(THE_SULFUR_DEEPS, [THE_UNDER_GATES]);
    const underGatesInst = state.players[0].siteDeck.find(s => s.definitionId === THE_UNDER_GATES)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === underGatesInst)).toBe(true);
  });

  test('plan-movement does NOT offer The Sulfur-deeps from a non-adjacent Darkhaven (Geann a-Lisch)', () => {
    // Under-deeps sites are excluded from regular starter/region movement, and
    // Geann a-Lisch is not in the adjacency list — so no route exists.
    const state = orgAt(GEANN_A_LISCH, [THE_SULFUR_DEEPS]);
    const sulfurDeepsInst = state.players[0].siteDeck.find(s => s.definitionId === THE_SULFUR_DEEPS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === sulfurDeepsInst)).toBe(false);
  });

  // ─── Automatic attack: Trolls — 2 strikes with 10 prowess (detainment) ─────

  test('minion company entering The Sulfur-deeps faces the Trolls attack as detainment', () => {
    const state = buildMinionSitePhaseState({ site: THE_SULFUR_DEEPS, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.detainment).toBe(true);
  });

  test('the printed detainment marker is unconditional — the attack is detainment even against a hero defender', () => {
    // Against a hero (Wizard) defender §3.II.2.R1 cannot fire (it only covers
    // Ringwraith/Balrog defenders), so only the card-level combat-detainment
    // effect — the printed "(detainment)" marker — makes this true.
    const siteDef = pool[THE_SULFUR_DEEPS as string] as SiteCard;
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

  // ─── Item playability: minor only ──────────────────────────────────────────

  test('a minor item is playable at The Sulfur-deeps but a major item is not', () => {
    const state = buildMinionSitePhaseState({
      site: THE_SULFUR_DEEPS,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
  });
});
