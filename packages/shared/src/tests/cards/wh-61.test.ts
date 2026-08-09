/**
 * @module wh-61.test
 *
 * Card test: A Strident Spawn (wh-61)
 * Type: minion-resource-event (Fallen-wizard stage permanent-event)
 *
 * Printed text:
 *   "Unique. Playable if you are Pallando or Saruman and have 6 or more stage
 *    points and a protected Wizardhaven [{H}]. Each of your Half-orcs requires
 *    one less point of influence to control. During your organization phase, you
 *    may take one Half-orc character from your discard pile to your hand. You may
 *    play Half-orc characters at your Wizardhavens [{H}], even if your
 *    Fallen-wizard is not there or Bad Company is not in play. Cannot be
 *    duplicated by a given player."
 *
 * CERTIFIED. All six printed rules are exercised through the engine:
 *   1. `stage-points` (4) — contributes 4 stage points to the FW controller.
 *   2. `play-condition` (player-state): playable only if the revealed avatar is
 *      Pallando or Saruman, the player has ≥6 stage points, and the player
 *      controls a protected Wizardhaven.
 *   3. `stat-modifier` mind -1, `target: own-characters`, gated on the Half-orc
 *      keyword — each of *your* Half-orcs costs one less influence to control;
 *      the opponent's Half-orcs are unaffected.
 *   4. `org-phase-fetch` — an optional once-per-organization-phase action to
 *      take one Half-orc from the discard pile to hand.
 *   5. `allow-character-play` (filter: Half-orc, `atOwnWizardhavens`) — lifts the
 *      Fallen-wizard Orc/Troll play restriction (CoE 2.II.2.2.F2) for Half-orcs
 *      and lets them be played at the player's Wizardhavens even when the avatar
 *      is elsewhere.
 *   6. `duplication-limit` (scope `player`) — "Cannot be duplicated by a given
 *      player" (also unique, so a second copy is barred either way).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, reduce,
  addCardInPlay, recomputeDerived, getCharacter,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  LEGOLAS, SAM_GAMGEE,
  RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

// ─── Local card-ID constants ───────────────────────────────────────────────
const STRIDENT_SPAWN = 'wh-61' as CardDefinitionId; // FW stage permanent-event
const BAD_COMPANY = 'wh-63' as CardDefinitionId;     // allows Orc/Troll play
const UNTIMELY_BROOD = 'wh-62' as CardDefinitionId;  // stage-points 4 (non-unique)
const SARUMAN_FW = 'wh-9' as CardDefinitionId;        // Fallen-wizard avatar
const ISENGARD_FW = 'wh-56' as CardDefinitionId;      // Fallen-wizard Wizardhaven
const SLY_SOUTHERNER = 'wh-10' as CardDefinitionId;   // Half-orc, mind 2
const ORC_BRAWLER = 'le-30' as CardDefinitionId;      // plain Orc (not a Half-orc), mind 1

describe('A Strident Spawn (wh-61)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: stage points ─────────────────────────────────────────────────

  test('A Strident Spawn contributes 4 stage points to its Fallen-wizard controller', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(4);
  });

  test('A Strident Spawn is worth 1 marshalling point (miscellaneous), per the printed card', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  // ─── Rule 2: play-condition ────────────────────────────────────────────────

  test('playable from hand when you are Saruman, have ≥6 stage points, and control a protected Wizardhaven', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [STRIDENT_SPAWN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Two copies of An Untimely Brood (4 each) → 8 stage points.
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    // Protect the player's Wizardhaven (Isengard) — as The Fortress of Isen would.
    state = addConstraint(state, {
      source: 'fortress-1' as CardInstanceId,
      sourceDefinitionId: 'wh-68' as CardDefinitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'site-flag', flag: 'site-protected', siteDefinitionId: ISENGARD_FW },
    });
    state = recomputeDerived(state);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(8);

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
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [STRIDENT_SPAWN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = addCardInPlay(state, RESOURCE_PLAYER, UNTIMELY_BROOD);
    state = recomputeDerived(state); // 8 stage points, but no protected Wizardhaven

    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('play condition');
  });

  // ─── Rule 3: each of your Half-orcs costs one less to control ──────────────

  test('reduces the control cost of your Half-orcs by 1, but not the opponent\'s', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW, SLY_SOUTHERNER] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: RIVENDELL, characters: [SLY_SOUTHERNER] }],
          hand: [],
          siteDeck: [LORIEN],
        },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = recomputeDerived(state);

    // Your Half-orc: printed mind 2 → effective 1.
    expect(getCharacter(state, RESOURCE_PLAYER, SLY_SOUTHERNER).effectiveStats.mind).toBe(1);
    // Opponent's Half-orc: unaffected (no mind modifier fires).
    expect(getCharacter(state, HAZARD_PLAYER, SLY_SOUTHERNER).effectiveStats.mind).toBeUndefined();
  });

  // ─── Rule 4: organization-phase fetch from discard ─────────────────────────

  test('grants a once-per-organization-phase fetch of a Half-orc from the discard pile to hand', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [SLY_SOUTHERNER],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = recomputeDerived(state);

    const halfOrcInDiscard = state.players[RESOURCE_PLAYER].discardPile[0].instanceId;

    // The fetch activation is offered.
    const fetchActions = viableActions(state, PLAYER_1, 'activate-org-fetch');
    expect(fetchActions).toHaveLength(1);

    // Activating enqueues the pick-one-or-pass sub-flow.
    const activated = reduce(state, fetchActions[0].action);
    expect(activated.error).toBeUndefined();
    const pick = computeLegalActions(activated.state, PLAYER_1)
      .find(ea => ea.action.type === 'fetch-from-pile'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === halfOrcInDiscard);
    expect(pick).toBeDefined();

    // Taking the Half-orc moves it from discard to hand.
    const fetched = reduce(activated.state, pick!.action);
    expect(fetched.error).toBeUndefined();
    expect(fetched.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === halfOrcInDiscard)).toBe(true);
    expect(fetched.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === halfOrcInDiscard)).toBe(false);

    // The activation cannot be used again this organization phase.
    expect(viableActions(fetched.state, PLAYER_1, 'activate-org-fetch')).toHaveLength(0);
  });

  // ─── Rule 5: Half-orc play permission / Wizardhaven override ───────────────

  test('a Fallen-wizard cannot play a Half-orc with no enabling Stage resource in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [SLY_SOUTHERNER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    const blocked = nonViablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.characterInstanceId === state.players[RESOURCE_PLAYER].hand[0].instanceId);
    expect(blocked).toBeDefined();
  });

  test('A Strident Spawn lets the Fallen-wizard play a Half-orc at the avatar\'s Wizardhaven', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [SLY_SOUTHERNER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = recomputeDerived(state);

    const halfOrcId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const viable = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === halfOrcId);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('A Strident Spawn lets a Half-orc be played at a Wizardhaven even when the avatar is elsewhere', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [
            { site: MORIA, characters: [SARUMAN_FW] },     // avatar away from the Wizardhaven
            { site: ISENGARD_FW, characters: [SAM_GAMGEE] }, // a company at the Wizardhaven
          ],
          hand: [SLY_SOUTHERNER],
          siteDeck: [LORIEN],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    state = recomputeDerived(state);

    const halfOrcId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const wizardhavenSiteId = state.players[RESOURCE_PLAYER].companies[1].currentSite!.instanceId;
    const atWizardhaven = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.characterInstanceId === halfOrcId && a.atSite === wizardhavenSiteId);
    expect(atWizardhaven.length).toBeGreaterThan(0);
  });

  test('A Strident Spawn does not permit a non-Half-orc Orc; Bad Company does', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [ORC_BRAWLER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // With only A Strident Spawn in play, a plain Orc remains barred.
    const withSpawn = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, STRIDENT_SPAWN));
    const orcId = withSpawn.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(viablePlayCharacterActions(withSpawn, PLAYER_1).filter(a => a.characterInstanceId === orcId)).toHaveLength(0);

    // Bad Company lifts the Orc/Troll restriction outright.
    const withBadCompany = recomputeDerived(addCardInPlay(base, RESOURCE_PLAYER, BAD_COMPANY));
    const orcId2 = withBadCompany.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(viablePlayCharacterActions(withBadCompany, PLAYER_1).filter(a => a.characterInstanceId === orcId2).length).toBeGreaterThan(0);
  });

  // ─── Rule 6: cannot be duplicated by a given player ────────────────────────

  test('a second A Strident Spawn cannot be played by the same player', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_FW, characters: [SARUMAN_FW] }],
          hand: [STRIDENT_SPAWN],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, STRIDENT_SPAWN);
    const handId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playable = viableActions(state, PLAYER_1, 'play-permanent-event')
      .filter(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(playable).toHaveLength(0);

    const notPlayable = computeLegalActions(state, PLAYER_1)
      .find(ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === handId);
    expect(notPlayable).toBeDefined();
    expect(notPlayable?.viable).toBe(false);
    expect(notPlayable?.reason ?? '').toContain('already in play');
  });
});
