/**
 * @module dm-153.test
 *
 * Card test: Palm to Palm (dm-153)
 * Type: hero-resource-event (permanent, wizard alignment)
 * Text: "Playable on a company without a Wizard at a Haven [{H}]. Any
 *   character designated as tapping in support gives +1 to an influence
 *   attempt or to an attempt to remove a corruption card by any other
 *   character in the company. The mind of each character and ally in the
 *   company is increased by one. Discard when any play deck is exhausted, a
 *   Wizard joins the company, or any character in the company splits off
 *   into another company."
 *
 * Effects:
 * | # | Effect                                                    | Status      | Notes                                          |
 * |---|------------------------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | play-target: company, siteType=haven, no Wizard            | IMPLEMENTED | `target.hasWizard` filter context (new)        |
 * | 2 | company-modifier: mind +1 (characters)                     | IMPLEMENTED | collectCompanyPermanentEventEffects resolver   |
 * | 3 | company-modifier: mind +1 (allies), appliesTo: "allies"     | IMPLEMENTED | new `allyEffectiveMind` company lookup         |
 * | 4 | grant-attempt-support: influence / corruption-removal +1   | IMPLEMENTED | new DSL primitive (this certification)         |
 * | 5 | on-event play-deck-exhausted: self-discard                 | IMPLEMENTED | completeDeckExhaust sweep (pre-existing)       |
 * | 6 | on-event company-membership-changes, when hasWizard        | IMPLEMENTED | new `when` support on the sweep                |
 * | 7 | on-event character-splits-off-company: self-discard        | IMPLEMENTED | new sweep (split-company / move-to-company)    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  P1_COMPANY,
  findCharInstanceId, companyIdAt, handCardId,
  dispatch, viableActions,
  playPermanentEventAndResolve,
  attachAllyToChar, attachHazardToChar,
  grantedActionsFor, expectInDiscardPile,
  getCharacter, makeSitePhase, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardInPlay, CardInstanceId, CardDefinitionId,
  InfluenceAttemptAction, ActivateGrantedAction, OpponentInfluenceAttemptAction,
  GameState, EndOfTurnPhaseState,
} from '../../index.js';
import { computeLegalActions } from '../../index.js';

const PALM_TO_PALM = 'dm-153' as CardDefinitionId;
const GANDALF_HERO = 'tw-156' as CardDefinitionId;
const ELVES_OF_LINDON = 'tw-226' as CardDefinitionId; // wizard faction, inf# 10, playable at Grey Havens
const GREY_HAVENS = 'tw-399' as CardDefinitionId;      // haven
const GOLDBERRY = 'tw-245' as CardDefinitionId;        // ally, mind 2
const WOUND_OF_LONG_BURDEN = 'dm-102' as CardDefinitionId; // hazard-event, corruption keyword, remove-self-on-roll threshold 8

function palmInPlay(companyId: ReturnType<typeof companyIdAt>): CardInPlay {
  return { instanceId: 'palm-1' as CardInstanceId, definitionId: PALM_TO_PALM, status: CardStatus.Untapped, companyId };
}

describe('Palm to Palm (dm-153)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: no Wizard + Haven ────────────────────────────────────

  test('playable on a company without a Wizard at a Haven', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [PALM_TO_PALM], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetCompanyId?: unknown }).targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER));
  });

  test('NOT playable on a company that has a Wizard', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GIMLI, { defId: GANDALF_HERO }] }], hand: [PALM_TO_PALM], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a company at a non-Haven site', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GIMLI] }], hand: [PALM_TO_PALM], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('resolves to cardsInPlay with companyId bound to the target company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [PALM_TO_PALM], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, { targetCompanyId: companyId });

    expect(after.players[0].cardsInPlay).toHaveLength(1);
    expect(after.players[0].cardsInPlay[0].companyId).toBe(companyId);
  });

  // ── +1 mind for characters in the company ──────────────────────────────────

  test('+1 mind applied to characters in the Palm to Palm company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [palmInPlay(P1_COMPANY)] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Aragorn's printed mind is 9.
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBe(10);
    // A character in a different company is unaffected.
    expect(getCharacter(state, HAZARD_PLAYER, LEGOLAS).effectiveStats.mind).toBeUndefined();
  });

  // ── +1 mind for allies in the company ──────────────────────────────────────

  test('+1 mind applied to an ally in the Palm to Palm company (opponent-influence target mind)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [palmInPlay(P1_COMPANY)] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    const state = { ...withAlly, phaseState: makeSitePhase(), turnNumber: 3 };
    const allyId = state.players[RESOURCE_PLAYER].characters[findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN)].allies[0].instanceId;

    const attempt = viableActions(state, PLAYER_2, 'opponent-influence-attempt')
      .map(ea => ea.action as OpponentInfluenceAttemptAction)
      .find(a => a.targetInstanceId === allyId && !a.revealedCardInstanceId);

    expect(attempt).toBeDefined();
    // Goldberry's printed mind is 2; Palm to Palm raises it to 3.
    expect(attempt!.explanation).toContain('target mind: 3');
  });

  test('ally mind is unmodified without Palm to Palm in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GOLDBERRY);
    const state = { ...withAlly, phaseState: makeSitePhase(), turnNumber: 3 };
    const allyId = state.players[RESOURCE_PLAYER].characters[findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN)].allies[0].instanceId;

    const attempt = viableActions(state, PLAYER_2, 'opponent-influence-attempt')
      .map(ea => ea.action as OpponentInfluenceAttemptAction)
      .find(a => a.targetInstanceId === allyId && !a.revealedCardInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.explanation).toContain('target mind: 2');
  });

  // ── Tapping in support: influence attempts ─────────────────────────────────

  function buildInfluenceSupportState(): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: GREY_HAVENS, characters: [GIMLI, ARAGORN] }],
          hand: [ELVES_OF_LINDON],
          siteDeck: [MORIA],
          cardsInPlay: [palmInPlay(P1_COMPANY)],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    return { ...base, phaseState: makeSitePhase() };
  }

  test('a company-mate may tap in support of an influence attempt for +1 (need -1)', () => {
    const state = buildInfluenceSupportState();
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === gimliId);

    // Gimli (dwarf, DI 2, +1 DI vs Elf factions): base need =
    // influenceNumber(10) - DI(2) - elf bonus(1) = 7.
    const base = attempts.find(a => a.supportCharacterId === undefined);
    expect(base?.need).toBe(7);

    const supported = attempts.find(a => a.supportCharacterId === aragornId);
    expect(supported).toBeDefined();
    expect(supported!.need).toBe(6);
  });

  test('the support tap changes the outcome of the roll', () => {
    const state = buildInfluenceSupportState();
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === gimliId);
    const base = attempts.find(a => a.supportCharacterId === undefined)!;
    const supported = attempts.find(a => a.supportCharacterId === aragornId)!;

    // A roll of 6 fails the unsupported attempt (need 7)…
    const afterBaseChain = resolveChain(dispatch(state, base));
    const baseRoll = viableActions(afterBaseChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const baseResolved = dispatch({ ...afterBaseChain, cheatRollTotal: 6 }, baseRoll);
    expect(baseResolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInstanceId)).toBe(false);
    expect(baseResolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === factionInstanceId)).toBe(true);

    // …but the same roll of 6 succeeds with support (need 6), and taps the supporter.
    const declared = dispatch(state, supported);
    expect(declared.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
    const afterSupportedChain = resolveChain(declared);
    const supportedRoll = viableActions(afterSupportedChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const supportedResolved = dispatch({ ...afterSupportedChain, cheatRollTotal: 6 }, supportedRoll);
    expect(supportedResolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInstanceId)).toBe(true);
  });

  // ── Tapping in support: corruption-removal attempts ────────────────────────

  function buildCorruptionRemovalSupportState(): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
          cardsInPlay: [palmInPlay(P1_COMPANY)],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    return attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, WOUND_OF_LONG_BURDEN);
  }

  test('a company-mate may tap in support of a corruption-removal attempt', () => {
    const state = buildCorruptionRemovalSupportState();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const offers = grantedActionsFor(state, aragornId, 'remove-self-on-roll', PLAYER_1).filter(a => !a.noTap);
    const base = offers.find(a => a.supportCharacterId === undefined);
    const supported = offers.find(a => a.supportCharacterId === legolasId);
    expect(base).toBeDefined();
    expect(supported).toBeDefined();
  });

  test('failed roll (7) without support, but the same roll succeeds with support (+1)', () => {
    const state = buildCorruptionRemovalSupportState();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const offers = grantedActionsFor(state, aragornId, 'remove-self-on-roll', PLAYER_1).filter(a => !a.noTap);
    const base = offers.find(a => a.supportCharacterId === undefined)!;
    const supported = offers.find(a => a.supportCharacterId === legolasId)!;

    // Threshold is 8: a roll of 7 fails unsupported…
    const baseResult = dispatch({ ...state, cheatRollTotal: 7 }, base);
    expect(baseResult.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(1);

    // …but succeeds (7 + 1 = 8) with a company-mate tapping in support, who is
    // also tapped as the cost.
    const supportedResult = dispatch({ ...state, cheatRollTotal: 7 }, supported);
    expect(supportedResult.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(0);
    expect(supportedResult.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);
    expectInDiscardPile(supportedResult, HAZARD_PLAYER, WOUND_OF_LONG_BURDEN);
  });

  // ── Discard: play deck exhausted ────────────────────────────────────────────

  test('discarded when a play deck exhaust completes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [GIMLI],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
      players: [
        { ...base.players[0], cardsInPlay: [palmInPlay(companyIdAt(base, RESOURCE_PLAYER))] },
        base.players[1],
      ] as typeof base.players,
    };

    const afterExhaust = dispatch(resetHandState, { type: 'deck-exhaust', player: PLAYER_1 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PALM_TO_PALM)).toBe(false);
  });

  // ── Discard: a Wizard joins the company ─────────────────────────────────────

  test('discarded when a Wizard joins the company (move-to-company)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: RIVENDELL, characters: [{ defId: GANDALF_HERO }, GIMLI] },
          ],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const sourceCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);
    const state = {
      ...base,
      players: [
        { ...base.players[0], cardsInPlay: [palmInPlay(targetCompanyId)] },
        base.players[1],
      ] as typeof base.players,
    };
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_HERO);

    const after = dispatch(state, {
      type: 'move-to-company',
      player: PLAYER_1,
      characterInstanceId: gandalfId,
      sourceCompanyId,
      targetCompanyId,
    });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain('palm-1' as CardInstanceId);
  });

  test('NOT discarded when a plain (non-Wizard) character joins the company', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: RIVENDELL, characters: [LEGOLAS, GIMLI] },
          ],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const sourceCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);
    const state = {
      ...base,
      players: [
        { ...base.players[0], cardsInPlay: [palmInPlay(targetCompanyId)] },
        base.players[1],
      ] as typeof base.players,
    };
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const after = dispatch(state, {
      type: 'move-to-company',
      player: PLAYER_1,
      characterInstanceId: legolasId,
      sourceCompanyId,
      targetCompanyId,
    });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PALM_TO_PALM)).toBe(true);
  });

  // ── Discard: a character splits off into another company ──────────────────

  test('discarded when a character splits off from the company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA], cardsInPlay: [palmInPlay(P1_COMPANY)] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sourceCompanyId = companyIdAt(state, RESOURCE_PLAYER, 0);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const after = dispatch(state, {
      type: 'split-company',
      player: PLAYER_1,
      sourceCompanyId,
      characterId: legolasId,
    });

    expect(after.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain('palm-1' as CardInstanceId);
  });
});
