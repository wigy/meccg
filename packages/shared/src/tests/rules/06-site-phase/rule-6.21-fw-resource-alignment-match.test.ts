/**
 * @module rule-6.21-fw-resource-alignment-match
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.21: Fallen-Wizard Resource Alignment Match
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] For a Fallen-wizard player to play a resource that would normally tap the site, the alignment of the resource being played must match the alignment of the site where it is being played. Wizardhavens and Stage resources count as either alignment for this purpose.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment } from '../../../index.js';
import type { CardDefinitionId, GameState } from '../../../index.js';
import {
  buildTestState, resetMint, makeSitePhase, viableActions,
  PLAYER_1, PLAYER_2, LORIEN, MINAS_TIRITH, ARAGORN,
  Phase,
} from '../../test-helpers.js';
import { ETTENMOORS_HERO } from '../../../card-ids.js';

const HERO_ITEM = 'tw-206' as CardDefinitionId;   // Dagger of Westernesse — hero minor item
const MINION_ITEM = 'le-345' as CardDefinitionId; // Strange Rations — minion minor item
// Deadly Dart (le-419): alignment "dual" — the engine's `siteTapCrossAlignmentBlocked`
// exempts both "stage" and "dual" resources as "either alignment"; no purely
// "stage" minor item exists in the current card pool to isolate that exact
// sub-case (see the deferred test below), so this is the closest reachable
// stand-in for "counts as either alignment."
const DUAL_ITEM = 'le-419' as CardDefinitionId;
// The Ettenmoors is printed once per alignment with identical siteType and
// `playableResources: ['minor']` — a matched hero/minion pair for isolating
// the alignment-match check from any other site difference.
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId;

function fwCompanyAt(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site, characters: [ARAGORN] }], hand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

function playCount(state: GameState, defId: CardDefinitionId): number {
  return viableActions(state, PLAYER_1, 'play-hero-resource')
    .filter(a => {
      const inst = (a.action as { cardInstanceId?: string }).cardInstanceId;
      const card = state.players[0].hand.find(c => (c.instanceId as string) === inst);
      return card?.definitionId === defId;
    }).length;
}

describe('Rule 6.21 — Fallen-Wizard Resource Alignment Match', () => {
  beforeEach(() => resetMint());

  test('a plain hero item is blocked for a Fallen-wizard at the minion Ettenmoors', () => {
    expect(playCount(fwCompanyAt(ETTENMOORS_MINION, [HERO_ITEM]), HERO_ITEM)).toBe(0);
  });

  test('a matching-alignment minion item is playable for a Fallen-wizard at the minion Ettenmoors', () => {
    expect(playCount(fwCompanyAt(ETTENMOORS_MINION, [MINION_ITEM]), MINION_ITEM)).toBe(1);
  });

  test('a plain minion item is blocked for a Fallen-wizard at the hero Ettenmoors', () => {
    expect(playCount(fwCompanyAt(ETTENMOORS_HERO, [MINION_ITEM]), MINION_ITEM)).toBe(0);
  });

  test('an either-alignment (dual) item is playable at the hero Ettenmoors', () => {
    expect(playCount(fwCompanyAt(ETTENMOORS_HERO, [DUAL_ITEM]), DUAL_ITEM)).toBe(1);
  });

  test('the same either-alignment item is equally playable at the minion Ettenmoors', () => {
    expect(playCount(fwCompanyAt(ETTENMOORS_MINION, [DUAL_ITEM]), DUAL_ITEM)).toBe(1);
  });

  // "Stage resources count as either alignment" — the only two Stage items
  // in the current pool (Keys of Orthanc wh-88, Keys to the White Towers
  // wh-89) both have an empty `playableAt` and a "special" subtype no site's
  // `playableResources` list includes, so neither is reachable as a viable
  // play with any site. The engine's `siteTapCrossAlignmentBlocked` treats
  // "stage" identically to "dual" (exercised above), but isolating the
  // Stage case specifically needs a certified Stage item that is actually
  // playable somewhere.
  test.todo('a Stage-aligned item is playable at both a hero-aligned and minion-aligned site');

  // The mirror case — a plain (non-Stage, non-dual) resource being playable
  // at a Wizardhaven regardless of its own alignment — also has no
  // exercising card: all four Fallen-wizard sites (wh-55/56/57/58) list no
  // playable resources, and the only resource whose `playableAt` names a
  // Wizardhaven (Radagast's Black Bird, wh-114) is itself Stage-aligned, so
  // it can't isolate the site-side exemption from the resource-side one.
  test.todo('a non-Stage resource is playable at a Wizardhaven regardless of its own alignment');
});
