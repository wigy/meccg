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
 * | 4 | on-event: company-membership-changes discard | IMPLEMENTED | sweepCompanyMembershipChangedEvents (discard, split, elimination, Call of Home, corruption-check failure) |
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
  viableActions, dispatch, getCharacter, handCardId, makeMHState,
  companyIdAt, findCharInstanceId,
  playPermanentEventAndResolve, enqueueTransferCorruptionCheck, enqueueCorruptionCheck,
  makeBodyCheckCombat, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  autoMergeNonHavenCompanies,
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

  test('discarded when companies auto-join at the same non-haven site (rule 2.IV.6)', () => {
    // Regression test: a bug report (game mssscni5-8zx0b6, stateSeq 1536) showed
    // two Fellowship cards staying in cardsInPlay after a company auto-joined
    // another of the same player's companies at Beorn's House (a non-haven
    // free-hold) at the end of the movement/hazard phases — autoMergeNonHavenCompanies
    // folded the characters together but never swept `company-membership-changes`
    // events, unlike the explicit merge-companies action.
    const built = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN, LEGOLAS, GIMLI, BILBO] },
            { site: MORIA, characters: [FARAMIR] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    const targetCompanyId = companyIdAt(built, RESOURCE_PLAYER, 0);
    const fellowshipInPlay: CardInPlay = {
      instanceId: 'fellowship-1' as CardInstanceId,
      definitionId: FELLOWSHIP,
      status: CardStatus.Untapped,
      companyId: targetCompanyId,
    };

    // In real play the two companies would share one Moria instance after
    // movement. Mirror that by reusing company 0's currentSite for company 1.
    const sharedMoria = built.players[0].companies[0].currentSite!;
    const state = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedMoria, siteCardOwned: false } : c,
          ),
          cardsInPlay: [fellowshipInPlay],
        },
        built.players[1],
      ] as typeof built.players,
    };

    const merged = autoMergeNonHavenCompanies(state, 0);

    // Companies auto-joined into one…
    expect(merged.players[0].companies).toHaveLength(1);
    expect(merged.players[0].companies[0].characters).toHaveLength(5);
    // …which must discard Fellowship too, since a character joined the company.
    expect(merged.players[0].cardsInPlay).toHaveLength(0);
    expect(merged.players[0].discardPile.map(c => c.instanceId)).toContain('fellowship-1' as CardInstanceId);
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

  // ── Auto-discard when a character fails a corruption check ────────────────

  test('discarded when a character fails a corruption check and leaves the company', () => {
    // Regression test: a bug report (game mth1ahu8-bqdcqv, stateSeq 802) showed
    // Fellowship staying in cardsInPlay after Gimli failed a corruption check
    // (Lure of Expedience) and was discarded out of the company — the
    // pending-resolution corruption-check path removed the character but never
    // swept `company-membership-changes` events, unlike the parallel
    // discardCharacter() and returnCharacterToHand() paths.
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

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const withCheck = enqueueCorruptionCheck(state, PLAYER_1, gimliId);

    // Roll 4 == CP 4: hero fails at CP → discarded (not eliminated).
    const after = dispatch({ ...withCheck, cheatRollTotal: 4 }, {
      type: 'corruption-check',
      player: PLAYER_1,
      characterId: gimliId,
      corruptionPoints: 4,
      corruptionModifier: 0,
      possessions: [],
      need: 5,
      explanation: 'Test',
    });

    // Gimli failed and was discarded out of the company…
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(gimliId);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).not.toContain(gimliId);
    // …which must discard Fellowship too, since a character left the company.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain('fellowship-1' as CardInstanceId);
  });

  // ── Auto-discard when a character returns to hand (Call of Home) ──────────

  test('discarded when a character returns to hand via Call of Home', () => {
    // Regression test: a bug report (game msrnufah-txonis, stateSeq 57) showed
    // Fellowship staying in cardsInPlay after Call of Home sent a company
    // member back to hand — returnCharacterToHand() removed the character from
    // the company but never swept `company-membership-changes` events, unlike
    // the parallel discardCharacter() path.
    const CALL_OF_HOME = 'tw-18' as import('../../index.js').CardDefinitionId;
    const BEORN = 'tw-131' as import('../../index.js').CardDefinitionId;
    const BERETAR = 'tw-143' as import('../../index.js').CardDefinitionId;

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
          companies: [{ site: RIVENDELL, characters: [
            ARAGORN,
            GIMLI,
            { defId: BEORN, items: [] },
            { defId: BERETAR, followerOf: 2 },
          ] }],
          hand: [],
          siteDeck: [MORIA],
          cardsInPlay: [fellowshipInPlay],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [CALL_OF_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // GI used: Aragorn 9 + Gimli 6 + Beorn(slot) 5 = 20. Unused GI = 0.
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const mhState = { ...state, phaseState: makeMHState() };
    const cohId = handCardId(mhState, HAZARD_PLAYER);

    let s = dispatch(mhState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cohId,
      targetCompanyId: P1_COMPANY,
      targetCharacterId: beornId,
    });

    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_1 });
    s = dispatch(s, { type: 'pass-chain-priority', player: PLAYER_2 });

    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('dice-check');

    // Force a low roll (2): 2 + 0 unused GI < 10 → the character returns to hand.
    s = { ...s, cheatRollTotal: 2 };
    const rollActions = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);

    s = dispatch(s, rollActions[0].action);

    // The character left the company back to hand…
    expect(s.players[RESOURCE_PLAYER].hand.map(c => c.definitionId)).toContain(BEORN);
    // …which must discard Fellowship too, since a character left the company.
    expect(s.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(s.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain('fellowship-1' as CardInstanceId);
  });
});
