/**
 * @module rule-3.08-ringwraith-follower
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.08: Ringwraith Follower Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith avatar may be played as a "Ringwraith follower" with the following active conditions:
 * • The player has a card or ability that allows a Ringwraith follower to be played.
 * • The player already has a Ringwraith in play at a Darkhaven or the Ringwraith follower's home site.
 * [MINION] A Ringwraith follower can only be controlled by a Ringwraith avatar, requires one point of direct influence to control, and still counts as an avatar card but does not count as its player's avatar (i.e. it is not "your" Ringwraith or "your" avatar) while in play as a Ringwraith follower.
 * [MINION] A Ringwraith follower cannot be influenced away.
 * [MINION] A Ringwraith follower's skills and direct influence may be used, including using magic, but its other effects and Unleashed cards cannot be initiated (except for Ûvatha the Ringraith's ability to join another company).
 * [MINION] If a player's Ringwraith avatar leaves play without being eliminated, that player has until the end of their next organization phase to bring a Ringwraith avatar back into play to re-control that player's Ringwraith followers; otherwise those Ringwraith followers are immediately discarded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, OpponentInfluenceAttemptAction } from '../../test-helpers.js';
import {
  buildTestState, resetMint, dispatch, findCharInstanceId, Phase, Alignment,
  viablePlayCharacterActions, viableActions, makeSitePhase,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';

// The Witch-king (le-58): "As your Ringwraith, up to two Ringwraith followers
// in his company may be controlled with no influence" — the enabling ability
// for follower play. Adûnaphel (le-50, homesite "Urlurtsu Nurn") is the
// follower candidate. Single-test use → inline.
const WITCH_KING = 'le-58' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // Darkhaven
const ETTENMOORS = 'le-373' as CardDefinitionId; // not a Darkhaven, not Adûnaphel's home site
const THE_MOUTH = 'le-24' as CardDefinitionId; // minion influencer (DI 4)
const ASTERNAK = 'le-1' as CardDefinitionId; // plain minion character (mind 5)

describe('Rule 3.08 — Ringwraith Follower Rules', () => {
  beforeEach(() => resetMint());

  test('[MINION] Ringwraith avatar with follower-slots ability, at a Darkhaven, may play another Ringwraith avatar as a follower', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [WITCH_KING] }],
          hand: [ADUNAPHEL],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);

    const witchKingId = findCharInstanceId(state, RESOURCE_PLAYER, WITCH_KING);
    const followerPlay = viable.find(a => a.controlledBy === witchKingId);
    expect(followerPlay).toBeDefined();

    const after = dispatch(state, followerPlay!);
    // Consumes no general influence — the follower's mind is null.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(0);
    const adunaphelId = findCharInstanceId(after, RESOURCE_PLAYER, ADUNAPHEL);
    expect(after.players[RESOURCE_PLAYER].characters[adunaphelId].controlledBy).toBe(witchKingId);
  });

  test('[MINION] Cannot be played as a follower when the controlling Ringwraith is not at a Darkhaven or the follower\'s home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [WITCH_KING] }],
          hand: [ADUNAPHEL],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('[MINION] Cannot be played as a follower without an enabling ability on the revealed avatar', () => {
    // Adûnaphel herself is already the revealed avatar (no follower-slots
    // effect) — a second Ringwraith avatar has no path into play at all.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ADUNAPHEL] }],
          hand: [WITCH_KING],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          hand: [],
          siteDeck: [],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('[MINION] a Ringwraith follower cannot be influenced away (opponent influence never targets it)', () => {
    // Ringwraith followers are avatar cards, and influence attempts never
    // target avatar characters — so Adûnaphel (a follower of the Witch-king)
    // must not be offered as an opponent-influence target, while the plain
    // minion character in the same company is.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: WITCH_KING },
              { defId: ADUNAPHEL, followerOf: 0 },
              { defId: ASTERNAK },
            ],
          }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
      ],
    });
    const state = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const adunaphelId = findCharInstanceId(state, HAZARD_PLAYER, ADUNAPHEL);
    const asternakId = findCharInstanceId(state, HAZARD_PLAYER, ASTERNAK);

    const targets = viableActions(state, PLAYER_1, 'opponent-influence-attempt')
      .map(ea => (ea.action as OpponentInfluenceAttemptAction).targetInstanceId);
    expect(targets).toContain(asternakId);
    expect(targets).not.toContain(adunaphelId);
  });

  // The 1-DI control cost has no exercising card: the only follower-slots
  // enabler in the pool (The Witch-king le-58) explicitly grants control
  // "with no influence", overriding the generic 1-DI rule. The grace-period
  // rule shares the end-of-organization enforcement machinery with rules
  // 3.13 and 3.47, which does not exist yet.
  test.todo('[MINION] Ringwraith follower requires 1 point of direct influence to control (no card exercises the non-exempt path)');
  test.todo('[MINION] If the controlling Ringwraith avatar leaves play without being eliminated, followers must be reclaimed by end of next organization phase or are discarded');
});
