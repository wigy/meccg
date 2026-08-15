/**
 * @module wh-109.test
 *
 * Card test: Friend of Secret Things (wh-109)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), alignment
 * stage, unique. Radagast specific. Stage points 2.
 *
 * Printed text:
 *   "Unique. Radagast specific. Your companies with a company size of 2 or less
 *    may play allies at tapped sites."
 *
 * CERTIFIED. Every printed rule is exercised through the engine:
 *   1. `stage-points` (2) — contributes 2 stage points to the FW controller.
 *   2. Unique / Radagast specific: playable only while the player's revealed
 *      avatar is Radagast (`wizardSpecificName`), and not a second time while a
 *      copy is already in play.
 *   3. `grant-ally-play` (`maxCompanySize: 2`, `allowTappedSite: true`): a
 *      player-scoped, free-standing grant (unlike wh-62/wh-111 it carries no
 *      `filter` and is not restricted to Wizardhavens) that lifts the
 *      untapped-site requirement for ally plays by any company whose effective
 *      size (CoE 3.24) is at most 2 — at any site. It does NOT relax which
 *      allies are playable there: an ally must still match its own printed
 *      `playableAt` for the site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeSitePhase, setCompanySiteStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions,
  addCardInPlay, recomputeDerived, findHandCardId,
} from '../test-helpers.js';
import { Alignment, Phase, CardStatus, computeLegalActions, MORIA, RIVENDELL, OLD_FOREST } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHeroResourceAction } from '../../index.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const FRIEND_OF_SECRET_THINGS = 'wh-109' as CardDefinitionId; // the card under test (unique)
const RADAGAST = 'wh-8' as CardDefinitionId;                  // Fallen-wizard avatar (allowed)
const SARUMAN = 'wh-9' as CardDefinitionId;                   // FW avatar (NOT Radagast)
const BOROMIR = 'tw-134' as CardDefinitionId;                 // company-mate, extra untapped controller
const ARAGORN = 'tw-120' as CardDefinitionId;                 // third company member (company size 3)
const GOLDBERRY = 'tw-245' as CardDefinitionId;                // unique, 2 mind — playable at Old Forest
const NOBLE_STEED = 'wh-33' as CardDefinitionId;               // playable only in six named regions, never Old Forest

/** A Fallen-wizard site-phase state: Radagast + `extraCompanions` at `site`,
 *  with the given hand. */
function radagastSitePhase(opts: {
  site: CardDefinitionId;
  hand: CardDefinitionId[];
  extraCompanions?: CardDefinitionId[];
  inPlay?: boolean;
  tapped?: boolean;
}): GameState {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: opts.site, characters: [RADAGAST, BOROMIR, ...(opts.extraCompanions ?? [])] }],
        hand: opts.hand,
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  if (opts.inPlay) state = addCardInPlay(state, RESOURCE_PLAYER, FRIEND_OF_SECRET_THINGS);
  state = recomputeDerived(state);
  state = { ...state, phaseState: makeSitePhase() };
  if (opts.tapped) state = setCompanySiteStatus(state, RESOURCE_PLAYER, 0, CardStatus.Tapped);
  return state;
}

/** Instance IDs of every viable `play-hero-resource` action for a hand `defId`. */
function playInstIdsFor(state: GameState, defId: CardDefinitionId): CardInstanceId[] {
  const instIds = new Set(state.players[RESOURCE_PLAYER].hand.filter(c => c.definitionId === defId).map(c => c.instanceId as string));
  return viableActions(state, PLAYER_1, 'play-hero-resource')
    .map(ea => ea.action as PlayHeroResourceAction)
    .filter(a => instIds.has(a.cardInstanceId as string))
    .map(a => a.cardInstanceId);
}

describe('Friend of Secret Things (wh-109)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: stage points ─────────────────────────────────────────────────

  test('contributes 2 stage points to its Fallen-wizard controller', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: OLD_FOREST, characters: [RADAGAST] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, FRIEND_OF_SECRET_THINGS);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ─── Rule 2: unique / Radagast specific ─────────────────────────────────────

  test('playable from hand when the player is Radagast', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: OLD_FOREST, characters: [RADAGAST] }], hand: [FRIEND_OF_SECRET_THINGS], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const handId = findHandCardId(state, RESOURCE_PLAYER, FRIEND_OF_SECRET_THINGS);
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(1);
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: OLD_FOREST, characters: [SARUMAN] }], hand: [FRIEND_OF_SECRET_THINGS], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const handId = findHandCardId(state, RESOURCE_PLAYER, FRIEND_OF_SECRET_THINGS);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId)).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('Radagast-specific');
  });

  test('a second copy cannot be played while one is already in play (unique)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: OLD_FOREST, characters: [RADAGAST] }], hand: [FRIEND_OF_SECRET_THINGS], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, FRIEND_OF_SECRET_THINGS);
    state = recomputeDerived(state);

    const handId = findHandCardId(state, RESOURCE_PLAYER, FRIEND_OF_SECRET_THINGS);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId)).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('unique');
  });

  // ─── Rule 3: companies of size ≤ 2 may play allies at tapped sites ──────────

  test('baseline: Goldberry is NOT playable at a TAPPED Old Forest without the card in play', () => {
    const state = radagastSitePhase({ site: OLD_FOREST, hand: [GOLDBERRY], inPlay: false, tapped: true });
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(playInstIdsFor(state, GOLDBERRY)).toHaveLength(0);
  });

  test('baseline: Goldberry IS playable at an UNTAPPED Old Forest without the card in play', () => {
    const state = radagastSitePhase({ site: OLD_FOREST, hand: [GOLDBERRY], inPlay: false, tapped: false });
    expect(playInstIdsFor(state, GOLDBERRY).length).toBeGreaterThanOrEqual(1);
  });

  test('with the card in play, Goldberry (company size 2) becomes playable at a TAPPED Old Forest', () => {
    const state = radagastSitePhase({ site: OLD_FOREST, hand: [GOLDBERRY], inPlay: true, tapped: true });
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(playInstIdsFor(state, GOLDBERRY).length).toBeGreaterThanOrEqual(1);
  });

  test('the grant is not filtered by uniqueness or mind (Goldberry is unique, 2 mind)', () => {
    // Contrast with wh-62/wh-111, whose grants exclude unique/non-1-mind allies.
    const state = radagastSitePhase({ site: OLD_FOREST, hand: [GOLDBERRY], inPlay: true, tapped: true });
    expect(playInstIdsFor(state, GOLDBERRY).length).toBeGreaterThanOrEqual(1);
  });

  test('the grant does NOT apply once company size exceeds 2', () => {
    const state = radagastSitePhase({ site: OLD_FOREST, hand: [GOLDBERRY], extraCompanions: [ARAGORN], inPlay: true, tapped: true });
    expect(state.players[RESOURCE_PLAYER].companies[0].characters).toHaveLength(3);
    expect(playInstIdsFor(state, GOLDBERRY)).toHaveLength(0);
  });

  test('the grant does NOT relax which allies are playable at the site: Noble Steed (never playable at Old Forest) stays unplayable even tapped', () => {
    const state = radagastSitePhase({ site: OLD_FOREST, hand: [NOBLE_STEED], inPlay: true, tapped: true });
    expect(playInstIdsFor(state, NOBLE_STEED)).toHaveLength(0);
  });
});
