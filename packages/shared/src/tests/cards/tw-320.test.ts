/**
 * @module tw-320 — Roäc the Raven
 *
 * Card shape (documented here, not asserted against the JSON):
 *   - `hero-resource-ally`, unique, prowess -3 / body 8 / mind 1, skills
 *     Diplomat, MP 1 (ally category). `playableAt: [{ region: "Northern
 *     Rhovanion" }]`.
 *   - effects: one `grant-action` (`action: "roac-faction-influence"`,
 *     `activeSitePhase: true`, `cost: { tap: "self", discard: "self" }`,
 *     `targets: { scope: "own-hand-factions" }`,
 *     `apply: { type: "faction-influence-untethered" }`).
 *
 * Text: "Unique. Playable at any site in Northern Rhovanion. During the site
 * phase you can tap and discard Roäc the Raven to attempt to bring any
 * faction into play — treat this influence check as if it was made by a
 * diplomat at any site where the faction could be played. Using Roäc the
 * Raven to make an influence attempt does not tap a site, and may be done if
 * his company is at a tapped site."
 *
 * All tests drive the reducer / legal-action pipeline; none assert JSON shape.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, CardStatus,
  PLAYER_1, RESOURCE_PLAYER,
  buildSitePhaseState,
  attachAllyToChar, findCharInstanceId, findHandCardId,
  viableActions, viableActionsForHandCard, dispatch,
  ARAGORN, MORIA,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const ROAC = 'tw-320' as CardDefinitionId;
const LAKE_TOWN = 'tw-406' as CardDefinitionId; // hero border-hold, region Northern Rhovanion
const MEN_OF_NORTHERN_RHOVANION = 'tw-281' as CardDefinitionId; // hero faction, influence # 7, playable only at Lake-town

/** Instance id of the (single) Roäc ally borne by Aragorn. */
function roacOn(state: GameState): CardInstanceId {
  const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
  const ally = state.players[RESOURCE_PLAYER].characters[aragornId]?.allies
    .find(a => a.definitionId === ROAC);
  if (!ally) throw new Error('Roäc not attached to Aragorn');
  return ally.instanceId;
}

describe('Roäc the Raven (tw-320)', () => {
  beforeEach(() => resetMint());

  // ─── Playable at any site in Northern Rhovanion ─────────────────────────────

  test('playable at a site in Northern Rhovanion', () => {
    const state = buildSitePhaseState({ site: LAKE_TOWN, hand: [ROAC] });
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ROAC);
    expect(plays).toHaveLength(1);
  });

  test('not playable at a site outside Northern Rhovanion', () => {
    const state = buildSitePhaseState({ site: MORIA, hand: [ROAC] });
    const plays = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ROAC);
    expect(plays).toHaveLength(0);
  });

  // ─── Tap and discard to attempt bringing any faction into play ──────────────

  test('offers one activation per faction in hand, even at a site the faction is not playable at', () => {
    const base: GameState = buildSitePhaseState({ site: MORIA, hand: [MEN_OF_NORTHERN_RHOVANION] });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, ROAC);
    const roacId = roacOn(state);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, MEN_OF_NORTHERN_RHOVANION);

    const activations = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as { actionId: string; sourceCardId: CardInstanceId; targetCardId?: CardInstanceId })
      .filter(a => a.actionId === 'roac-faction-influence');

    expect(activations).toHaveLength(1);
    expect(activations[0].sourceCardId).toBe(roacId);
    expect(activations[0].targetCardId).toBe(factionId);
  });

  test('usable even while the company is at a tapped site', () => {
    const base: GameState = buildSitePhaseState({ site: MORIA, hand: [MEN_OF_NORTHERN_RHOVANION], siteStatus: CardStatus.Tapped });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, ROAC);
    const activations = viableActions(state, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as { actionId: string }).actionId === 'roac-faction-influence');
    expect(activations).toHaveLength(1);
  });

  test('a successful attempt brings the faction into play and discards Roäc, without tapping the site', () => {
    const base: GameState = buildSitePhaseState({ site: MORIA, hand: [MEN_OF_NORTHERN_RHOVANION] });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, ROAC);
    const roacId = roacOn(state);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const activation = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action)
      .find(a => (a as { actionId: string }).actionId === 'roac-faction-influence')!;

    // influence # 7; roll forced to 12 ⇒ 12 + 0 DI ≥ 7 ⇒ succeeds.
    const after = dispatch({ ...state, cheatRollTotal: 12 }, activation);

    // Faction now in play, no longer in hand.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(false);
    const faction = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)!;
    expect(faction.status).toBe(CardStatus.Untapped);

    // Roäc is discarded (tapped-and-discarded cost), not merely tapped.
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.allies.some(a => a.instanceId === roacId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === roacId)).toBe(true);

    // Site never tapped by this resource, and the normal minor-item window
    // that a site-tapping resource opens stays closed.
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
    const sp = after.phaseState as { resourcePlayed?: boolean; minorItemAvailable?: boolean };
    expect(sp.resourcePlayed).toBe(false);
    expect(sp.minorItemAvailable).toBe(false);
  });

  test('a failed attempt discards the faction and still discards Roäc, without tapping the site', () => {
    const base: GameState = buildSitePhaseState({ site: MORIA, hand: [MEN_OF_NORTHERN_RHOVANION] });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, ROAC);
    const roacId = roacOn(state);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const activation = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action)
      .find(a => (a as { actionId: string }).actionId === 'roac-faction-influence')!;

    // influence # 7; roll forced to 2 ⇒ 2 + 0 DI < 7 ⇒ fails.
    const after = dispatch({ ...state, cheatRollTotal: 2 }, activation);

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_NORTHERN_RHOVANION)).toBe(true);

    // Roäc is still discarded — the cost is paid to attempt, win or lose.
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.allies.some(a => a.instanceId === roacId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === roacId)).toBe(true);

    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  test('not offered once Roäc has already been discarded', () => {
    const base: GameState = buildSitePhaseState({ site: MORIA, hand: [MEN_OF_NORTHERN_RHOVANION] });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, ROAC);
    const activation = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action)
      .find(a => (a as { actionId: string }).actionId === 'roac-faction-influence')!;
    const after = dispatch({ ...state, cheatRollTotal: 2 }, activation);

    const again = viableActions(after, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as { actionId: string }).actionId === 'roac-faction-influence');
    expect(again).toHaveLength(0);
  });
});
