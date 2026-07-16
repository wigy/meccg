/**
 * @module wh-62.test
 *
 * Card test: An Untimely Brood (wh-62)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event), non-unique.
 *
 * Printed text:
 *   "Playable if you are Radagast or Alatar and have 6 or more stage points and
 *    a protected Wizardhaven [{H}]. One non-unique ally with a mind of 1 is
 *    playable at one of your tapped or untapped protected Wizardhavens [{H}]
 *    each of your site phases. Cannot be duplicated by a given player."
 *
 * CERTIFIED. Every printed rule is exercised through the engine:
 *   1. `stage-points` (4) — contributes 4 stage points to the FW controller.
 *   2. `play-condition` (player-state): playable only if the player counts as
 *      Radagast or Alatar, has ≥6 stage points, and controls a protected
 *      Wizardhaven.
 *   3. `grant-ally-play` (`atProtectedWizardhavens`, `allowTappedSite`): a
 *      non-unique 1-mind ally becomes playable at one of the player's own
 *      protected Wizardhavens — tapped or untapped — bypassing the ally's
 *      printed `playableAt`. The grant's `filter` excludes unique / non-1-mind
 *      allies, and does not fire at an unprotected site or a non-Wizardhaven.
 *   4. `grant-ally-play` `oncePerSitePhase`: only one such ally may be played
 *      through the grant each site phase (a turn-scoped lock is recorded on the
 *      granting card).
 *   5. `duplication-limit` (scope `player`) — "Cannot be duplicated by a given
 *      player" (a second copy in hand is not playable).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeSitePhase, setCompanySiteStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, dispatch,
  addCardInPlay, recomputeDerived, getCharacter,
  findCharInstanceId,
} from '../test-helpers.js';
import {
  Alignment, Phase, CardStatus, computeLegalActions, RIVENDELL, MORIA,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHeroResourceAction } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

// ─── Local card-ID constants (single-use — not promoted to card-ids.ts) ─────
const UNTIMELY_BROOD = 'wh-62' as CardDefinitionId; // the card under test (non-unique)
const RADAGAST = 'wh-8' as CardDefinitionId;         // Fallen-wizard avatar (allowed)
const SARUMAN = 'wh-9' as CardDefinitionId;          // FW avatar (NOT Radagast/Alatar)
const BOROMIR = 'tw-134' as CardDefinitionId;        // extra untapped controller
const ISENGARD_FW = 'wh-56' as CardDefinitionId;     // a Fallen-wizard Wizardhaven (haven)
const STRIDENT_SPAWN = 'wh-61' as CardDefinitionId;  // stage-points 4 (a different stage card)
const FORTRESS_OF_ISEN = 'wh-68' as CardDefinitionId; // stage-points 3
const NOBLE_STEED = 'wh-33' as CardDefinitionId;     // non-unique, 1 mind (region-gated, never a haven)
const GOLDBERRY = 'tw-245' as CardDefinitionId;      // unique, 2 mind — filter negative

/** Add a player-owned `site-protected` constraint to a Wizardhaven, as The
 *  Fortress of Isen (wh-68) would. */
function protectSite(state: GameState, siteDefId: CardDefinitionId): GameState {
  return addConstraint(state, {
    source: 'protector-1' as CardInstanceId,
    sourceDefinitionId: FORTRESS_OF_ISEN,
    scope: { kind: 'until-cleared' },
    target: { kind: 'player', playerId: PLAYER_1 },
    kind: { type: 'site-flag', flag: 'site-protected', siteDefinitionId: siteDefId },
  });
}

/** A Fallen-wizard site-phase state: Radagast + Boromir at `site`, with the
 *  given hand, An Untimely Brood in play, and (optionally) the site protected
 *  and/or tapped. */
function broodSitePhase(opts: {
  site: CardDefinitionId;
  hand: CardDefinitionId[];
  protect?: boolean;
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
        companies: [{ site: opts.site, characters: [RADAGAST, BOROMIR] }],
        hand: opts.hand,
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
  if (opts.protect) state = protectSite(state, opts.site);
  state = recomputeDerived(state);
  state = { ...state, phaseState: makeSitePhase() };
  if (opts.tapped) state = setCompanySiteStatus(state, RESOURCE_PLAYER, 0, CardStatus.Tapped);
  return state;
}

/** Instance IDs of every viable `play-hero-resource` action for a hand `defId`. */
function grantedPlayInstIds(state: GameState, defId: CardDefinitionId): CardInstanceId[] {
  const instIds = new Set(state.players[RESOURCE_PLAYER].hand.filter(c => c.definitionId === defId).map(c => c.instanceId as string));
  return viableActions(state, PLAYER_1, 'play-hero-resource')
    .map(ea => ea.action as PlayHeroResourceAction)
    .filter(a => instIds.has(a.cardInstanceId as string))
    .map(a => a.cardInstanceId);
}

describe('An Untimely Brood (wh-62)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: stage points ─────────────────────────────────────────────────

  test('contributes 4 stage points to its Fallen-wizard controller', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [RADAGAST] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });

  // ─── Rule 2: play-condition ────────────────────────────────────────────────

  test('playable from hand when you are Radagast, have ≥6 stage points, and control a protected Wizardhaven', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [RADAGAST] }],
          hand: [UNTIMELY_BROOD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // 4 + 3 = 7 stage points, from two stage cards that are NOT An Untimely Brood.
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = addCardInPlay(state, RESOURCE_PLAYER, FORTRESS_OF_ISEN);
    state = protectSite(state, ISENGARD_FW);
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(7);

    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(1);
  });

  test('not playable without a protected Wizardhaven, even with the right avatar and stage points', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [RADAGAST] }],
          hand: [UNTIMELY_BROOD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = addCardInPlay(state, RESOURCE_PLAYER, FORTRESS_OF_ISEN);
    state = recomputeDerived(state); // 7 stage points, but no protected Wizardhaven

    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId)).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('play condition');
  });

  test('not playable when the player counts as a Fallen-wizard other than Radagast/Alatar (Saruman)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN] }],
          hand: [UNTIMELY_BROOD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = addCardInPlay(state, RESOURCE_PLAYER, FORTRESS_OF_ISEN);
    state = protectSite(state, ISENGARD_FW);
    state = recomputeDerived(state);

    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId)).toHaveLength(0);
  });

  // ─── Rule 3: grant a non-unique 1-mind ally at a protected Wizardhaven ──────

  test('baseline: Noble Steed is NOT playable at a Wizardhaven without An Untimely Brood', () => {
    // Same fixture minus the permanent-event: build directly.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [RADAGAST, BOROMIR] }],
          hand: [NOBLE_STEED],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    state = protectSite(state, ISENGARD_FW);
    state = recomputeDerived(state);
    state = { ...state, phaseState: makeSitePhase() };
    expect(grantedPlayInstIds(state, NOBLE_STEED)).toHaveLength(0);
  });

  test('with An Untimely Brood, Noble Steed is playable at an untapped protected Wizardhaven', () => {
    const state = broodSitePhase({ site: ISENGARD_FW, hand: [NOBLE_STEED], protect: true });
    expect(grantedPlayInstIds(state, NOBLE_STEED).length).toBeGreaterThanOrEqual(1);
  });

  test('the grant also applies at a TAPPED protected Wizardhaven (tapped or untapped)', () => {
    const state = broodSitePhase({ site: ISENGARD_FW, hand: [NOBLE_STEED], protect: true, tapped: true });
    expect(state.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(grantedPlayInstIds(state, NOBLE_STEED).length).toBeGreaterThanOrEqual(1);
  });

  test('the grant does NOT apply at an unprotected Wizardhaven', () => {
    const state = broodSitePhase({ site: ISENGARD_FW, hand: [NOBLE_STEED], protect: false });
    expect(grantedPlayInstIds(state, NOBLE_STEED)).toHaveLength(0);
  });

  test('the grant does NOT apply at a protected NON-Wizardhaven site (Moria)', () => {
    const state = broodSitePhase({ site: MORIA, hand: [NOBLE_STEED], protect: true });
    expect(grantedPlayInstIds(state, NOBLE_STEED)).toHaveLength(0);
  });

  test('the grant does not extend to a unique / non-1-mind ally (Goldberry)', () => {
    const state = broodSitePhase({ site: ISENGARD_FW, hand: [GOLDBERRY], protect: true });
    expect(grantedPlayInstIds(state, GOLDBERRY)).toHaveLength(0);
  });

  // ─── Rule 4: only one such ally per site phase ─────────────────────────────

  test('playing the granted ally attaches it, taps the site, and blocks a second grant-play this phase', () => {
    const state = broodSitePhase({ site: ISENGARD_FW, hand: [NOBLE_STEED, NOBLE_STEED], protect: true });

    // Both copies are offered up front (two distinct hand instances).
    expect(new Set(grantedPlayInstIds(state, NOBLE_STEED)).size).toBe(2);

    // Play the first copy under Radagast.
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const firstInst = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === NOBLE_STEED)!.instanceId;
    const playAction = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(ea => ea.action as PlayHeroResourceAction)
      .find(a => a.cardInstanceId === firstInst && a.attachToCharacterId === radagastId)!;
    expect(playAction).toBeDefined();
    expect(playAction.viaWizardhavenAllyGrant).toBeDefined();

    const after = dispatch(state, playAction);

    // The ally attached and the site tapped.
    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).allies.some(a => a.instanceId === firstInst)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === firstInst)).toBe(false);

    // The remaining Noble Steed can no longer be played through the grant this phase.
    // (Boromir is still untapped and the grant allows a tapped site, so the only
    // thing stopping it is the once-per-site-phase lock.)
    expect(grantedPlayInstIds(after, NOBLE_STEED)).toHaveLength(0);
    const blocked = computeLegalActions(after, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable' && (ea.action as { cardInstanceId?: string }).cardInstanceId
        === after.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === NOBLE_STEED)!.instanceId);
    expect(blocked?.reason ?? '').toContain('one ally');
  });

  // ─── Rule 5: cannot be duplicated by a given player ────────────────────────

  test('a second An Untimely Brood cannot be played by the same player', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [RADAGAST] }],
          hand: [UNTIMELY_BROOD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // One copy already in play, plus enough non-Brood stage points and protection.
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = protectSite(state, ISENGARD_FW);
    state = recomputeDerived(state);

    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId)).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('cannot be duplicated by a given player');
  });
});
