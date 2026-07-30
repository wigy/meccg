/**
 * @module tw-71.test
 *
 * Card test: Olog-hai (Trolls) (tw-71)
 * Type: hazard-creature
 * Race: trolls. Three strikes at prowess 10, body 5, 2 kill marshalling points.
 *
 * Card text:
 *   "Trolls. Three strikes."
 *
 * Olog-hai is a vanilla hazard creature — its entire text is captured by base
 * stats (race `trolls`, `strikes: 3`) with no special `effects`.
 *
 * Canonical playable cost (`data/cards.json`, TW-71): `{s}{d}{D}` — keyable as
 * a moving company passes through a Shadow-land [{s}] region OR a Dark-domain
 * [{d}] region, OR when it arrives at a Dark-hold [{D}] site. Encoded as a
 * single `keyedTo` entry `{ regionTypes: ['shadow','dark'], siteTypes:
 * ['dark-hold'] }` — the standard TW alternative region/site keying (mirrors
 * tw-4 `{d}{D}`, tw-1 `{b}{B}`). Distinct region types within one entry are
 * alternatives (`regionTypesMatch` is OR across types), and the site type is a
 * further alternative.
 *
 * Effects: 0 — no special rules. This test drives the engine to verify:
 *   - keying alternatives (shadow region, dark region, dark-hold site) and the
 *     rejection of a non-keyed path/site;
 *   - combat initiates with the printed 3 strikes / prowess 10 / body 5;
 *   - the defender may face the strikes;
 *   - a struck character is wounded (body check vs the character);
 *   - defeating the attack kills the Olog-hai, scoring its 2 kill MP.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState, makeBorderMHState,
  resolveChain,
  findCharInstanceId,
  handCardId, companyIdAt, dispatch, executeAction, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';

const OLOG_HAI = 'tw-71' as CardDefinitionId;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Two-company state: P1 (resource) defends, P2 (hazard) holds the Olog-hai. */
function twoCompanyState(defenders: CardDefinitionId[] = [ARAGORN]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: defenders }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [OLOG_HAI], siteDeck: [RIVENDELL] },
    ],
  });
}

/** Viable play-hazard actions for the Olog-hai against P1's company. */
function playableActions(state: GameState) {
  const ologId = handCardId(state, HAZARD_PLAYER);
  return viableActions(state, PLAYER_2, 'play-hazard')
    .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ologId && a.viable);
}

/** Play the Olog-hai keyed as given and resolve the chain into combat. */
function initiateCombat(
  mhState: MovementHazardPhaseState,
  keyedBy: { method: 'region-type' | 'site-type'; value: string },
  defenders: CardDefinitionId[] = [ARAGORN],
): GameState {
  const ready = { ...twoCompanyState(defenders), phaseState: mhState };
  const ologId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  const afterPlay = dispatch(ready, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: ologId,
    targetCompanyId: companyId,
    keyedBy: { method: keyedBy.method as 'region-type', value: keyedBy.value },
  });
  return resolveChain(afterPlay);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Olog-hai (Trolls) (tw-71)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: {s}{d}{D} alternatives ─────────────────────────────────────────

  test('playable keyed to a Shadow-land region [{s}] in the path', () => {
    // makeShadowMHState: a Shadow region (Imlad Morgul) to a Shadow-hold. The
    // Shadow-hold is not in siteTypes, so the match is the region.
    const ready = { ...twoCompanyState(), phaseState: makeShadowMHState() };
    const matched = playableActions(ready);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'region-type' && a.action.keyedBy.value === 'shadow')).toBe(true);
  });

  test('playable keyed to a Dark-domain region [{d}] in the path', () => {
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.RuinsAndLairs, // not a Dark-hold — the region keys it
      destinationSiteName: 'Moria',
    });
    const ready = { ...twoCompanyState(), phaseState: mhState };
    const matched = playableActions(ready);
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'region-type' && a.action.keyedBy.value === 'dark')).toBe(true);
  });

  test('playable at a Dark-hold site [{D}] by site type (path has no shadow/dark region)', () => {
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...twoCompanyState(), phaseState: mhState };
    const matched = playableActions(ready);
    expect(matched.length).toBeGreaterThan(0);
    // The wilderness region does not key trolls — only the Dark-hold destination does.
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'site-type' && a.action.keyedBy.value === SiteType.DarkHold)).toBe(true);
    expect(matched.every(a => a.action.type === 'play-hazard' && a.action.keyedBy?.method !== 'region-type')).toBe(true);
  });

  test('NOT playable on a non-keyed path/site (border region, border-hold, no {s}/{d}/{D})', () => {
    // makeBorderMHState: a Border region to a Border-hold — none of the three
    // keying alternatives are satisfied.
    const ready = { ...twoCompanyState(), phaseState: makeBorderMHState() };
    expect(playableActions(ready)).toHaveLength(0);
  });

  // ─── Combat: three strikes, prowess 10, body 5 ──────────────────────────────

  test('combat initiates with 3 strikes, prowess 10, body 5; defender assigns', () => {
    const afterChain = initiateCombat(
      makeShadowMHState(),
      { method: 'region-type', value: 'shadow' },
    );
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(10);
    expect(afterChain.combat!.creatureBody).toBe(5);
  });

  test('defender gets assign-strike actions against the Olog-hai', () => {
    const afterChain = initiateCombat(
      makeShadowMHState(),
      { method: 'region-type', value: 'shadow' },
    );
    const assignStrikes = computeLegalActions(afterChain, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'assign-strike');
    expect(assignStrikes.length).toBeGreaterThan(0);
  });

  // ─── Strike resolution ───────────────────────────────────────────────────────

  test('a struck character is wounded — body check is made against the character', () => {
    // Three characters so each of the 3 strikes is assigned to a distinct
    // defender (one normal assignment each → all strikes assigned).
    const afterChain = initiateCombat(
      makeShadowMHState(),
      { method: 'region-type', value: 'shadow' },
      [ARAGORN, GIMLI, LEGOLAS],
    );
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    // All 3 strikes assigned → the defender must choose resolution order.
    expect(s.combat!.phase).toBe('choose-strike-order');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    const targetId = s.combat!.strikeAssignments[s.combat!.currentStrikeIndex].characterId;

    // No tap: effective prowess (≤ 6) − 3, + roll 2 → total < prowess 10 →
    // the character is wounded → a body check is rolled against the character.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2, false);
    expect(s.combat!.bodyCheckTarget).toBe('character');

    // Body check 5 < the character's body (≥ 8) → survives, wounded (Inverted).
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);
    expect(s.players[RESOURCE_PLAYER].characters[targetId].status).toBe(CardStatus.Inverted);
  });

  test('defeating all three strikes kills the Olog-hai — 2 kill MP to the defender', () => {
    const afterChain = initiateCombat(
      makeShadowMHState(),
      { method: 'region-type', value: 'shadow' },
      [ARAGORN, GIMLI, LEGOLAS],
    );
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(afterChain, RESOURCE_PLAYER, GIMLI);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    // Resolve every strike: each character taps to fight (prowess 5–6 + roll 12
    // > prowess 10 → strike defeated) then the attacker rolls the creature body
    // check 6 > body 5 → the body check fails, so the strike stays defeated.
    let guard = 0;
    while (s.combat && guard++ < 20) {
      if (s.combat.phase === 'choose-strike-order') {
        s = executeAction(s, PLAYER_1, 'choose-strike-order');
      } else if (s.combat.phase === 'resolve-strike') {
        s = executeAction(s, PLAYER_1, 'resolve-strike', 12, true);
      } else if (s.combat.phase === 'body-check' && s.combat.bodyCheckTarget === 'creature') {
        // The creature belongs to the attacker, so the defender rolls (CoE 3.I.1).
        s = executeAction(s, PLAYER_1, 'body-check-roll', 6);
      } else {
        break;
      }
    }

    // All three strikes defeated → combat finalizes, the Olog-hai moves to the
    // defending hero's kill pile and scores its 2 kill marshalling points.
    expect(s.combat).toBeNull();
    const defender = s.players[RESOURCE_PLAYER];
    expect(defender.killPile.some(c => c.definitionId === OLOG_HAI)).toBe(true);
    expect(defender.marshallingPoints.kill).toBe(2);
  });
});
