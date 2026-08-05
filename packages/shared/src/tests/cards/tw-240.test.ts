/**
 * @module tw-240.test
 *
 * Card test: Fellowship (tw-240)
 * Type: hero-resource-event (permanent)
 * Text: "Only playable at a Haven [{H}] during the organization phase on a
 *   company that has four or more characters and allies. +1 to prowess and
 *   +1 to corruption checks for all characters and allies in the company.
 *   Discard this card if a character or ally joins or leaves the company
 *   for any reason."
 *
 * Effects:
 * | # | Effect                                     | Status      | Notes                                         |
 * |---|--------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | play-target: company, siteType=haven, 4+   | IMPLEMENTED | filter in organization-events legal actions   |
 * | 2 | company-modifier: prowess +1               | IMPLEMENTED | collectCompanyPermanentEventEffects resolver  |
 * | 3 | company-modifier: corruption check +1      | IMPLEMENTED | synthesised check-modifier in resolver        |
 * | 4 | on-event: company-membership-changes discard | IMPLEMENTED | sweepCompanyMembershipChangedEvents           |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  P1_COMPANY,
  baseProwess,
  buildTestState, resetMint,
  viableActions, dispatch, getCharacter, handCardId,
  companyIdAt, findCharInstanceId,
  playPermanentEventAndResolve, enqueueTransferCorruptionCheck,
  makeBodyCheckCombat, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CorruptionCheckAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const FELLOWSHIP = 'tw-240' as import('../../index.js').CardDefinitionId;

describe('Fellowship (tw-240)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: Haven + 4+ members ───────────────────────────────────

  test('playable on a company with 4 characters at a Haven', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetCompanyId?: unknown }).targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER));
  });

  test('not playable on a company with only 3 characters', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not playable on a company at a non-Haven site', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [FELLOWSHIP], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not playable during the site phase, even on a qualifying company at a Haven', () => {
    const state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not playable during the movement/hazard phase, even on a qualifying company at a Haven', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── After resolve: card in cardsInPlay with companyId set ──────────────────

  test('resolves to cardsInPlay with companyId bound to the target company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [FELLOWSHIP], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const fellowshipId = handCardId(state, RESOURCE_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(state, PLAYER_1, fellowshipId, undefined, { targetCompanyId: companyId });

    expect(after.players[0].cardsInPlay).toHaveLength(1);
    const inPlay = after.players[0].cardsInPlay[0];
    expect(inPlay.instanceId).toBe(fellowshipId);
    expect(inPlay.companyId).toBe(companyId);
  });

  // ── +1 prowess for all company members ────────────────────────────────────

  test('+1 prowess applied to all characters in the Fellowship company', () => {
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA], cardsInPlay: [fellowshipInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Both chars in the Fellowship company get +1 prowess
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
    expect(getCharacter(state, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS) + 1);

    // Character in a different company (P2) is unaffected
    expect(getCharacter(state, HAZARD_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI));
  });

  test('+1 prowess does not affect characters in other companies', () => {
    // Two companies for P1; Fellowship only on company 0
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN, BILBO] },
            { site: LORIEN, characters: [LEGOLAS, GIMLI] },
          ],
          hand: [],
          siteDeck: [MORIA],
          cardsInPlay: [fellowshipInPlay],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [FARAMIR] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Company 0 members get +1
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
    expect(getCharacter(state, RESOURCE_PLAYER, BILBO).effectiveStats.prowess).toBe(baseProwess(BILBO) + 1);

    // Company 1 members are unaffected
    expect(getCharacter(state, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(baseProwess(LEGOLAS));
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(baseProwess(GIMLI));
  });

  // ── +1 corruption check modifier ──────────────────────────────────────────

  test('+1 corruption check modifier applied to characters in the Fellowship company', () => {
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA], cardsInPlay: [fellowshipInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    // Use a dummy item instance for the transfer source (just needs to be a CardInstanceId)
    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, aragornId, 'dummy-item' as CardInstanceId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(aragornId);
    // Fellowship grants +1 to corruption checks
    expect(ccActions[0].corruptionModifier).toBe(1);
  });

  // ── Auto-discard when character joins the company ─────────────────────────

  test('discarded when a character joins the company (play-character)', () => {
    // Fellowship is pre-placed in cardsInPlay; then a character is played to the company
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [FARAMIR], siteDeck: [MORIA], cardsInPlay: [fellowshipInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }, { site: MINAS_TIRITH, characters: [FARAMIR] }], hand: [], siteDeck: [] },
      ],
    });

    // Get Rivendell site instance to pass as atSite
    const rivendellInstId = state.players[0].companies[0].currentSite!.instanceId;
    const faramirInstId = handCardId(state, RESOURCE_PLAYER);

    const after = dispatch(state, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: faramirInstId,
      atSite: rivendellInstId,
      controlledBy: 'general',
    });

    // Fellowship is discarded when company membership changes
    expect(after.players[0].cardsInPlay).toHaveLength(0);
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain('fellowship-1' as CardInstanceId);
  });

  // ── Auto-discard when companies merge ─────────────────────────────────────

  test('discarded when companies merge (characters join the Fellowship company)', () => {
    // Build a state with a company, split it to get two companies sharing the
    // same site instance, then play Fellowship on the larger piece.
    const baseState = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO, FARAMIR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Split off FARAMIR to create a second company at Rivendell (same site instance)
    const sourceCompanyId = companyIdAt(baseState, RESOURCE_PLAYER, 0);
    const faramirId = findCharInstanceId(baseState, RESOURCE_PLAYER, FARAMIR);
    const splitState = dispatch(baseState, {
      type: 'split-company',
      player: PLAYER_1,
      sourceCompanyId,
      characterId: faramirId,
    });

    // Now place Fellowship on the original company (company 0)
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: sourceCompanyId,
    };
    const stateWithFellowship = {
      ...splitState,
      players: [
        { ...splitState.players[0], cardsInPlay: [fellowshipInPlay] },
        splitState.players[1],
      ] as typeof splitState.players,
    };

    // Merge the split-off company back into the original
    const newCompanyId = companyIdAt(stateWithFellowship, RESOURCE_PLAYER, 1);
    const after = dispatch(stateWithFellowship, {
      type: 'merge-companies',
      player: PLAYER_1,
      sourceCompanyId: newCompanyId,
      targetCompanyId: sourceCompanyId,
    });

    // Fellowship discarded because the target company gained a member
    expect(after.players[0].cardsInPlay).toHaveLength(0);
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain('fellowship-1' as CardInstanceId);
  });

  // ── Auto-discard when a company is split ──────────────────────────────────

  test('discarded when a character splits off from the company', () => {
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [], siteDeck: [MORIA], cardsInPlay: [fellowshipInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const sourceCompanyId = companyIdAt(state, RESOURCE_PLAYER, 0);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const after = dispatch(state, {
      type: 'split-company',
      player: PLAYER_1,
      sourceCompanyId,
      characterId: bilboId,
    });

    // Fellowship is discarded when company membership changes
    expect(after.players[0].cardsInPlay).toHaveLength(0);
    expect(after.players[0].discardPile.map(c => c.instanceId)).toContain('fellowship-1' as CardInstanceId);
  });

  // ── Auto-discard when a character is eliminated in combat ─────────────────

  test('discarded when a character is eliminated by a failed body check', () => {
    // Fellowship is bound to a 4-character company; Bilbo (body 9) is wounded
    // and about to fail his body check (forced roll 12, no discardBodyCheck
    // match), which eliminates him and removes him from the company.
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] }], hand: [], siteDeck: [MORIA], cardsInPlay: [fellowshipInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const wounded = setCharStatus(state, RESOURCE_PLAYER, BILBO, CardStatus.Inverted);
    const ready = {
      ...wounded,
      combat: makeBodyCheckCombat({ companyId: P1_COMPANY, characterId: bilboId, defendingPlayerId: PLAYER_1, attackingPlayerId: PLAYER_2 }),
      cheatRollTotal: 12,
    };

    const after = dispatch(ready, viableActions(ready, PLAYER_2, 'body-check-roll')[0].action);

    // Bilbo was eliminated and removed from the company…
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === bilboId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).not.toContain(bilboId);
    // …which must discard Fellowship too, since a character left the company.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain('fellowship-1' as CardInstanceId);
  });
});
