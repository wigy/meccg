/**
 * @module le-195.test
 *
 * Card test: I'll Be At Your Heels (le-195)
 * Type: minion-resource-event (permanent), keyword Command
 * Alignment: ringwraith
 *
 * Text:
 *   "Command. Playable on a leader during the organization phase. Return all
 *    other command cards on target leader to your hand when this card is played.
 *    -2 to leader's direct influence (to a minimum of 0) and +1 to all
 *    corruption checks by characters in his company. You may return this card to
 *    your hand during any organization phase."
 *
 * Sibling of I'll Report You (le-196) and Smart and Secret (le-229): identical
 * shape, differing only in the company-wide bonus (here: +1 to corruption
 * checks by every character in the leader's company, modeled as a
 * `check-modifier` with `target: "company"`).
 *
 * Engine support:
 * | # | Rule                                                    | Status      |
 * |---|---------------------------------------------------------|-------------|
 * | 1 | Playable on a Leader keyword character only             | IMPLEMENTED |
 * | 2 | On-play: bounce other Command cards on that leader      | IMPLEMENTED |
 * | 3 | -2 direct influence (minimum 0) on bearer               | IMPLEMENTED |
 * | 4 | +1 to corruption checks by all chars in leader's company| IMPLEMENTED |
 * | 5 | Return-to-hand grant-action during org phase            | IMPLEMENTED |
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
  grantedActionsFor,
} from '../test-helpers.js';
import type { CardDefinitionId, CorruptionCheckAction } from '../../index.js';
import { Phase } from '../../index.js';
import { enqueueCorruptionCheck } from '../../engine/pending.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** I'll Be At Your Heels — the card under test */
const ILL_BE_AT_YOUR_HEELS = 'le-195' as CardDefinitionId;
/** Lieutenant of Dol Guldur — Leader keyword, DI 3, non-avatar */
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId;
/** Gorbag — Leader keyword, DI 0 (to test min=0 clamp) */
const GORBAG = 'le-11' as CardDefinitionId;
/** The Mouth — no Leader keyword, DI 4 */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Asternak — no Leader keyword, non-avatar companion */
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
        hand: opts.hand ?? [ILL_BE_AT_YOUR_HEELS],
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

describe("I'll Be At Your Heels (le-195)", () => {
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

  test('generates one action per Leader in the company', () => {
    // Two Leaders in the same company → two play actions
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: CIRITH_GORGOR, characters: [LIEUTENANT_DOL_GULDUR, GORBAG] }],
          hand: [ILL_BE_AT_YOUR_HEELS],
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
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    // Only this card itself remains on the leader
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('bounces another Command card already on the leader back to hand', () => {
    const base = orgState({ hand: [ILL_BE_AT_YOUR_HEELS, ILL_BE_AT_YOUR_HEELS] });
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    // Attach first copy directly to simulate a pre-existing Command card
    const withFirstAttached = attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR, ILL_BE_AT_YOUR_HEELS);
    expect(getCharacter(withFirstAttached, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    // Play second copy from hand
    const secondCardId = findHandCardId(withFirstAttached, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const after = playPermanentEventAndResolve(withFirstAttached, PLAYER_1, secondCardId, leaderId);
    // The first copy should be bounced, leaving only the newly played copy
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    // Bounced card ends up in hand
    const handDefIds = after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId as string);
    expect(handDefIds).toContain(ILL_BE_AT_YOUR_HEELS as string);
  });

  // ── Rule 3: -2 direct influence on bearer (min 0) ────────────────────────

  test('-2 DI modifier applied to bearer after attachment', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    const baseDI = (base.cardPool[LIEUTENANT_DOL_GULDUR] as { directInfluence: number }).directInfluence;
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.directInfluence)
      .toBe(baseDI - 2);
  });

  test('-2 DI clamps to 0 when base DI is 0 (Gorbag)', () => {
    const base = orgState({ leader: GORBAG });
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    expect(getCharacter(after, RESOURCE_PLAYER, GORBAG).effectiveStats.directInfluence).toBe(0);
  });

  test('DI modifier removed when card leaves play', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
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

  // ── Rule 4: +1 to corruption checks by all characters in company ──────────

  test('+1 to corruption check by the leader (bearer) after attachment', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    // Baseline: no modifier before the card is played
    const before = enqueueCorruptionCheck(base, {
      source: null, actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      characterId: leaderId, reason: 'test',
    });
    const [beforeAction] = viableActions(before, PLAYER_1, 'corruption-check');
    expect((beforeAction.action as CorruptionCheckAction).corruptionModifier).toBe(0);

    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    const afterLeaderId = findCharInstanceId(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const withCheck = enqueueCorruptionCheck(after, {
      source: null, actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      characterId: afterLeaderId, reason: 'test',
    });
    const [action] = viableActions(withCheck, PLAYER_1, 'corruption-check');
    expect((action.action as CorruptionCheckAction).corruptionModifier).toBe(1);
  });

  test('+1 to corruption check by a companion in the same company', () => {
    const base = orgState({ companyChars: [LIEUTENANT_DOL_GULDUR, ASTERNAK] });
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    const asternakId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    const withCheck = enqueueCorruptionCheck(after, {
      source: null, actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      characterId: asternakId, reason: 'test',
    });
    const [action] = viableActions(withCheck, PLAYER_1, 'corruption-check');
    expect((action.action as CorruptionCheckAction).corruptionModifier).toBe(1);
  });

  test('does not modify corruption checks by characters in another company', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    // The Mouth is in player 2's own company — unaffected
    const mouthId = findCharInstanceId(after, HAZARD_PLAYER, THE_MOUTH);
    const withCheck = enqueueCorruptionCheck(after, {
      source: null, actor: PLAYER_2,
      scope: { kind: 'phase', phase: Phase.Organization },
      characterId: mouthId, reason: 'test',
    });
    const [action] = viableActions(withCheck, PLAYER_2, 'corruption-check');
    expect((action.action as CorruptionCheckAction).corruptionModifier).toBe(0);
  });

  test('corruption bonus removed when card leaves play', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    // Return the card to hand via its grant-action
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    const afterLeaderId = findCharInstanceId(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const withCheck = enqueueCorruptionCheck(after, {
      source: null, actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      characterId: afterLeaderId, reason: 'test',
    });
    const [action] = viableActions(withCheck, PLAYER_1, 'corruption-check');
    expect((action.action as CorruptionCheckAction).corruptionModifier).toBe(0);
  });

  // ── Rule 5: Return-to-hand grant-action ───────────────────────────────────

  test('return-to-hand grant-action available during org phase', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    expect(returnActions.length).toBe(1);
  });

  test('return-to-hand moves card from character items to player hand', () => {
    const base = orgState({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, ILL_BE_AT_YOUR_HEELS);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId);
    expect(getCharacter(attached, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(1);
    expect(attached.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(ILL_BE_AT_YOUR_HEELS);
  });
});
