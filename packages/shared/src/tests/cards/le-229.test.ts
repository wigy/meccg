/**
 * @module le-229.test
 *
 * Card test: Smart and Secret (le-229)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Command. Playable on a leader during the organization phase. Return all
 *    other command cards on target leader to your hand when this card is played.
 *    -2 to leader's direct influence (to a minimum of 0) and +1 body to all
 *    characters in his company. You may return this card to your hand during any
 *    organization phase."
 *
 * Engine support:
 * | # | Rule                                               | Status      |
 * |---|----------------------------------------------------|-------------|
 * | 1 | Playable on a Leader keyword character only        | IMPLEMENTED |
 * | 2 | On-play: bounce other Command cards on that leader | IMPLEMENTED |
 * | 3 | -2 direct influence (minimum 0) on bearer          | IMPLEMENTED |
 * | 4 | +1 body to all characters in bearer's company      | IMPLEMENTED |
 * | 5 | Return-to-hand grant-action during org phase       | IMPLEMENTED |
 * | 6 | Organization-phase-only play window                | IMPLEMENTED |
 *
 * Regression (game mvttav2f-m8pdzp): the card had no DSL effects, so it was
 * played as an untargeted general permanent event (even at end-of-turn)
 * instead of attaching to a leader.
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
  baseBody,
  grantedActionsFor,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase } from '../../index.js';

// ── Local card-ID constants ───────────────────────────────────────────────────

/** Smart and Secret — the card under test */
const SMART_AND_SECRET = 'le-229' as CardDefinitionId;
/** I'll Report You — another Command card */
const ILL_REPORT_YOU = 'le-196' as CardDefinitionId;
/** Lieutenant of Dol Guldur — Leader keyword, DI 3 */
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId;
/** Gorbag — Leader keyword, DI 0 (to test min=0 clamp) */
const GORBAG = 'le-11' as CardDefinitionId;
/** The Mouth — no Leader keyword */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Asternak — no Leader keyword */
const ASTERNAK = 'le-1' as CardDefinitionId;
/** Cirith Gorgor — minion dark-hold site */
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;
/** Ettenmoors — minion ruins-and-lairs site */
const ETTENMOORS = 'le-373' as CardDefinitionId;

// ── State builder ─────────────────────────────────────────────────────────────

function stateFor(opts: {
  leader?: CardDefinitionId;
  companyChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  phase?: Phase;
}) {
  const leader = opts.leader ?? LIEUTENANT_DOL_GULDUR;
  const extra = (opts.companyChars ?? []).filter(c => c !== leader);
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: opts.phase ?? Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: CIRITH_GORGOR, characters: [leader, ...extra] }],
        hand: opts.hand ?? [SMART_AND_SECRET],
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

function playOnLeader(opts: Parameters<typeof stateFor>[0] = {}) {
  const base = stateFor(opts);
  const leader = opts.leader ?? LIEUTENANT_DOL_GULDUR;
  const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, leader);
  const cardId = findHandCardId(base, RESOURCE_PLAYER, SMART_AND_SECRET);
  return { base, leaderId, after: playPermanentEventAndResolve(base, PLAYER_1, cardId, leaderId) };
}

describe('Smart and Secret (le-229)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Playability — only on Leaders ────────────────────────────────

  test('play action targets the leader, not the general area', () => {
    const state = stateFor({});
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const target = (actions[0].action as { targetCharacterId?: unknown }).targetCharacterId;
    expect(target).toBe(findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR));
  });

  test('NOT playable on a character without the Leader keyword', () => {
    const state = stateFor({ leader: THE_MOUTH });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('attaches to the leader instead of the general cards-in-play area', () => {
    const { after } = playOnLeader();
    const items = getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items;
    expect(items.map(i => i.definitionId)).toEqual([SMART_AND_SECRET]);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId))
      .not.toContain(SMART_AND_SECRET);
  });

  // ── Rule 2: On-play bounce of other Command cards ─────────────────────────

  test('bounces another Command card already on the leader back to hand', () => {
    const base = stateFor({});
    const leaderId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR);
    const withOther = attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR, ILL_REPORT_YOU);
    const cardId = findHandCardId(withOther, RESOURCE_PLAYER, SMART_AND_SECRET);
    const after = playPermanentEventAndResolve(withOther, PLAYER_1, cardId, leaderId);
    const items = getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items;
    expect(items.map(i => i.definitionId)).toEqual([SMART_AND_SECRET]);
    expect(after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId)).toContain(ILL_REPORT_YOU);
  });

  // ── Rule 3: -2 direct influence on bearer (min 0) ────────────────────────

  test('-2 DI on the leader', () => {
    const { base, after } = playOnLeader();
    const baseDI = (base.cardPool[LIEUTENANT_DOL_GULDUR] as { directInfluence: number }).directInfluence;
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.directInfluence)
      .toBe(baseDI - 2);
  });

  test('-2 DI clamps to 0 (Gorbag)', () => {
    const { after } = playOnLeader({ leader: GORBAG });
    expect(getCharacter(after, RESOURCE_PLAYER, GORBAG).effectiveStats.directInfluence).toBe(0);
  });

  // ── Rule 4: +1 body to all characters in company ─────────────────────────

  test('+1 body to the leader and companions, not other companies', () => {
    const { after } = playOnLeader({ companyChars: [ASTERNAK] });
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.body)
      .toBe(baseBody(LIEUTENANT_DOL_GULDUR) + 1);
    expect(getCharacter(after, RESOURCE_PLAYER, ASTERNAK).effectiveStats.body)
      .toBe(baseBody(ASTERNAK) + 1);
    expect(getCharacter(after, HAZARD_PLAYER, THE_MOUTH).effectiveStats.body)
      .toBe(baseBody(THE_MOUTH));
  });

  // ── Rule 5: Return-to-hand grant-action ───────────────────────────────────

  test('return-to-hand moves the card back and removes its modifiers', () => {
    const { leaderId, after: attached } = playOnLeader();
    const returnActions = grantedActionsFor(attached, leaderId, 'return-self-to-hand', PLAYER_1);
    expect(returnActions).toHaveLength(1);
    const after = dispatch(attached, returnActions[0]);
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand.map(c => c.definitionId)).toEqual([SMART_AND_SECRET]);
    expect(getCharacter(after, RESOURCE_PLAYER, LIEUTENANT_DOL_GULDUR).effectiveStats.body)
      .toBe(baseBody(LIEUTENANT_DOL_GULDUR));
  });

  // ── Rule 6: organization phase only ───────────────────────────────────────

  test('NOT offered during the movement/hazard phase', () => {
    const state = stateFor({ phase: Phase.MovementHazard });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT offered during the end-of-turn phase', () => {
    const state = stateFor({ phase: Phase.EndOfTurn });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });
});
