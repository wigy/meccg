/**
 * @module td-130.test
 *
 * Card test: Magical Harp (td-130)
 * Type: hero-resource-item (major, hoard)
 *
 * Printed text:
 *   "Unique. Hoard item. Tap Magical Harp to cancel all effects for the
 *    rest of the turn that discard a target character in bearer's
 *    company. Bearer makes a corruption check. This item may also be so
 *    tapped during opponent's site phase or the Free Council."
 *
 * Effects (data):
 *   1. item-play-site — playable only at sites whose keywords include "hoard"
 *   2. grant-action — cancel-character-discard (cost: tap self)
 *      with phase flags anyPhase, opposingSitePhase, freeCouncil.
 *      Apply: add turn-scoped `cancel-character-discard` constraint to
 *      the bearer's company + enqueue a corruption check on the bearer.
 *
 * The constraint is consulted by the corruption-check resolver (CoE
 * 7.1.3: an effect that prevents a character from being discarded due to
 * a corruption check roll makes the check "considered successful"), so it
 * protects the bearer's own company from a failed corruption check's
 * discard outcome — including the check the harp's own activation enqueues
 * on its bearer.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, SARUMAN, ARAGORN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  Phase, CardStatus,
  resetMint,
  buildTestState,
  buildSitePhaseState,
  viableActions,
  viableFor,
  attachItemToChar,
  charIdAt,
  dispatch,
  expectCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId,
  ActivateGrantedAction,
  CorruptionCheckAction,
  FreeCouncilPhaseState,
  SitePhaseState,
} from '../../index.js';

const MAGICAL_HARP = 'td-130' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // Smaug's lair, hoard site

describe('Magical Harp (td-130)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: Hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 1: Uniqueness ──────────────────────────────────────────────────

  test('second copy of Magical Harp is NOT playable while another is in play', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [
        { defId: GANDALF, items: [MAGICAL_HARP] },
        SARUMAN,
      ],
      hand: [MAGICAL_HARP],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const viable = plays.filter(ea => ea.viable);
    expect(viable).toHaveLength(0);
  });

  test('first copy is playable on an unburdened bearer', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [MAGICAL_HARP],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId
        && ea.viable,
    );
    expect(onGandalf).toBeDefined();
  });

  // ─── Rule 3/4/5: Grant-action emission windows ───────────────────────────

  test('grant-action is available during bearer\'s organization phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHarp = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, MAGICAL_HARP);

    const actions = viableActions(withHarp, PLAYER_1, 'activate-granted-action');
    const harpActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    );
    expect(harpActions).toHaveLength(1);
  });

  test('grant-action is available during bearer\'s site phase', () => {
    const base = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
    });
    const withHarp = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, MAGICAL_HARP);

    const actions = viableActions(withHarp, PLAYER_1, 'activate-granted-action');
    const harpActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    );
    expect(harpActions).toHaveLength(1);
  });

  test('grant-action is available during OPPONENT\'S site phase (opposingSitePhase flag)', () => {
    // P1 is the active (resource) player playing resources at Lonely
    // Mountain; P2 is the hazard player who owns Magical Harp. P2 should
    // be able to tap the harp during P1's site phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const withHarp = attachItemToChar(
      { ...state, phaseState: sitePhaseState },
      HAZARD_PLAYER, GANDALF, MAGICAL_HARP,
    );

    const actions = viableActions(withHarp, PLAYER_2, 'activate-granted-action');
    const harpActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    );
    expect(harpActions).toHaveLength(1);
  });

  test('grant-action is available during Free Council (freeCouncil flag) for both players', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_2, // P2 is currently running checks
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };
    const withHarp = attachItemToChar(
      { ...base, phaseState: fcState },
      RESOURCE_PLAYER, GANDALF, MAGICAL_HARP,
    );

    // P1 (not the currentPlayer) can still tap Magical Harp in the Free
    // Council because the grant-action carries `freeCouncil: true`.
    const actions = viableActions(withHarp, PLAYER_1, 'activate-granted-action');
    const harpActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    );
    expect(harpActions).toHaveLength(1);
  });

  // ─── Rule 3/4: Activation effect ────────────────────────────────────────

  test('activating taps the harp, adds turn-scoped constraint, and enqueues corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHarp = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, MAGICAL_HARP);

    const gandalfId = charIdAt(withHarp, RESOURCE_PLAYER, 0, 0);
    const gandalfInPlay = withHarp.players[RESOURCE_PLAYER].characters[gandalfId];
    const harpInstId = gandalfInPlay.items[0].instanceId;

    // Harp starts untapped
    expect(gandalfInPlay.items[0].status).toBe(CardStatus.Untapped);

    const actions = viableActions(withHarp, PLAYER_1, 'activate-granted-action');
    const harpAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    )!;
    expect(harpAction).toBeDefined();

    const after = dispatch(withHarp, harpAction.action);

    // Harp (the item) is now tapped — the `cost: { tap: "self" }` taps
    // the item itself, not the bearer (Gandalf remains untapped and
    // could still act in combat this turn).
    const gandalfAfter = after.players[RESOURCE_PLAYER].characters[gandalfId];
    const harpAfter = gandalfAfter.items.find(i => i.instanceId === harpInstId)!;
    expect(harpAfter.status).toBe(CardStatus.Tapped);
    expectCharStatus(after, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);

    // Constraint placed on bearer's company, scoped to the rest of the turn
    expect(after.activeConstraints).toHaveLength(1);
    const constraint = after.activeConstraints[0];
    expect(constraint.kind.type).toBe('cancel-character-discard');
    expect(constraint.target.kind).toBe('company');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.source).toBe(harpInstId);

    // Corruption check enqueued for the bearer
    expect(after.pendingResolutions).toHaveLength(1);
    const pending = after.pendingResolutions[0];
    expect(pending.kind.type).toBe('corruption-check');
    if (pending.kind.type === 'corruption-check') {
      expect(pending.kind.characterId).toBe(gandalfId);
      expect(pending.kind.reason).toBe('Magical Harp');
    }
    expect(pending.actor).toBe(PLAYER_1);
  });

  test('company mate can tap in support of the corruption check the harp enqueues (CoE 7.1.1)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHarp = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, MAGICAL_HARP);

    const gandalfId = charIdAt(withHarp, RESOURCE_PLAYER, 0, 0);
    const aragornId = charIdAt(withHarp, RESOURCE_PLAYER, 0, 1);

    const actions = viableActions(withHarp, PLAYER_1, 'activate-granted-action');
    const harpAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    )!;
    const after = dispatch(withHarp, harpAction.action);

    // The corruption check is now pending — Aragorn, untapped in the same
    // company as Gandalf, should be offered as a support tap.
    const supportActions = viableActions(after, PLAYER_1, 'support-corruption-check');
    const aragornSupport = supportActions.find(
      ea => ea.action.type === 'support-corruption-check'
        && ea.action.supportingCharacterId === aragornId
        && ea.action.targetCharacterId === gandalfId,
    );
    expect(aragornSupport).toBeDefined();
  });

  test('tapped harp cannot be activated', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHarp = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, MAGICAL_HARP);

    // Pre-tap the harp
    const gandalfId = charIdAt(withHarp, RESOURCE_PLAYER, 0, 0);
    const gandalfInPlay = withHarp.players[RESOURCE_PLAYER].characters[gandalfId];
    const harpInstId = gandalfInPlay.items[0].instanceId;
    const tapped = {
      ...withHarp,
      players: [
        {
          ...withHarp.players[0],
          characters: {
            ...withHarp.players[0].characters,
            [gandalfId as string]: {
              ...gandalfInPlay,
              items: gandalfInPlay.items.map(it =>
                it.instanceId === harpInstId ? { ...it, status: CardStatus.Tapped } : it,
              ),
            },
          },
        },
        withHarp.players[1],
      ] as const,
    };

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    const harpActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    );
    expect(harpActions).toHaveLength(0);
  });

  // ─── Negative emission: base phases without flags ───────────────────────

  test('opposing player WITHOUT Magical Harp gets no extra actions during active player\'s site phase', () => {
    // Sanity: the opposing-site-phase emission is gated on the flag;
    // without Magical Harp attached, the non-active player should see
    // the same empty-action set they saw before this feature existed.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };

    const actions = viableFor({ ...state, phaseState: sitePhaseState }, PLAYER_2);
    const harpActions = actions.filter(
      ea => ea.action.type === 'activate-granted-action'
        && ea.action.actionId === 'cancel-character-discard',
    );
    expect(harpActions).toHaveLength(0);
  });

  // ─── Rule 2 (CoE 7.1.3): the constraint actually prevents a discard ──────

  test('active cancel-character-discard constraint saves the bearer from its own corruption-check discard (CoE 7.1.3)', () => {
    // Reproduces a reported bug: tapping the harp enqueues a corruption
    // check on its own bearer (per the card's text) and simultaneously
    // places a `cancel-character-discard` constraint on the bearer's own
    // company. A roll landing in the "discard" band (roll == CP or CP-1)
    // must NOT discard the bearer — CoE 7.1.3 says an effect that prevents
    // the discard makes the check "considered successful" instead.
    //
    // Aragorn (not Gandalf) is the bearer here: Gandalf's own text grants
    // "+1 to all of his corruption checks", which — combined with the
    // harp's CP 2 and a minimum 2d6 roll of 2 — makes the check unfailable
    // on its own and would mask the bug regardless of the fix.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withHarp = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGICAL_HARP);
    const aragornId = charIdAt(withHarp, RESOURCE_PLAYER, 0, 0);

    const grantActions = viableActions(withHarp, PLAYER_1, 'activate-granted-action');
    const harpAction = grantActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'cancel-character-discard',
    )!;
    const afterTap = dispatch(withHarp, harpAction.action);

    // The constraint is active and the corruption check is queued on Aragorn.
    expect(afterTap.activeConstraints.some(c => c.kind.type === 'cancel-character-discard')).toBe(true);
    expect(afterTap.pendingResolutions).toHaveLength(1);

    const rollAction = computeLegalActions(afterTap, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'corruption-check')!.action as CorruptionCheckAction;
    expect(rollAction.characterId).toBe(aragornId);
    expect(rollAction.corruptionModifier).toBe(0);

    // Force a dice total equal to CP — the "discard" band for a hero
    // character (CoE 7.1) — with no modifier in play.
    const cheatedRoll = { ...afterTap, cheatRollTotal: rollAction.corruptionPoints };
    const resolved = dispatch(cheatedRoll, rollAction);

    // Aragorn stays in play, in his company, untouched by the discard.
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === aragornId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === aragornId)).toBe(false);
    const company = resolved.players[RESOURCE_PLAYER].companies.find(co => co.characters.includes(aragornId));
    expect(company).toBeDefined();
    expect(resolved.pendingResolutions).toHaveLength(0);
  });
});
