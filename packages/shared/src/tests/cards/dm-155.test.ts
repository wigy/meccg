/**
 * @module dm-155.test
 *
 * Card test: Rebuild the Town (dm-155)
 * Type: hero-resource-event (permanent)
 * Effects: 3 (play-target site filter, site-type-override, skip-automatic-attacks)
 *
 * "Playable during the site phase on a non-Dragon's lair, non-Under-deeps
 *  Ruins & Lairs [R]. The site becomes a Border-hold [B] and all
 *  automatic-attacks are removed. Discard Rebuild the Town when the site
 *  is discarded or returned to its location deck."
 *
 * | # | Effect Type      | Status | Notes                                     |
 * |---|------------------|--------|-------------------------------------------|
 * | 1 | play-target      | OK     | site filter: ruins-and-lairs only          |
 * | 2 | on-event         | OK     | self-enters-play → site-type-override      |
 * | 3 | on-event         | OK     | self-enters-play → skip-automatic-attacks   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BANDIT_LAIR,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, handCardId, dispatch, companyIdAt,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, SitePhaseState } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const REBUILD_THE_TOWN = 'dm-155' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Rebuild the Town (dm-155)', () => {
  beforeEach(() => resetMint());

  test('playable as permanent event at ruins-and-lairs site during site phase', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      hand: [REBUILD_THE_TOWN],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(1);
  });

  test('not playable at a non-ruins-and-lairs site', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [REBUILD_THE_TOWN],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(0);

    const allActions = computeLegalActions(state, PLAYER_1);
    const notPlayable = allActions.filter(
      a => !a.viable && a.reason?.includes('does not match'),
    );
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
  });

  test('not playable at a haven', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      hand: [REBUILD_THE_TOWN],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing Rebuild the Town creates site-type-override and skip-automatic-attacks constraints', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      hand: [REBUILD_THE_TOWN],
    });

    const cardId = handCardId(state, 0);
    const afterPlay = dispatch(state, {
      type: 'play-permanent-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetSiteDefinitionId: BANDIT_LAIR,
    });

    // Resolve the chain: both players pass chain priority
    const afterPass = dispatch(afterPlay, { type: 'pass-chain-priority', player: PLAYER_2 });
    const resolved = dispatch(afterPass, { type: 'pass-chain-priority', player: PLAYER_1 });

    // Card should be in play
    expect(resolved.players[0].cardsInPlay.some(c => c.instanceId === cardId)).toBe(true);

    // site-type-override constraint should exist
    const siteOverride = resolved.activeConstraints.find(
      c => c.kind.type === 'site-type-override',
    );
    expect(siteOverride).toBeDefined();
    expect(siteOverride!.kind.type === 'site-type-override' && siteOverride!.kind.overrideType).toBe('border-hold');

    // skip-automatic-attacks constraint should exist
    const skipAA = resolved.activeConstraints.find(
      c => c.kind.type === 'skip-automatic-attacks',
    );
    expect(skipAA).toBeDefined();
  });

  test('automatic attacks are skipped at a site with skip-automatic-attacks constraint', () => {
    // Build a state at enter-or-skip step for Bandit Lair (which has automatic attacks)
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const enterOrSkipState: SitePhaseState = {
      phase: Phase.Site,
      step: 'enter-or-skip',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };

    const stateAtEnter = { ...base, phaseState: enterOrSkipState };
    const cid = companyIdAt(stateAtEnter, 0);

    // First verify that WITHOUT the constraint, entering site goes to reveal-on-guard-attacks
    const entered = dispatch(stateAtEnter, { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect((entered.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');

    // Now add the skip-automatic-attacks constraint
    const withConstraint = addConstraint(
      stateAtEnter,
      {
        source: 'test-source' as CardInstanceId,
        sourceDefinitionId: REBUILD_THE_TOWN,
        scope: { kind: 'until-cleared' },
        target: { kind: 'company', companyId: cid },
        kind: {
          type: 'skip-automatic-attacks',
          siteDefinitionId: BANDIT_LAIR,
        },
      },
    );

    // Entering site should skip automatic attacks and go to declare-agent-attack
    const enteredWithSkip = dispatch(withConstraint, { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect((enteredWithSkip.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });
});
