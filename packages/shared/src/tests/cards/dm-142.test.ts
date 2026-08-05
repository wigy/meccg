/**
 * @module dm-142.test
 *
 * Card test: Hundreds of Butterflies (dm-142)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. play-window movement-hazard — only playable during M/H phase
 *   2. play-target character filter company.moving — targets characters only in the active moving company
 *   3. on-event self-enters-play → set-character-status untapped — untaps the target
 *   4. on-event self-enters-play → add-constraint hazard-limit-modifier +1 (company-mh-phase)
 *
 * "Playable on a moving character during his movement/hazard phase.
 *  Untap the character and increase the hazard limit against his company by one."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ELROND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  CardStatus,
  companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayShortEventAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const HUNDREDS_OF_BUTTERFLIES = 'dm-142' as CardDefinitionId;

describe('Hundreds of Butterflies (dm-142)', () => {
  beforeEach(() => resetMint());

  // ── Phase restriction ───────────────────────────────────────────────────────

  test('not playable during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  // ── Playability in M/H ─────────────────────────────────────────────────────

  test('playable during M/H phase — one action per character in the moving company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(2);
    for (const ea of playActions) {
      const a = ea.action as PlayShortEventAction;
      expect(a.targetCharacterId).toBeDefined();
      expect(a.optionId).toBeUndefined();
    }
  });

  test('not offered when the active company is not moving (stationary)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // destinationSiteName: null means the active company is not moving
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: null }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.filter(a => a.viable)).toHaveLength(0);
  });

  test('not offered on a stationary company even when destinationSiteName is set to current site', () => {
    // Regression: game mppr2rlu-vsmg1v seq 150 — the engine sets destinationSiteName
    // to the current site name for stationary companies (rule 2.IV.ii), so the
    // company.moving filter must use siteRevealed, not destinationSiteName !== null.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Stationary company: engine sets destinationSiteName=currentSite, siteRevealed=false
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Moria', siteRevealed: false }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.filter(a => a.viable)).toHaveLength(0);
  });

  test('only targets characters in the active moving company, not characters in other companies', () => {
    // Regression test: bug where all characters across all companies were offered
    // (game mpgyr5l9-3xcf53, seq 362 — company-p1-1 moving to Rivendell but
    //  characters from the stationary company-p1-0 were also offered as targets).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN, LEGOLAS] },  // company 0 — stationary
            { site: LORIEN, characters: [ELROND] },            // company 1 — moving
          ],
          hand: [HUNDREDS_OF_BUTTERFLIES],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    // Active company is index 1 (ELROND's company), moving to Minas Tirith
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 1, destinationSiteName: 'Minas Tirith', siteRevealed: true }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    // Only ELROND (in the moving company) should be a valid target
    expect(playActions).toHaveLength(1);
    const a = playActions[0].action as PlayShortEventAction;
    expect(a.targetCharacterId).toBeDefined();
  });

  // ── Untap effect ───────────────────────────────────────────────────────────

  test('playing the card untaps a tapped character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true }) };

    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const after = dispatch(state, playActions[0].action);

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('playing the card on an untapped character leaves it untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true }) };

    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    const after = dispatch(state, playActions[0].action);

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('playing the card on a wounded character leaves it wounded (untap requires tapped, not wounded)', () => {
    // Regression: game msenkvsc-3y5o11 seq 590 — Hundreds of Butterflies played
    // on a wounded Gildor Inglorion untapped him outright, silently clearing
    // the wound. Per the glossary, "untap" requires the target be initially
    // tapped (not wounded or already untapped); a wounded target must stay
    // wounded.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true }) };

    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const after = dispatch(state, playActions[0].action);

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  // ── Hazard-limit constraint ─────────────────────────────────────────────────

  test('playing the card adds hazard-limit-modifier +1 on the company (company-mh-phase scope)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true }) };
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const after = dispatch(state, playActions[0].action);

    const hazardLimitConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'hazard-limit-modifier',
    );
    expect(hazardLimitConstraints).toHaveLength(1);
    const constraint = hazardLimitConstraints[0];
    if (constraint.kind.type === 'hazard-limit-modifier') {
      expect(constraint.kind.value).toBe(1);
    }
    expect(constraint.target.kind).toBe('company');
    if (constraint.target.kind === 'company') {
      expect(constraint.target.companyId).toBe(companyId);
    }
    expect(constraint.scope.kind).toBe('company-mh-phase');
  });

  // ── Card disposal ──────────────────────────────────────────────────────────

  test('card is removed from hand and placed in discard pile after play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [HUNDREDS_OF_BUTTERFLIES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0, destinationSiteName: 'Minas Tirith', siteRevealed: true }) };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    const after = dispatch(state, playActions[0].action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, HUNDREDS_OF_BUTTERFLIES);
  });
});
