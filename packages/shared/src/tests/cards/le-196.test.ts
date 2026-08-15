/**
 * @module le-196.test
 *
 * Card test: I'll Report You (le-196)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Command. Playable on a leader during the organization phase. Return all
 *    other command cards on target leader to your hand when this card is played.
 *    -2 to leader's direct influence (to a minimum of 0) and +1 prowess to all
 *    characters in his company. You may return this card to your hand during any
 *    organization phase."
 *
 * Engine support:
 * | # | Rule                                               | Status      |
 * |---|----------------------------------------------------|-------------|
 * | 1 | Playable on a Leader keyword character only        | IMPLEMENTED |
 * | 2 | On-play: bounce other Command cards on that leader | IMPLEMENTED |
 * | 3 | -2 direct influence (minimum 0) on bearer          | IMPLEMENTED |
 * | 4 | +1 prowess to all characters in bearer's company   | IMPLEMENTED |
 * | 5 | Return-to-hand grant-action during org phase       | IMPLEMENTED |
 * | 6 | Organization-phase-only play window                | IMPLEMENTED |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  attachItemToChar,
  playPermanentEventAndResolve,
  dispatch,
  getCharacter,
  baseProwess,
  grantedActionsFor,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, SitePhaseState } from '../../index.js';
import { Phase } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** I'll Report You — the card under test */
const ILL_REPORT_YOU = 'le-196' as CardDefinitionId;
/** Lieutenant of Dol Guldur — Leader keyword, DI 3 */
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId;
/** Gorbag — Leader keyword, DI 0 (to test min=0 clamp) */
const GORBAG = 'le-11' as CardDefinitionId;
/** The Mouth — no Leader keyword, DI 4 */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Asternak — no Leader keyword */
const ASTERNAK = 'le-1' as CardDefinitionId;
/** Cirith Gorgor — minion dark-hold site */
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;
/** Ettenmoors — minion ruins-and-lairs site */
const ETTENMOORS = 'le-373' as CardDefinitionId;

// ── State builder ─────────────────────────────────────────────────────────────

function orgState(opts: {
  leader?: CardDefinitionId;
  site?: CardDefinitionId;
  companyChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
}) {
  const leader = opts.leader ?? LIEUTENANT_DOL_GULDUR;
  const site = opts.site ?? CIRITH_GORGOR;
  const extra = (opts.companyChars ?? []).filter(c => c !== leader);
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [leader, ...extra] }],
        hand: opts.hand ?? [ILL_REPORT_YOU],
        siteDeck: [CIRITH_GORGOR],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: ETTENMOORS, characters: [THE_MOUTH] }],
        hand: [],
        siteDeck: [ETTENMOORS],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

describe("I'll Report You (le-196)", () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playability — only on Leaders ────────────────────────────────

  test('playable on a character with the Leader keyword', () => {
    const state = orgState({});
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const target = (actions[0].action as { targetCharacterId?: unknown }).targetCharacterId;
    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    expect(target).toBe(leaderId);
  });

  test('NOT playable on a character without the Leader keyword', () => {
    const state = orgState({ leader: THE_MOUTH });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('Gorbag (Leader keyword) is a valid target', () => {
    const state = orgState({ leader: GORBAG });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
  });

  test('generates one action per Leader in the company', () => {
    // Two Leaders in the same company → two play actions
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: CIRITH_GORGOR, characters: [LIEUTENANT_DOL_GULDUR, GORBAG] }],
          hand: [ILL_REPORT_YOU],
          siteDeck: [CIRITH_GORGOR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: ETTENMOORS, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [ETTENMOORS],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(2);
  });

  // ── Rule 2: On-play bounce of other Command cards ─────────────────────────

  test('entering play does not bounce any cards when leader has no other Command cards', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    // Only I'll Report You itself remains on the leader
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('bounces another Command card already on the leader back to hand', () => {
    const base = orgState({ hand: [ILL_REPORT_YOU, ILL_REPORT_YOU] });
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    // Attach first copy directly to simulate a pre-existing Command card
    const withFirstAttached = attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR, ILL_REPORT_YOU);
    expect(getCharacter(withFirstAttached, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    // Play second copy from hand
    const secondCardId = findHandCardId(withFirstAttached, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const after = playPermanentEventAndResolve(withFirstAttached, PLAYER_1, secondCardId, leaderId);
    // The first copy should be bounced, leaving only the newly played copy
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    // Bounced card ends up in hand
    const handDefIds = after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId as string);
    expect(handDefIds).toContain(ILL_REPORT_YOU as string);
  });

  // ── Rule 3: -2 direct influence on bearer (min 0) ────────────────────────

  test('-2 DI modifier applied to bearer after attachment', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    const baseDI = (base.cardPool[LIEUTENANT_DOL_GULDUR] as { directInfluence: number }).directInfluence;
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.directInfluence)
      .toBe(baseDI - 2);
  });

  test('-2 DI clamps to 0 when base DI is 0 (Gorbag)', () => {
    const base = orgState({ leader: GORBAG });
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    expect(getCharacter(after, RESOURCE_PLAYER, GORBAG).effectiveStats.directInfluence).toBe(0);
  });

  test('DI modifier removed when card leaves play', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    const baseDI = (base.cardPool[LIEUTENANT_DOL_GULDUR] as { directInfluence: number }).directInfluence;
    expect(getCharacter(attached, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.directInfluence)
      .toBe(baseDI - 2);
    // Return card to hand via grant-action
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.directInfluence)
      .toBe(baseDI);
  });

  // ── Rule 4: +1 prowess to all characters in company ──────────────────────

  test('+1 prowess to leader after attachment', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.prowess)
      .toBe(baseProwess(LIEUTENANT_DOL_GULDUR) + 1);
  });

  test('+1 prowess to companion in same company', () => {
    const base = orgState({ companyChars: [LIEUTENANT_DOL_GULDUR, ASTERNAK] });
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    expect(getCharacter(after, RESOURCE_PLAYER, ASTERNAK).effectiveStats.prowess)
      .toBe(baseProwess(ASTERNAK) + 1);
  });

  test('+1 prowess does not affect characters in other companies', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    // THE_MOUTH is in player 2's company
    expect(getCharacter(after, HAZARD_PLAYER, THE_MOUTH).effectiveStats.prowess)
      .toBe(baseProwess(THE_MOUTH));
  });

  test('prowess bonus removed when card leaves play', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    expect(getCharacter(attached, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.prowess)
      .toBe(baseProwess(LIEUTENANT_DOL_GULDUR) + 1);
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.prowess)
      .toBe(baseProwess(LIEUTENANT_DOL_GULDUR));
  });

  // ── Rule 5: Return-to-hand grant-action ───────────────────────────────────

  test('return-to-hand grant-action available during org phase', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    expect(returnActions.length).toBe(1);
  });

  test('return-to-hand moves card from character items to player hand', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_REPORT_YOU);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    expect(getCharacter(attached, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    expect(attached.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(ILL_REPORT_YOU);
  });

  // ── Rule 6: organization phase only ───────────────────────────────────────

  test('NOT offered during the movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: CIRITH_GORGOR, characters: [LIEUTENANT_DOL_GULDUR] }],
          hand: [ILL_REPORT_YOU],
          siteDeck: [CIRITH_GORGOR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: ETTENMOORS, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [ETTENMOORS],
          playDeck: makePlayDeck(),
        },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT offered during the site phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: CIRITH_GORGOR, characters: [LIEUTENANT_DOL_GULDUR] }],
          hand: [ILL_REPORT_YOU],
          siteDeck: [CIRITH_GORGOR],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          companies: [{ site: ETTENMOORS, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [ETTENMOORS],
          playDeck: makePlayDeck(),
        },
      ],
    });
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const state: GameState = { ...base, phaseState: sitePhaseState };
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('offered during the organization phase', () => {
    const state = orgState({});
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });
});
