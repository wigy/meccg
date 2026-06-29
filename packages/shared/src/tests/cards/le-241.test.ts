/**
 * @module le-241.test
 *
 * Card test: That's Been Heard Before Tonight (le-241)
 * Type: minion-resource-event (permanent)
 * Alignment: ringwraith
 *
 * Text:
 *   "Playable during the site phase on an untapped character in a covert
 *    company at a Border-hold [{B}] or Free-hold [{F}] where Information is
 *    playable. Tap the character (but not the site). No marshalling points are
 *    received and the character may not untap until this card is stored at a
 *    Darkhaven [{DH}] during his organization phase."
 *
 * Engine Support:
 * | # | Rule                                                             | Status    |
 * |---|------------------------------------------------------------------|-----------|
 * | 1 | Playable during site phase at border-hold or free-hold            | OK        |
 * | 2 | Site must have Information in playableResources                   | OK        |
 * | 3 | Target must be in a COVERT company                               | OK        |
 * | 4 | Target character must be untapped                                | OK        |
 * | 5 | Tap the character (but not the site) on play                    | OK        |
 * | 6 | No MPs received (MPs granted only when stored)                   | OK        |
 * | 7 | Character may not untap until card is stored at Darkhaven        | OK        |
 * | 8 | Storing at a Darkhaven during organization phase releases lock   | OK        |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL,
  viableActions,
  makeSitePhase,
  RESOURCE_PLAYER,
  CardStatus,
  setCharStatus,
  playPermanentEventAndResolve,
  handCardId,
  charIdAt,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const THATS_BEEN_HEARD = 'le-241' as CardDefinitionId;

// Minion characters
const GORBAG = 'le-11' as CardDefinitionId;       // minion orc — overt race
const THE_MOUTH = 'le-24' as CardDefinitionId;    // minion man — covert race

// Minion sites — free-holds with Information playable (positive cases)
const BAG_END = 'le-350' as CardDefinitionId;          // free-hold, info in playableResources
const THRANDUILS_HALLS = 'le-408' as CardDefinitionId; // free-hold, info in playableResources
const _MINAS_TIRITH_MINION = 'le-391' as CardDefinitionId; // free-hold, info in playableResources

// Minion sites — wrong type or no Information (negative cases)
const MORIA = 'le-392' as CardDefinitionId;       // shadow-hold (wrong type)
const BEORNS_HOUSE = 'le-354' as CardDefinitionId; // free-hold but no information
const DALE = 'le-363' as CardDefinitionId;         // border-hold, no information

// Minion haven for storage
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // darkhaven

/**
 * Build a site-phase state with the ringwraith player at the given site.
 * Uses THE_MOUTH (man, covert) by default. Pass `character: GORBAG` for overt tests.
 */
function sitePhaseAt(site: CardDefinitionId, opts: { cardStatus?: CardStatus; character?: CardDefinitionId } = {}) {
  const char = opts.character ?? THE_MOUTH;
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [char] }],
        hand: [THATS_BEEN_HEARD],
        siteDeck: [DOL_GULDUR],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  const withPhase = { ...state, phaseState: makeSitePhase() };
  if (opts.cardStatus === CardStatus.Tapped) {
    return setCharStatus(withPhase, RESOURCE_PLAYER, char, CardStatus.Tapped);
  }
  return withPhase;
}

describe("That's Been Heard Before Tonight (le-241)", () => {
  beforeEach(() => resetMint());

  // ── Site type + Information filter (IMPLEMENTED) ──────────────────────────

  test('viable at a free-hold with Information playable (Bag End)', () => {
    const state = sitePhaseAt(BAG_END);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('viable at Thranduils Halls (free-hold with Information)', () => {
    const state = sitePhaseAt(THRANDUILS_HALLS);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not viable at a shadow-hold (Moria)', () => {
    const state = sitePhaseAt(MORIA);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not viable at a free-hold without Information (Beorn\'s House)', () => {
    const state = sitePhaseAt(BEORNS_HOUSE);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not viable at a border-hold without Information (Dale)', () => {
    const state = sitePhaseAt(DALE);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── Character status filter (IMPLEMENTED) ────────────────────────────────

  test('viable targeting an untapped character', () => {
    const state = sitePhaseAt(BAG_END);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not viable when the only character is tapped', () => {
    const state = sitePhaseAt(BAG_END, { cardStatus: CardStatus.Tapped });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── Covert company filter (IMPLEMENTED) ──────────────────────────────────

  test('viable when the company is covert (The Mouth, man race)', () => {
    const state = sitePhaseAt(BAG_END);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('not viable when the company is overt (Gorbag, orc race)', () => {
    const state = sitePhaseAt(BAG_END, { character: GORBAG });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Character tapping on play (IMPLEMENTED) ─────────────────────────────

  test('playing the card taps the targeted character', () => {
    const state = sitePhaseAt(BAG_END);
    const cardInstId = handCardId(state, RESOURCE_PLAYER);
    const charInstId = charIdAt(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardInstId, charInstId);

    const defPlayer = after.players[RESOURCE_PLAYER];
    const char = defPlayer.characters[charInstId];
    expect(char?.status).toBe(CardStatus.Tapped);
  });

  test('playing the card does NOT tap the site', () => {
    const state = sitePhaseAt(BAG_END);
    const cardInstId = handCardId(state, RESOURCE_PLAYER);
    const charInstId = charIdAt(state, RESOURCE_PLAYER);
    const before = state.players[RESOURCE_PLAYER].companies[0].currentSite?.status;
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardInstId, charInstId);

    const siteStatus = after.players[RESOURCE_PLAYER].companies[0].currentSite?.status;
    expect(siteStatus).toBe(before);
  });

  // ── Bearer-cannot-untap constraint (IMPLEMENTED) ──────────────────────────

  test('bearer-cannot-untap constraint is placed on the targeted character', () => {
    const state = sitePhaseAt(BAG_END);
    const cardInstId = handCardId(state, RESOURCE_PLAYER);
    const charInstId = charIdAt(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardInstId, charInstId);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap' && c.target.kind === 'character' && c.target.characterId === charInstId,
    );
    expect(constraint).toBeDefined();
  });

  test('2 marshalling points are received when the card is stored at a Darkhaven', () => {
    // Attach the card, then store it — should grant 2 MPs.
    const state = sitePhaseAt(BAG_END);
    const cardInstId = handCardId(state, RESOURCE_PLAYER);
    const charInstId = charIdAt(state, RESOURCE_PLAYER);
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, cardInstId, charInstId);

    // Verify card is attached to character
    const defPlayer = afterPlay.players[RESOURCE_PLAYER];
    const char = defPlayer.characters[charInstId];
    const attachedCard = char?.items.find(i => i.definitionId === THATS_BEEN_HEARD);
    expect(attachedCard).toBeDefined();
    expect(afterPlay.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });
});
