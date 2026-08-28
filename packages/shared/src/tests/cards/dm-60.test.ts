/**
 * @module dm-60.test
 *
 * Card test: Gnaw with Words (dm-60)
 * Type: hazard-event (short)
 * Effects: 2 (tap-character filter skills:$includes[sage] requiresCompanionSkill:sage,
 *             tap-character filter skills:$includes[diplomat] requiresCompanionSkill:diplomat)
 *
 * "Tap a sage if another sage is in his company or at his current site or at
 *  his new site. Alternatively, tap a diplomat if another diplomat is in his
 *  company or at his current site or at his new site."
 *
 * - Mode A (sage): one action per untapped sage in the resource player's
 *   companies for which some *other* character carrying the sage skill is in
 *   the same company, at the company's current site, or at its destination
 *   site (`requiresCompanionSkill: "sage"`, backed by `hasNearbySkillmate`).
 * - Mode B (diplomat): the same shape gated on the diplomat skill instead.
 * - A candidate lacking a same-skill companion anywhere is not offered, even
 *   if he himself has the matching skill.
 * - Companion presence at a site is checked across both players' companies,
 *   by site name.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, resolveChain, viableActions,
  makeMHState, handCardId, findCharInstanceId, setCharStatus,
  expectCharStatus, expectInDiscardPile,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, P1_COMPANY,
  Phase, CardStatus, RIVENDELL, MORIA, LORIEN, BALIN, FRODO,
} from '../test-helpers.js';
import type { GameState, CardInstanceId, CardDefinitionId, PlayHazardAction } from '../../index.js';

const GNAW_WITH_WORDS = 'dm-60' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId; // hero-character, warrior/scout/sage/diplomat
const GLOIN = 'tw-160' as CardDefinitionId;   // hero-character, warrior/diplomat (no sage)

/** targetCharacterId of a play-hazard evaluated action. */
function targetOf(a: { action: unknown }): CardInstanceId | undefined {
  return (a.action as PlayHazardAction).targetCharacterId;
}

describe('Gnaw with Words (dm-60)', () => {
  beforeEach(() => resetMint());

  // ─── no companion anywhere → not offered ───────────────────────────────────

  test('not playable against a lone sage with no other sage or diplomat anywhere', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('a sage-and-diplomat pair with no matching companion skill does not qualify either character', () => {
    // Balin (sage only) and Frodo (diplomat only) share a company, but neither
    // carries the *other's* skill — sage-mode needs another sage, diplomat-mode
    // needs another diplomat, and there is exactly one of each.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN, FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── companion in the same company ─────────────────────────────────────────

  test('offers both sages when two sages share a company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const balinId = findCharInstanceId(mhState, RESOURCE_PLAYER, BALIN);
    const gandalfId = findCharInstanceId(mhState, RESOURCE_PLAYER, GANDALF);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = actions.map(targetOf);

    expect(targets).toContain(balinId);
    expect(targets).toContain(gandalfId);
    expect(actions).toHaveLength(2);
  });

  test('offers a diplomat when another diplomat shares his company', () => {
    // Frodo (diplomat only) + Glóin (diplomat only): mirrors the sage case for
    // the "Alternatively, tap a diplomat" mode.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, GLOIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const frodoId = findCharInstanceId(mhState, RESOURCE_PLAYER, FRODO);
    const gloinId = findCharInstanceId(mhState, RESOURCE_PLAYER, GLOIN);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = actions.map(targetOf);

    expect(targets).toContain(frodoId);
    expect(targets).toContain(gloinId);
    expect(actions).toHaveLength(2);
  });

  // ─── companion at the character's current site (different company) ────────

  test('offers a lone sage when another sage is at his current site in a different (opponent) company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const balinId = findCharInstanceId(mhState, RESOURCE_PLAYER, BALIN);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');

    expect(actions).toHaveLength(1);
    expect(targetOf(actions[0])).toBe(balinId);
  });

  test('does not offer a lone sage when the companion at the same site is a diplomat, not a sage', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GLOIN] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── companion at the character's new (destination) site ──────────────────

  test('offers a lone moving sage when another sage already occupies his destination site', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [BALIN], destinationSite: MORIA },
            { site: MORIA, characters: [GANDALF] },
          ],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const balinId = findCharInstanceId(mhState, RESOURCE_PLAYER, BALIN);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');

    expect(actions).toHaveLength(1);
    expect(targetOf(actions[0])).toBe(balinId);
  });

  // ─── untapped-only ──────────────────────────────────────────────────────────

  test('does not offer an already-tapped sage even with a qualifying companion', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const tapped = setCharStatus(state, RESOURCE_PLAYER, BALIN, CardStatus.Tapped);
    const mhState: GameState = { ...tapped, phaseState: makeMHState() };

    const balinId = findCharInstanceId(mhState, RESOURCE_PLAYER, BALIN);
    const gandalfId = findCharInstanceId(mhState, RESOURCE_PLAYER, GANDALF);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = actions.map(targetOf);

    expect(targets).not.toContain(balinId);
    expect(targets).toContain(gandalfId);
  });

  // ─── Resolution: taps the chosen character, card goes to discard ──────────

  test('taps the chosen sage on resolution and discards the card', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BALIN, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [GNAW_WITH_WORDS], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const balinId = findCharInstanceId(mhState, RESOURCE_PLAYER, BALIN);
    const gnawId = handCardId(mhState, HAZARD_PLAYER);

    const afterPlay = dispatch(mhState, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: gnawId,
      targetCompanyId: P1_COMPANY, targetCharacterId: balinId,
    });
    const resolved = resolveChain(afterPlay);

    expectCharStatus(resolved, RESOURCE_PLAYER, BALIN, CardStatus.Tapped);
    expectCharStatus(resolved, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);
    expectInDiscardPile(resolved, HAZARD_PLAYER, GNAW_WITH_WORDS);
    expect(resolved.players[HAZARD_PLAYER].hand).toHaveLength(0);
  });
});
