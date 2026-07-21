/**
 * @module as-152.test
 *
 * Card test: The Iron-deeps (as-152)
 * Type: minion-site (dark-hold, under-deeps) in Angmar — the Ringwraith-player
 * twin of the Balrog version (ba-91), with different adjacency rolls, no
 * Special text, and a detainment automatic-attack.
 *
 * Text:
 *   Adjacent Sites: Carn Dûm (0), The Under-leas (5), The Under-vaults (6)
 *   Playable: Items (minor)
 *   Automatic-attacks: Trolls — 3 strikes with 10 prowess (detainment)
 *
 * Data encoding (filled/added this pass; the imported data dropped all three):
 *   - `keywords: ["under-deeps"]` — the site is an Under-deeps site (empty
 *     sitePath/nearestHaven, reachable only via Under-deeps movement).
 *   - `adjacentSites: { "Carn Dûm": 0, "The Under-leas": 5, "The Under-vaults": 6 }`
 *     from the printed Adjacent Sites line (cards.json authoritative; note the
 *     minion rolls 5/6 differ from the Balrog twin's 6/7).
 *   - `combat-detainment` (unfiltered) — the printed "(detainment)" marker on
 *     the automatic-attack, unconditional for any defender (as-139 Gobel
 *     Mírlond / as-141 Raider-hold / ba-102 The Under-leas precedent).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                      |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path          |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                          |
 * | 4 | region            | OK     | "Angmar"                                       |
 * | 5 | playableResources | OK     | [minor] — matches "Playable: Items (minor)"    |
 * | 6 | automaticAttacks  | OK     | Trolls, 3 strikes, 10 prowess                  |
 * | 7 | resourceDraws     | OK     | 1                                              |
 * | 8 | hazardDraws       | OK     | 1                                              |
 * | 9 | keywords          | OK     | ["under-deeps"] — added this pass              |
 * | 10| adjacentSites     | OK     | Carn Dûm (0), Under-leas (5), Under-vaults (6) — added this pass |
 * | 11| effects           | OK     | combat-detainment — added this pass            |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                       |
 * |---|------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED | select-company, enter-or-skip, play-resources|
 * | 2 | Item playability (minor only)            | IMPLEMENTED | site.ts enforces playableResources           |
 * | 3 | Under-deeps movement (adjacency + rolls) | IMPLEMENTED | organization-companies.ts / mh-steps.ts      |
 * | 4 | Automatic attack (Trolls 3x10)           | IMPLEMENTED | reducer-site.ts                              |
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

const THE_IRON_DEEPS = 'as-152' as CardDefinitionId;      // this card (minion under-deeps dark-hold)
const CARN_DUM = 'le-359' as CardDefinitionId;            // Darkhaven — the surface site (roll 0)
const THE_UNDER_LEAS = 'as-167' as CardDefinitionId;      // minion under-deeps shadow-hold (roll 5)
const THE_UNDER_VAULTS = 'as-168' as CardDefinitionId;    // minion under-deeps ruins-and-lairs (roll 6)
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
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [THE_MOUTH] }], hand: [], siteDeck: [] },
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

describe('The Iron-deeps (as-152)', () => {
  beforeEach(() => resetMint());

  // ─── Under-deeps adjacency and movement rolls ──────────────────────────────

  test('adjacent to its surface site Carn Dûm; descent and ascent both require roll 0', () => {
    const state = anyState();
    const ironDeeps = pool[THE_IRON_DEEPS as string] as SiteCard;
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, carnDum, ironDeeps)).toBe(true);
    // Descent (surface origin): always roll 0. Ascent: the printed Carn Dûm (0).
    expect(getUnderDeepsRequiredRoll(state, carnDum, ironDeeps)).toBe(0);
    expect(getUnderDeepsRequiredRoll(state, ironDeeps, carnDum)).toBe(0);
  });

  test('adjacent to The Under-leas at roll 5 and The Under-vaults at roll 6 (minion rolls, not the Balrog twin values)', () => {
    const state = anyState();
    const ironDeeps = pool[THE_IRON_DEEPS as string] as SiteCard;
    const underLeas = pool[THE_UNDER_LEAS as string] as SiteCard;
    const underVaults = pool[THE_UNDER_VAULTS as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, ironDeeps, underLeas)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, ironDeeps, underLeas)).toBe(5);
    expect(isUnderDeepsAdjacent(state, ironDeeps, underVaults)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, ironDeeps, underVaults)).toBe(6);
  });

  test('NOT adjacent to an unlisted surface site (Geann a-Lisch)', () => {
    const state = anyState();
    const ironDeeps = pool[THE_IRON_DEEPS as string] as SiteCard;
    const geann = pool[GEANN_A_LISCH as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, ironDeeps, geann)).toBe(false);
    expect(isUnderDeepsAdjacent(state, geann, ironDeeps)).toBe(false);
  });

  test('plan-movement offers descent from Carn Dûm to The Iron-deeps', () => {
    const state = orgAt(CARN_DUM, [THE_IRON_DEEPS]);
    const ironDeepsInst = state.players[0].siteDeck.find(s => s.definitionId === THE_IRON_DEEPS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === ironDeepsInst)).toBe(true);
  });

  test('plan-movement offers moving on from The Iron-deeps to The Under-leas', () => {
    const state = orgAt(THE_IRON_DEEPS, [THE_UNDER_LEAS]);
    const underLeasInst = state.players[0].siteDeck.find(s => s.definitionId === THE_UNDER_LEAS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === underLeasInst)).toBe(true);
  });

  test('plan-movement does NOT offer The Iron-deeps from a non-adjacent Darkhaven (Geann a-Lisch)', () => {
    // Under-deeps sites are excluded from regular starter/region movement, and
    // Geann a-Lisch is not in the adjacency list — so no route exists.
    const state = orgAt(GEANN_A_LISCH, [THE_IRON_DEEPS]);
    const ironDeepsInst = state.players[0].siteDeck.find(s => s.definitionId === THE_IRON_DEEPS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === ironDeepsInst)).toBe(false);
  });

  // ─── Automatic attack: Trolls — 3 strikes with 10 prowess (detainment) ─────

  test('minion company entering The Iron-deeps faces the Trolls attack as detainment', () => {
    const state = buildMinionSitePhaseState({ site: THE_IRON_DEEPS, characters: [{ defId: THE_MOUTH }] });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.detainment).toBe(true);
  });

  test('the printed detainment marker is unconditional — the attack is detainment even against a hero defender', () => {
    // Against a hero (Wizard) defender §3.II.2.R1 cannot fire (it only covers
    // Ringwraith/Balrog defenders), so only the card-level combat-detainment
    // effect — the printed "(detainment)" marker — makes this true.
    const siteDef = pool[THE_IRON_DEEPS as string] as SiteCard;
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

  test('a minor item is playable at The Iron-deeps but a major item is not', () => {
    const state = buildMinionSitePhaseState({
      site: THE_IRON_DEEPS,
      characters: [{ defId: THE_MOUTH }],
      hand: [SAW_TOOTHED_BLADE, HIGH_HELM],
    });

    const playable = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as { cardInstanceId?: string }).cardInstanceId);

    expect(playable).toContain(findHandCardId(state, RESOURCE_PLAYER, SAW_TOOTHED_BLADE));
    expect(playable).not.toContain(findHandCardId(state, RESOURCE_PLAYER, HIGH_HELM));
  });
});
