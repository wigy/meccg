/**
 * @module rule-5.02-mh-step1-reveal-site
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.02: Step 1: Reveal the New Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 1 (Reveal the New Site) - If the company is moving, the company's new site is revealed. No other actions can be taken during this step, which happens immediately.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActionTypes, viableActions,
  reduce, companyIdAt, handCardId, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../../index.js';

/** River (tw-84): a ranger in the affected company may tap to cancel it. */
const RIVER = 'tw-84' as CardDefinitionId;

describe('Rule 5.02 — Step 1: Reveal the New Site', () => {
  beforeEach(() => resetMint());

  test('Moving company: declare-path offered during reveal-new-site; no other actions', () => {
    // A moving company has a destinationSite set. During reveal-new-site,
    // the resource player must declare their path (starter or region movement).
    // No other actions are offered at this step.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const types = viableActionTypes(state, PLAYER_1);
    // declare-path must be offered (to choose starter or region movement)
    expect(types).toContain('declare-path');
    // No resource plays, hazard plays, or other actions during this step
    expect(types.filter(t => t !== 'declare-path')).toHaveLength(0);
  });

  test('A granted action offered during reveal-new-site is accepted, not refused', () => {
    // The step takes no *player* actions, but the granted-action pass-through
    // offers an active grant in every M/H step — River (tw-84) gives a ranger
    // in the affected company until the beginning of his company's site phase
    // to tap and cancel it (CRF 22), which spans these steps. The step handler
    // answered the action the engine had just advertised with "Expected 'pass'
    // or 'declare-path' during reveal-new-site step", ending the game: an
    // offered action must never be rejected by the reducer.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RIVER], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn's company is moving to Moria — River is played on its arrival.
    const moriaCard = base.players[RESOURCE_PLAYER].siteDeck[0];
    const moving = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{
            ...base.players[RESOURCE_PLAYER].companies[0],
            destinationSite: { instanceId: moriaCard.instanceId, definitionId: moriaCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
      phaseState: makeMHState(),
    };

    const playResult = reduce(moving, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: handCardId(moving, HAZARD_PLAYER),
      targetCompanyId: companyIdAt(moving, RESOURCE_PLAYER),
    });
    expect(playResult.error).toBeUndefined();

    let current = playResult.state;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();
    expect(current.activeConstraints.some(c => c.kind.type === 'granted-action')).toBe(true);

    // Back at reveal-new-site (a second company's turn to move), the grant is
    // still live and still offered.
    const atReveal = { ...current, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const grants = viableActions(atReveal, PLAYER_1, 'activate-granted-action');
    expect(grants).toHaveLength(1);

    const applied = reduce(atReveal, grants[0].action);
    expect(applied.error).toBeUndefined();
    // Tapping the ranger cancels River: both of its constraints are gone.
    expect(applied.state.activeConstraints.some(c => c.kind.type === 'granted-action')).toBe(false);
    expect(applied.state.activeConstraints.some(c => c.kind.type === 'site-phase-do-nothing')).toBe(false);
  });

  test('Hazard player has no actions during reveal-new-site step', () => {
    // The hazard player cannot act during the reveal-new-site step.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const types = viableActionTypes(state, PLAYER_2);
    expect(types).toHaveLength(0);
  });
});
