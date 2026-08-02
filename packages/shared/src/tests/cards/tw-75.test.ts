/**
 * @module tw-75.test
 *
 * Card test: Orc-raiders (tw-75)
 * Type: hazard-creature
 * Race: orcs. Four strikes at prowess 6, no body, 1 kill marshalling point.
 *
 * Card text:
 *   "Orcs. Four strikes."
 *
 * Orc-raiders is a vanilla hazard creature — its entire text is captured by
 * base stats (race `orc`, `strikes: 4`) with no special `effects`.
 *
 * Canonical playable cost (`data/cards.json`, TW-75): `{b}{w}{R}` — keyable as
 * a moving company passes through a Border-land [{b}] region OR a Wilderness
 * [{w}] region, OR when it arrives at a Ruins & Lairs [{R}] site. Encoded as a
 * single `keyedTo` entry `{ regionTypes: ['wilderness','border'], siteTypes:
 * ['ruins-and-lairs'] }` — the standard TW alternative region/site keying
 * (mirrors tw-71 `{s}{d}{D}`, tw-074 with the same `{b}{w}{R}` cost). Distinct
 * region types within one entry are alternatives (`regionTypesMatch` is OR
 * across types), and the site type is a further alternative.
 *
 * Effects: 0 — no special rules. This test drives the engine to verify:
 *   - keying alternatives (wilderness region, border region, ruins-and-lairs
 *     site) and the rejection of a non-keyed path/site;
 *   - combat initiates with the printed 4 strikes / prowess 6 / no body;
 *   - the defender may face the strikes;
 *   - a struck character is wounded (body check vs the character);
 *   - defeating all four strikes kills the Orc-raiders with no creature body
 *     check (printed body "-"), scoring its 1 kill MP.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, LEGOLAS, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState, makeBorderMHState, makeShadowMHState,
  resolveChain,
  findCharInstanceId,
  handCardId, companyIdAt, dispatch, executeAction, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';

const ORC_RAIDERS = 'tw-75' as CardDefinitionId;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Two-company state: P1 (resource) defends, P2 (hazard) holds the Orc-raiders. */
function twoCompanyState(defenders: CardDefinitionId[] = [ARAGORN]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: defenders }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_RAIDERS], siteDeck: [RIVENDELL] },
    ],
  });
}

/** Viable play-hazard actions for the Orc-raiders against P1's company. */
function playableActions(state: GameState) {
  const raidersId = handCardId(state, HAZARD_PLAYER);
  return viableActions(state, PLAYER_2, 'play-hazard')
    .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === raidersId && a.viable);
}

/** Play the Orc-raiders keyed as given and resolve the chain into combat. */
function initiateCombat(
  mhState: MovementHazardPhaseState,
  keyedBy: { method: 'region-type' | 'site-type'; value: string },
  defenders: CardDefinitionId[] = [ARAGORN],
): GameState {
  const ready = { ...twoCompanyState(defenders), phaseState: mhState };
  const raidersId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  const afterPlay = dispatch(ready, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: raidersId,
    targetCompanyId: companyId,
    keyedBy: { method: keyedBy.method as 'region-type', value: keyedBy.value },
  });
  return resolveChain(afterPlay);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Orc-raiders (tw-75)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: {b}{w}{R} alternatives ─────────────────────────────────────────

  test('playable keyed to a Wilderness region [{w}] in the path', () => {
    // makeWildernessMHState: a Wilderness region (Rhudaur) to Ruins & Lairs
    // Moria — both the region and the site alternatives match here.
    const ready = { ...twoCompanyState(), phaseState: makeWildernessMHState() };
    const matched = playableActions(ready);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'region-type' && a.action.keyedBy.value === 'wilderness')).toBe(true);
  });

  test('playable keyed to a Border-land region [{b}] in the path', () => {
    // makeBorderMHState: a Border region (Andrast) to a Border-hold. The
    // Border-hold is not in siteTypes, so the match is the region alone.
    const ready = { ...twoCompanyState(), phaseState: makeBorderMHState() };
    const matched = playableActions(ready);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'region-type' && a.action.keyedBy.value === 'border')).toBe(true);
  });

  test('playable at a Ruins & Lairs site [{R}] by site type (path has no wilderness/border region)', () => {
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...twoCompanyState(), phaseState: mhState };
    const matched = playableActions(ready);
    expect(matched.length).toBeGreaterThan(0);
    // The free-domain region does not key Orcs — only the Ruins & Lairs destination does.
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'site-type' && a.action.keyedBy.value === SiteType.RuinsAndLairs)).toBe(true);
    expect(matched.every(a => a.action.type === 'play-hazard' && a.action.keyedBy?.method !== 'region-type')).toBe(true);
  });

  test('NOT playable on a non-keyed path/site (shadow region, shadow-hold, no {b}/{w}/{R})', () => {
    // makeShadowMHState: a Shadow region to a Shadow-hold — none of the three
    // keying alternatives are satisfied.
    const ready = { ...twoCompanyState(), phaseState: makeShadowMHState() };
    expect(playableActions(ready)).toHaveLength(0);
  });

  // ─── Combat: four strikes, prowess 6, no body ───────────────────────────────

  test('combat initiates with 4 strikes, prowess 6, no creature body; defender assigns', () => {
    const afterChain = initiateCombat(
      makeWildernessMHState(),
      { method: 'region-type', value: 'wilderness' },
    );
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(4);
    expect(afterChain.combat!.strikeProwess).toBe(6);
    expect(afterChain.combat!.creatureBody).toBeNull();
  });

  test('defender gets assign-strike actions against the Orc-raiders', () => {
    const afterChain = initiateCombat(
      makeWildernessMHState(),
      { method: 'region-type', value: 'wilderness' },
    );
    const assignStrikes = computeLegalActions(afterChain, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'assign-strike');
    expect(assignStrikes.length).toBeGreaterThan(0);
  });

  // ─── Strike resolution ───────────────────────────────────────────────────────

  test('a struck character is wounded — body check is made against the character', () => {
    // Four characters so each of the 4 strikes is assigned to a distinct
    // defender (one normal assignment each → all strikes assigned).
    const afterChain = initiateCombat(
      makeWildernessMHState(),
      { method: 'region-type', value: 'wilderness' },
      [ARAGORN, GIMLI, LEGOLAS, FARAMIR],
    );
    let s = afterChain;
    for (const def of [ARAGORN, GIMLI, LEGOLAS, FARAMIR]) {
      const charId = findCharInstanceId(s, RESOURCE_PLAYER, def);
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: charId });
    }

    // All 4 strikes assigned → the defender must choose resolution order.
    expect(s.combat!.phase).toBe('choose-strike-order');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    const targetId = s.combat!.strikeAssignments[s.combat!.currentStrikeIndex].characterId;

    // No tap: effective prowess (≤ 6) − 3, + roll 2 → total < prowess 6 →
    // the character is wounded → a body check is rolled against the character.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2, false);
    expect(s.combat!.bodyCheckTarget).toBe('character');

    // Body check 5 < the character's body (≥ 8) → survives, wounded (Inverted).
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);
    expect(s.players[RESOURCE_PLAYER].characters[targetId].status).toBe(CardStatus.Inverted);
  });

  test('defeating all four strikes kills the Orc-raiders — no creature body check, 1 kill MP', () => {
    const afterChain = initiateCombat(
      makeWildernessMHState(),
      { method: 'region-type', value: 'wilderness' },
      [ARAGORN, GIMLI, LEGOLAS, FARAMIR],
    );
    let s = afterChain;
    for (const def of [ARAGORN, GIMLI, LEGOLAS, FARAMIR]) {
      const charId = findCharInstanceId(s, RESOURCE_PLAYER, def);
      s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: charId });
    }

    // Resolve every strike: each character taps to fight (prowess 5–6 + roll 12
    // > prowess 6 → strike defeated). The Orc-raiders has no body ("-"), so no
    // creature body check follows a defeated strike — the strike stays defeated.
    let guard = 0;
    while (s.combat && guard++ < 20) {
      if (s.combat.phase === 'choose-strike-order') {
        s = executeAction(s, PLAYER_1, 'choose-strike-order');
      } else if (s.combat.phase === 'resolve-strike') {
        s = executeAction(s, PLAYER_1, 'resolve-strike', 12, true);
      } else {
        break;
      }
    }

    // All four strikes defeated → combat finalizes, the Orc-raiders moves to
    // the defending hero's kill pile and scores its 1 kill marshalling point.
    expect(s.combat).toBeNull();
    const defender = s.players[RESOURCE_PLAYER];
    expect(defender.killPile.some(c => c.definitionId === ORC_RAIDERS)).toBe(true);
    expect(defender.marshallingPoints.kill).toBe(1);
  });
});
