/**
 * @module dm-134.test
 *
 * Card test: Hall of Fire (dm-134)
 * Type: hero-resource-event (permanent) · alignment: wizard
 * Marshalling points: 0
 *
 * Card text:
 *   "Playable on a Haven [{H}]. Any company at this Haven [{H}] immediately
 *    following its movement/hazard phase may choose for one of its characters
 *    to untap or heal (from wounded to tapped). Discard Hall of Fire when the
 *    site card is returned to the location deck."
 *
 * Modelled as a permanent event bound to the Haven it is played on
 * (`play-target` target `site`, filtered to `siteType: haven`). The site
 * binding (`attachedToSite`) drives two things:
 *   - the discard sweep (`discardOrphanedSiteAttachedEvents`) removes the card
 *     once no company occupies the bound haven (the haven site card has been
 *     returned to the location deck);
 *   - the restore trigger: when a company controlled by the same player ends
 *     its movement/hazard phase at that haven, an `on-event:
 *     company-mh-end-at-site` with apply `offer-restore-character` enqueues a
 *     `haven-restore-character` pending resolution. The controlling player may
 *     untap one tapped character (tapped → untapped) or heal one wounded
 *     character (wounded/inverted → tapped), or pass.
 *
 * | # | Rule                                                       | Status |
 * |---|------------------------------------------------------------|--------|
 * | 1 | playable on a Haven (and only on a Haven)                  | OK     |
 * | 2 | after a company's M/H phase at the haven, may untap a char | OK     |
 * | 3 | …or heal a wounded char (wounded → tapped)                 | OK     |
 * | 4 | the benefit is optional (may pass)                         | OK     |
 * | 5 | only fires for a company at the bound haven                | OK     |
 * | 6 | discarded when the haven leaves play                       | OK     |
 * | 7 | playable during the organization phase (rule 2.1.1)        | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  dispatch, resetMint, mint, pushCardInPlay,
  buildTestState, buildSitePhaseState, makeMHState,
  findCharInstanceId,
  LEGOLAS, GIMLI, RIVENDELL, MORIA,
  CardStatus, Phase,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState } from '../../index.js';

const HALL_OF_FIRE = 'dm-134' as CardDefinitionId;

/** Make a Hall of Fire permanent event bound to a haven, owned by player 0. */
function attachHallOfFire(state: GameState, havenDefId: CardDefinitionId): GameState {
  const card: CardInPlay = {
    instanceId: mint(),
    definitionId: HALL_OF_FIRE,
    status: CardStatus.Untapped,
    attachedToSite: havenDefId,
  };
  return pushCardInPlay(state, 0, card);
}

/**
 * Build a movement/hazard-phase state for player 0 whose single company is at
 * Rivendell (no movement) with the given character statuses, a Hall of Fire
 * bound to Rivendell, and both players already past the play-hazards step
 * except for the hazard player's pass (which ends the company's M/H phase).
 */
function buildMHEndAtHaven(charStatuses: { legolas: CardStatus; gimli: CardStatus }): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: RIVENDELL,
          characters: [
            { defId: LEGOLAS, status: charStatuses.legolas },
            { defId: GIMLI, status: charStatuses.gimli },
          ],
        }],
        hand: [], siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: MORIA, characters: [] }], hand: [], siteDeck: [] },
    ],
    phase: Phase.MovementHazard,
  });
  const withCard = attachHallOfFire(base, RIVENDELL);
  return {
    ...withCard,
    phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: true }),
  };
}

/** End the active company's M/H phase by having the hazard player pass. */
function endCompanyMH(state: GameState): GameState {
  return dispatch(state, { type: 'pass', player: PLAYER_2 });
}

describe('Hall of Fire (dm-134)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable on a Haven, and only on a Haven ────────────────────────

  test('playable on a Haven during the site phase, binding to that haven', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [LEGOLAS, GIMLI], hand: [HALL_OF_FIRE] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HALL_OF_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(RIVENDELL);
  });

  // Rule 2.1.1: resource permanent-events are playable during any phase of
  // the resource player's turn unless a rule or effect restricts them.
  // Hall of Fire's text ("Playable on a Haven [{H}].") declares no
  // site-phase timing, unlike its site-targeting siblings that explicitly
  // print "during the site phase" — so it must be offered as soon as a
  // company is at a matching haven, before the site phase is even reached.
  test('playable during the organization phase (rule 2.1.1 — no site-phase timing declared)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS, GIMLI] }],
          hand: [HALL_OF_FIRE], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [] }], hand: [], siteDeck: [] },
      ],
      phase: Phase.Organization,
    });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HALL_OF_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(RIVENDELL);
  });

  test('NOT playable on a non-Haven site (Moria)', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [LEGOLAS, GIMLI], hand: [HALL_OF_FIRE] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HALL_OF_FIRE)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(0);
  });

  // ── Rules 2 & 4: after the M/H phase, may untap one character ────────────────

  test('after a company finishes M/H at the haven, the player may untap a tapped character', () => {
    const state = buildMHEndAtHaven({ legolas: CardStatus.Tapped, gimli: CardStatus.Untapped });
    const after = endCompanyMH(state);

    // The restore offer is enqueued as a pending resolution for player 0.
    const pending = after.pendingResolutions.find(r => r.kind.type === 'haven-restore-character');
    expect(pending).toBeDefined();
    expect(pending!.actor).toBe(PLAYER_1);

    // Legal actions: the tapped Legolas may be restored; pass is available.
    const legolasId = findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const restoreActions = computeLegalActions(after, PLAYER_1).filter(
      a => a.viable && a.action.type === 'restore-character-by-effect',
    );
    const restoreTargets = restoreActions.map(a => (a.action as { characterInstanceId: CardInstanceId }).characterInstanceId);
    expect(restoreTargets).toContain(legolasId);
    // The untapped Gimli is not offered (nothing to untap/heal).
    expect(restoreTargets).not.toContain(gimliId);
    expect(computeLegalActions(after, PLAYER_1).some(a => a.viable && a.action.type === 'pass')).toBe(true);

    // Resolving on Legolas untaps him.
    const resolved = dispatch(after, { type: 'restore-character-by-effect', player: PLAYER_1, characterInstanceId: legolasId });
    expect(resolved.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Untapped);
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'haven-restore-character')).toBe(false);
  });

  // ── Rule 3: heal a wounded character (wounded → tapped) ──────────────────────

  test('the heal option moves a wounded character from wounded to tapped (not to untapped)', () => {
    const state = buildMHEndAtHaven({ legolas: CardStatus.Untapped, gimli: CardStatus.Inverted });
    const after = endCompanyMH(state);

    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const restoreTargets = computeLegalActions(after, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'restore-character-by-effect')
      .map(a => (a.action as { characterInstanceId: CardInstanceId }).characterInstanceId);
    expect(restoreTargets).toContain(gimliId);

    const resolved = dispatch(after, { type: 'restore-character-by-effect', player: PLAYER_1, characterInstanceId: gimliId });
    // Heals one step: wounded (inverted) → tapped, NOT untapped.
    expect(resolved.players[RESOURCE_PLAYER].characters[gimliId].status).toBe(CardStatus.Tapped);
  });

  test('only one character is restored per Hall of Fire — the resolution clears after one choice', () => {
    const state = buildMHEndAtHaven({ legolas: CardStatus.Tapped, gimli: CardStatus.Inverted });
    const after = endCompanyMH(state);
    const legolasId = findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);

    const resolved = dispatch(after, { type: 'restore-character-by-effect', player: PLAYER_1, characterInstanceId: legolasId });
    // Legolas untapped; Gimli stays wounded (only one may be chosen).
    expect(resolved.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Untapped);
    expect(resolved.players[RESOURCE_PLAYER].characters[gimliId].status).toBe(CardStatus.Inverted);
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'haven-restore-character')).toBe(false);
  });

  // ── Rule 4: the benefit is optional ─────────────────────────────────────────

  test('the player may pass, leaving every character untouched', () => {
    const state = buildMHEndAtHaven({ legolas: CardStatus.Tapped, gimli: CardStatus.Inverted });
    const after = endCompanyMH(state);
    const legolasId = findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);

    const passed = dispatch(after, { type: 'pass', player: PLAYER_1 });
    expect(passed.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);
    expect(passed.players[RESOURCE_PLAYER].characters[gimliId].status).toBe(CardStatus.Inverted);
    expect(passed.pendingResolutions.some(r => r.kind.type === 'haven-restore-character')).toBe(false);
  });

  // ── Rule 5: gating — only at the bound haven, only with something to restore ──

  test('no offer when the company has no tapped or wounded character', () => {
    const state = buildMHEndAtHaven({ legolas: CardStatus.Untapped, gimli: CardStatus.Untapped });
    const after = endCompanyMH(state);
    expect(after.pendingResolutions.some(r => r.kind.type === 'haven-restore-character')).toBe(false);
  });

  test('no offer when no Hall of Fire is bound to the company\'s haven', () => {
    // Same fixture but without the Hall of Fire card in play.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: LEGOLAS, status: CardStatus.Tapped }, GIMLI] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [] }], hand: [], siteDeck: [] },
      ],
      phase: Phase.MovementHazard,
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: true }) };
    const after = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(after.pendingResolutions.some(r => r.kind.type === 'haven-restore-character')).toBe(false);
  });

  test('no offer when the Hall of Fire is bound to a different site than the company\'s haven', () => {
    // Hall of Fire bound to Moria; the company finishes M/H at Rivendell.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: LEGOLAS, status: CardStatus.Tapped }, GIMLI] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [] }], hand: [], siteDeck: [] },
      ],
      phase: Phase.MovementHazard,
    });
    const withCard = attachHallOfFire(base, MORIA);
    const state = { ...withCard, phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: true }) };
    const after = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(after.pendingResolutions.some(r => r.kind.type === 'haven-restore-character')).toBe(false);
  });

  // ── Rule 6: discarded when the haven leaves play ─────────────────────────────

  test('the card persists while a company occupies the bound haven', () => {
    const state = buildMHEndAtHaven({ legolas: CardStatus.Tapped, gimli: CardStatus.Untapped });
    const swept = discardOrphanedSiteAttachedEvents(state);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HALL_OF_FIRE)).toBe(true);
  });

  test('the card is discarded once no company occupies the bound haven (site returned to location deck)', () => {
    const state = buildMHEndAtHaven({ legolas: CardStatus.Tapped, gimli: CardStatus.Untapped });
    // The company moves on — its current site is no longer Rivendell.
    const movedCompany = {
      ...state.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...state.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: MORIA },
    };
    const moved: GameState = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], companies: [movedCompany] },
        state.players[1],
      ] as GameState['players'],
    };
    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HALL_OF_FIRE)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HALL_OF_FIRE)).toBe(true);
  });
});
