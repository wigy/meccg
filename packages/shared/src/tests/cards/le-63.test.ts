/**
 * @module le-63.test
 *
 * Card test: The Border-watch (le-63)
 * Type: hazard-creature
 * Race: Men
 * Stats: prowess 7, strikes 5, kill-marshalling-points 1
 * Keyed to (canonical `playable` {f}{b}{F}{B}): border-land {b} or free-domain
 * {f} region types, or free-hold {F} / border-hold {B} site types (a single
 * `keyedTo` entry — the four symbols are independent alternatives, not an AND).
 *
 * "Men. Five strikes (two strikes and detainment against hero companies)."
 *
 * The card's own text bundles a strike-count change with detainment under one
 * "against hero companies" condition. CoE rule 2.IV.vii.F1 (and its
 * 2026-02-07 clarification) says a Fallen-wizard player's companies count as
 * hero companies **when determining whether an attack is detainment** —
 * already implemented via `detainmentAlignmentLabel` (`engine/detainment.ts`)
 * — so the strike-count `stat-modifier` must fire under the same condition to
 * stay consistent with the `combat-detainment` branch it is textually paired
 * with. The self-modifier context's own alignment mapper
 * (`defenderAlignmentLabel`) maps only Wizard players to `"hero"` (Fallen-wizard
 * stays `"fallen-wizard"`, since most "against hero companies" stat text is
 * *not* detainment-coupled and must not silently reach Fallen-wizard
 * defenders) so the strikes modifier's `when` explicitly ORs in
 * `defender.alignment: "fallen-wizard"` to match the detainment branch.
 *
 * Rule coverage:
 *
 * | # | Rule                                                    | Status |
 * |---|----------------------------------------------------------|--------|
 * | 1 | Men, 5 strikes, 7 prowess, border/free region or         | OK     |
 * |   |   free-hold/border-hold site keying                       |        |
 * | 2 | Two strikes and detainment against hero (Wizard)          | OK     |
 * |   |   companies                                                |        |
 * | 3 | Two strikes and detainment against Fallen-wizard          | OK     |
 * |   |   companies (rule 2.IV.vii.F1)                             |        |
 * | 4 | Full 5 strikes, no detainment, against non-hero            | OK     |
 * |   |   (Ringwraith) companies                                   |        |
 *
 * Playable: FULLY — CERTIFIED (2026-09-18).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeBorderMHState, makeMHState,
  companyIdAt,
  playCreatureHazardAndResolve,
  handCardId, viableActions, executeAction,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, Phase, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const BORDER_WATCH = 'le-63' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };

describe('The Border-watch (le-63)', () => {
  beforeEach(() => resetMint());

  test('5 strikes, prowess 7, no detainment against a non-hero (Ringwraith) company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [LAGDUF] }],
          hand: [],
          siteDeck: [CARN_DUM],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BORDER_WATCH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(7);
    expect(afterChain.combat!.creatureRace).toBe('man');
    expect(afterChain.combat!.detainment).toBeFalsy();
  });

  test('two strikes and detainment against a hero (Wizard) company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BORDER_WATCH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('two strikes and detainment against a Fallen-wizard company (rule 2.IV.vii.F1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BORDER_WATCH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('detainment: wounded character is tapped, not wounded/eliminated', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BORDER_WATCH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };

    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    let current = playCreatureHazardAndResolve(ready, PLAYER_2, creatureId, companyId, BORDER_KEYING);
    expect(current.combat!.detainment).toBe(true);
    expect(current.combat!.strikesTotal).toBe(2);

    // Border-watch carries no one-strike-per-character rule, so the
    // defender assigns each of the two strikes, one per character.
    current = executeAction(current, PLAYER_1, 'assign-strike');
    current = executeAction(current, PLAYER_1, 'assign-strike');
    current = executeAction(current, PLAYER_1, 'choose-strike-order');
    current = executeAction(current, PLAYER_1, 'resolve-strike', 2);   // wounds the first character
    current = executeAction(current, PLAYER_1, 'resolve-strike', 12);  // second character beats its strike

    // In detainment, no body check is required; combat ends immediately.
    expect(current.combat).toBeNull();
    const aragornStatus = Object.values(current.players[RESOURCE_PLAYER].characters)
      .find(c => c.definitionId === ARAGORN)?.status;
    expect(aragornStatus).toBe('tapped');
  });

  test('playable when keyed by site-type alone (free-hold), even off the {b}/{f} region path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BORDER_WATCH],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Edoras',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.FreeHold;
    })).toBe(true);
  });
});
