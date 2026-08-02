/**
 * @module tw-77.test
 *
 * Card test: Orc-warriors (tw-77)
 * Type: hazard-creature (Orcs), non-unique.
 *
 * Card text: "Orcs. Three strikes."
 *
 * Base stats: strikes 3, prowess 7, no body, kill MP 1.
 * Canonical playable cost (data/cards.json TW-77): {b}{w}{R} — keyable to a
 * Border-land or Wilderness region, or at a Ruins & Lairs site (the three
 * symbols are alternatives, matching the single `keyedTo` entry with
 * `regionTypes: [wilderness, border]` + `siteTypes: [ruins-and-lairs]`).
 *
 * Orc-warriors carries no special effects beyond its printed stats and
 * keying — this test verifies the base combat it triggers and every
 * alternative keying offered.
 *
 * Playable: YES
 * Certified: 2026-08-02
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState, makeBorderMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, viableActions,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, MovementHazardPhaseState,
  PlayHazardAction,
} from '../../index.js';

const ORC_WARRIORS = 'tw-77' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

/** P1 (active) has one company at `site`; P2 holds Orc-warriors in hand. */
function readyState(opts: {
  site?: CardDefinitionId;
  phaseState?: MovementHazardPhaseState;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site ?? MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [ORC_WARRIORS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  return { ...state, phaseState: opts.phaseState ?? makeWildernessMHState() };
}

/** Every `keyedBy` descriptor the hazard player is offered for `instanceId`. */
function keyingsOffered(state: GameState, instanceId: CardInstanceId) {
  return viableActions(state, PLAYER_2, 'play-hazard')
    .map(ea => ea.action as PlayHazardAction)
    .filter(a => a.cardInstanceId === instanceId)
    .map(a => a.keyedBy)
    .filter((k): k is NonNullable<typeof k> => k !== undefined);
}

describe('Orc-warriors (tw-77)', () => {
  beforeEach(() => resetMint());

  // ─── "Orcs. Three strikes." ─────────────────────────────────────────────

  test('initiates combat with 3 strikes and 7 prowess', () => {
    const ready = readyState({});
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(7);
    expect(afterChain.combat!.creatureRace).toBe('orc');
  });

  // ─── Keying: {b}{w}{R} ───────────────────────────────────────────────────

  test('keyable to a Wilderness ({w})', () => {
    const ready = readyState({ phaseState: makeWildernessMHState() });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    expect(keyingsOffered(ready, cardId)).toContainEqual(
      { method: 'region-type', value: RegionType.Wilderness },
    );
  });

  test('keyable to a Border-land ({b})', () => {
    const ready = readyState({ phaseState: makeBorderMHState() });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    expect(keyingsOffered(ready, cardId)).toContainEqual(
      { method: 'region-type', value: RegionType.Border },
    );
  });

  test('keyable at a Ruins & Lairs ({R}) reached through a Free-domain path', () => {
    // A pure Free-domain path cannot satisfy the {w}/{b} arms, isolating {R}.
    const ready = readyState({
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['The Shire'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Bandit Lair',
      }),
    });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const keyings = keyingsOffered(ready, cardId);
    expect(keyings).toContainEqual({ method: 'site-type', value: SiteType.RuinsAndLairs });
    expect(keyings.some(k => k.method === 'region-type')).toBe(false);
  });

  test('not keyable through a Free-domain path to a Free-hold (none of {b}{w}{R})', () => {
    const ready = readyState({
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['The Shire'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Bag End',
      }),
    });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    expect(keyingsOffered(ready, cardId)).toHaveLength(0);
  });

  test('end to end: keyed via Border-land, defender assigns strikes', () => {
    const ready = readyState({ phaseState: makeBorderMHState() });
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, cardId, companyId, BORDER_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(7);
  });
});
