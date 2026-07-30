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
import { Race } from '../../../index.js';
import type { CardInstanceId, CombatState } from '../../../index.js';
import type { CardDefinitionId, OpponentInfluenceAttemptAction } from '../../test-helpers.js';
import {
  buildTestState, resetMint, dispatch, executeAction, findCharInstanceId, Phase, Alignment,
  viablePlayCharacterActions, viableActions, makeSitePhase, makeShadowMHState,
  companyIdAt, recomputeDerived,
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
  // "with no influence", overriding the generic 1-DI rule.
  test.todo('[MINION] Ringwraith follower requires 1 point of direct influence to control (no card exercises the non-exempt path)');

  test('[MINION] avatar returned to hand by a failed body check leaves its Ringwraith follower in the reclaim grace period', () => {
    // The Witch-king controls Adûnaphel as a Ringwraith follower. He faces an
    // unwinnable strike, is wounded, and his body check rolls an unmodified 7 —
    // per MELE §8.R1 a Ringwraith returns to hand instead of being eliminated.
    // That is rule 3.08's trigger: the avatar left play *without* being
    // eliminated, so Adûnaphel is not discarded on the spot but enters the
    // grace period ('grace'), awaiting a Ringwraith avatar to re-control her
    // by the end of her player's next organization phase.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: WITCH_KING },
              { defId: ADUNAPHEL, followerOf: 0 },
            ],
          }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const witchKingId = findCharInstanceId(base, RESOURCE_PLAYER, WITCH_KING);
    const adunaphelId = findCharInstanceId(base, RESOURCE_PLAYER, ADUNAPHEL);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    expect(base.players[RESOURCE_PLAYER].characters[adunaphelId].controlledBy).toBe(witchKingId);

    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'fake-creature' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 99, // unwinnable — the Witch-king is wounded
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: witchKingId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };
    const state = { ...base, combat, phaseState: makeShadowMHState() };

    // Fail the strike (roll 2 vs prowess 99) → wounded, body check follows.
    const [resolveAction] = viableActions({ ...state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const wounded = dispatch({ ...state, cheatRollTotal: 2 }, resolveAction.action);

    // Unmodified body check roll of 7 → the Ringwraith returns to hand.
    const after = executeAction(wounded, PLAYER_2, 'body-check-roll', 7);
    expect(after.players[RESOURCE_PLAYER].characters[witchKingId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === witchKingId)).toBe(true);

    const adunaphel = after.players[RESOURCE_PLAYER].characters[adunaphelId];
    expect(adunaphel.controlledBy).toBe('general');
    expect(adunaphel.ringwraithReclaim).toBe('grace');
  });

  test('[MINION] a Ringwraith follower not re-controlled by the end of the next organization phase is immediately discarded', () => {
    // Adûnaphel entered the grace period on an earlier turn (her controlling
    // avatar left play without being eliminated). Reaching the organization
    // phase promotes the flag to 'due' — this is the "next organization phase"
    // rule 3.08 grants — and passing out of the phase with no Ringwraith
    // avatar controlling her discards her immediately, with no player choice.
    // The plain minion character in the same company is untouched.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ADUNAPHEL, ASTERNAK] }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const adunaphelId = findCharInstanceId(base, RESOURCE_PLAYER, ADUNAPHEL);
    const asternakId = findCharInstanceId(base, RESOURCE_PLAYER, ASTERNAK);
    const flagged = recomputeDerived({
      ...base,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: true,
        resourcePlayerPassed: false,
        hazardPlayerPassed: true,
      } as typeof base.phaseState,
      players: base.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [adunaphelId as string]: { ...p.characters[adunaphelId], ringwraithReclaim: 'grace' },
        },
      }) as unknown as typeof base.players,
    });

    // Untapping moves the player into their organization phase — the grace
    // flag promotes to 'due': this phase is the reclaim deadline.
    const inOrg = dispatch(flagged, { type: 'untap', player: PLAYER_1 });
    expect(inOrg.phaseState.phase).toBe(Phase.Organization);
    expect(inOrg.players[RESOURCE_PLAYER].characters[adunaphelId].ringwraithReclaim).toBe('due');

    // Passing out of the phase without a Ringwraith avatar re-controlling her
    // discards her on the spot — no pending resolution asks anything.
    const passed = dispatch(inOrg, { type: 'pass', player: PLAYER_1 });
    expect(passed.players[RESOURCE_PLAYER].characters[adunaphelId]).toBeUndefined();
    expect(passed.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === adunaphelId)).toBe(true);
    expect(passed.players[RESOURCE_PLAYER].characters[asternakId]).toBeDefined();
    expect(passed.pendingResolutions).toHaveLength(0);
  });

  test('[MINION] a Ringwraith follower re-controlled by a Ringwraith avatar before the deadline stays in play and sheds the flag', () => {
    // Same deadline turn, but a Ringwraith avatar (the Witch-king) controls
    // Adûnaphel again when the organization phase ends — the reclaim
    // succeeded, so the flag clears and nothing is discarded.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              { defId: WITCH_KING },
              { defId: ADUNAPHEL, followerOf: 0 },
            ],
          }],
          hand: [],
          siteDeck: [ETTENMOORS],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const witchKingId = findCharInstanceId(base, RESOURCE_PLAYER, WITCH_KING);
    const adunaphelId = findCharInstanceId(base, RESOURCE_PLAYER, ADUNAPHEL);
    const flagged = recomputeDerived({
      ...base,
      players: base.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [adunaphelId as string]: { ...p.characters[adunaphelId], ringwraithReclaim: 'due' },
        },
      }) as unknown as typeof base.players,
    });

    const passed = dispatch(flagged, { type: 'pass', player: PLAYER_1 });
    expect(passed.phaseState.phase).toBe(Phase.LongEvent);
    const adunaphel = passed.players[RESOURCE_PLAYER].characters[adunaphelId];
    expect(adunaphel).toBeDefined();
    expect(adunaphel.controlledBy).toBe(witchKingId);
    expect(adunaphel.ringwraithReclaim).toBeUndefined();
  });
});
