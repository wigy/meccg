/**
 * @module le-255.test
 *
 * Card test: While the Yellow Face Sleeps (le-255)
 * Type: minion-resource-event (permanent), alignment ringwraith
 *
 * Text:
 *   "Playable during the organization phase on your Ringwraith at a Darkhaven
 *    [{DH}]. You may keep one more card than normal in your hand. Discard this
 *    card if your Ringwraith moves. Cannot be duplicated by a given player.
 *    Cannot be included in a Balrog's deck."
 *
 * Card shape (data, not asserted here): permanent minion-resource-event, not
 * unique, 0 MPs, effects — `play-target` character filtered on
 * `target.race = ringwraith` AND `target.isRevealedAvatar`, `play-condition`
 * phase `["organization"]`, `play-condition` site-type `["haven"]` (a minion
 * company's haven is by definition a Darkhaven — a minion location deck holds
 * only minion sites), `hand-size-modifier` +1, `on-event`
 * `bearer-company-moves` → move self to discard, and `duplication-limit`
 * scope `player` max 1.
 *
 * Engine support:
 * | # | Rule                                              | Status      | How                                            |
 * |---|---------------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Playable during the organization phase only       | IMPLEMENTED | `play-condition` requires `phase`               |
 * | 2 | Playable on *your* Ringwraith (the revealed avatar)| IMPLEMENTED | `play-target` filter `target.isRevealedAvatar`  |
 * | 3 | Playable at a Darkhaven                           | IMPLEMENTED | `play-condition` requires `site-type` haven     |
 * | 4 | Keep one more card than normal in hand            | IMPLEMENTED | `hand-size-modifier` +1 (`resolveHandSize`)     |
 * | 5 | Discard this card if your Ringwraith moves        | IMPLEMENTED | `on-event: bearer-company-moves` self-discard   |
 * | 6 | Cannot be duplicated by a given player            | IMPLEMENTED | `duplication-limit` scope `player`              |
 * | 7 | Cannot be included in a Balrog's deck             | IMPLEMENTED | `BALROG_BANNED_CARD_IDS` in `deck-validation`   |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, CardStatus, Alignment,
  CardDefinitionId,
  buildTestState, buildMinionSitePhaseState, makePlayDeck, makeMHState, resetMint,
  viableActions, dispatch, playPermanentEventAndResolve,
  findCharInstanceId, findHandCardId, getCharacter,
} from '../test-helpers.js';
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../test-helpers.js';
import type { GameState, PlayPermanentEventAction, DeckList } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { resolveHandSize } from '../../engine/effects/index.js';
import { validateDeck } from '../../deck-validation.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ────────

/** While the Yellow Face Sleeps — the card under test */
const YELLOW_FACE = 'le-255' as CardDefinitionId;
/** Adûnaphel the Ringwraith — the player's revealed Ringwraith avatar */
const ADUNAPHEL = 'le-50' as CardDefinitionId;
/** Hoarmûrath the Ringwraith — a second Ringwraith avatar (used as a follower) */
const HOARMURATH = 'le-53' as CardDefinitionId;
/** The Mouth — a non-Ringwraith minion character (race man) */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Dol Guldur — a minion haven (Darkhaven) */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
/** Minas Morgul — a second minion haven (Darkhaven) */
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
/** Ettenmoors — a minion ruins-and-lairs site (not a Darkhaven) */
const ETTENMOORS = 'le-373' as CardDefinitionId;

/**
 * A Balrog deck listing the card in its resources section — the ban is a
 * deck-construction restriction (rule 1.23), so it surfaces as a
 * `validateDeck` error on the resources section.
 */
const BALROG_DECK_WITH_YELLOW_FACE: DeckList = {
  id: 'le-255-balrog',
  name: 'Balrog deck with While the Yellow Face Sleeps',
  alignment: 'balrog',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: ETTENMOORS, qty: 1 }],
  deck: {
    characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [
      ...MINION_RESOURCES_30.slice(0, MINION_RESOURCES_30.length - 1),
      { name: 'While the Yellow Face Sleeps', card: YELLOW_FACE, qty: 1 },
    ],
  },
};

/** The same listing in a minion (Ringwraith) deck, where the card is legal. */
const MINION_DECK_WITH_YELLOW_FACE: DeckList = {
  ...BALROG_DECK_WITH_YELLOW_FACE,
  id: 'le-255-minion',
  alignment: 'minion',
  deck: {
    ...BALROG_DECK_WITH_YELLOW_FACE.deck,
    characters: [{ name: 'Adûnaphel the Ringwraith', card: ADUNAPHEL, qty: 1 }],
  },
};

// ── Builders ─────────────────────────────────────────────────────────────────

/**
 * Minion organization-phase state: player 1's Ringwraith company sits at
 * `site`, optionally with pre-attached copies of the card and/or copies in
 * hand. `follower` adds a second Ringwraith avatar controlled by the first.
 */
function orgState(opts: {
  site?: CardDefinitionId;
  characters?: { defId: CardDefinitionId; items?: CardDefinitionId[]; followerOf?: number }[];
  hand?: CardDefinitionId[];
  p2Hand?: CardDefinitionId[];
} = {}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site ?? DOL_GULDUR, characters: opts.characters ?? [{ defId: ADUNAPHEL }] }],
        hand: opts.hand ?? [YELLOW_FACE],
        siteDeck: [ETTENMOORS],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [{ defId: HOARMURATH }] }],
        hand: opts.p2Hand ?? [],
        siteDeck: [ETTENMOORS],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/**
 * Movement/hazard state with player 1's Ringwraith company at Dol Guldur,
 * bearing the card. With `moving` (the default) the company has a declared
 * destination, so passing both players resolves the move; without it the
 * company stays at its Darkhaven.
 */
function mhState(opts: { moving?: boolean } = {}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [{ defId: ADUNAPHEL, items: [YELLOW_FACE] }] }],
        hand: [],
        siteDeck: [ETTENMOORS],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [{ defId: HOARMURATH }] }],
        hand: [],
        siteDeck: [ETTENMOORS],
        playDeck: makePlayDeck(),
      },
    ],
  });
  const atMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
  if (opts.moving === false) return atMH;

  const dest = atMH.players[0].siteDeck[0];
  return {
    ...atMH,
    players: [
      {
        ...atMH.players[0],
        companies: [{
          ...atMH.players[0].companies[0],
          destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
        }],
      },
      atMH.players[1],
    ] as typeof atMH.players,
  };
}

describe('While the Yellow Face Sleeps (le-255)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1/2/3: playability ────────────────────────────────────────────────

  test('playable during the organization phase on the revealed Ringwraith at a Darkhaven', () => {
    const state = orgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const rwId = findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL);
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBe(rwId);
  });

  test('NOT playable when the Ringwraith is not at a Darkhaven', () => {
    const state = orgState({ site: ETTENMOORS });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on a non-Ringwraith character', () => {
    const state = orgState({ characters: [{ defId: THE_MOUTH }] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on a Ringwraith follower — only on your revealed Ringwraith', () => {
    const state = orgState({
      characters: [{ defId: ADUNAPHEL }, { defId: HOARMURATH, followerOf: 0 }],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const avatarId = findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL);
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBe(avatarId);
  });

  test('NOT playable during the site phase (organization phase only)', () => {
    const state = buildMinionSitePhaseState({
      site: DOL_GULDUR,
      characters: [ADUNAPHEL],
      hand: [YELLOW_FACE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 4: one more card than normal in hand ─────────────────────────────

  test('raises the controller’s hand size by one while attached', () => {
    const before = orgState();
    expect(resolveHandSize(before, RESOURCE_PLAYER)).toBe(HAND_SIZE);

    const rwId = findCharInstanceId(before, RESOURCE_PLAYER, ADUNAPHEL);
    const cardId = findHandCardId(before, RESOURCE_PLAYER, YELLOW_FACE);
    const after = playPermanentEventAndResolve(before, PLAYER_1, cardId, rwId);

    expect(getCharacter(after, RESOURCE_PLAYER, ADUNAPHEL).items.some(i => i.definitionId === YELLOW_FACE)).toBe(true);
    expect(resolveHandSize(after, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
  });

  test('does not change the opponent’s hand size', () => {
    // The opponent's own Ringwraith (Hoarmûrath) already raises their hand size
    // at a Darkhaven, so compare against the same state without the card rather
    // than against the bare HAND_SIZE constant.
    const withCard = orgState({ characters: [{ defId: ADUNAPHEL, items: [YELLOW_FACE] }], hand: [] });
    const withoutCard = orgState({ characters: [{ defId: ADUNAPHEL }], hand: [] });

    expect(resolveHandSize(withCard, RESOURCE_PLAYER)).toBe(resolveHandSize(withoutCard, RESOURCE_PLAYER) + 1);
    expect(resolveHandSize(withCard, HAZARD_PLAYER)).toBe(resolveHandSize(withoutCard, HAZARD_PLAYER));
  });

  // ── Rule 5: discard if your Ringwraith moves ──────────────────────────────

  test('discarded when the Ringwraith’s company moves, and the hand bonus goes with it', () => {
    const state = mhState();
    const rwId = findCharInstanceId(state, RESOURCE_PLAYER, ADUNAPHEL);
    expect(state.players[RESOURCE_PLAYER].characters[rwId].items.length).toBe(1);
    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);

    const afterMove = dispatch(
      dispatch(state, { type: 'pass', player: PLAYER_1 }),
      { type: 'pass', player: PLAYER_2 },
    );

    expect(afterMove.players[RESOURCE_PLAYER].characters[rwId].items.some(i => i.definitionId === YELLOW_FACE)).toBe(false);
    expect(afterMove.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === YELLOW_FACE)).toBe(true);
    expect(resolveHandSize(afterMove, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });

  test('NOT discarded while the Ringwraith stays at his Darkhaven', () => {
    const stationary = mhState({ moving: false });
    const rwId = findCharInstanceId(stationary, RESOURCE_PLAYER, ADUNAPHEL);

    const after = dispatch(
      dispatch(stationary, { type: 'pass', player: PLAYER_1 }),
      { type: 'pass', player: PLAYER_2 },
    );

    expect(after.players[RESOURCE_PLAYER].characters[rwId].items.some(i => i.definitionId === YELLOW_FACE)).toBe(true);
    expect(resolveHandSize(after, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
  });

  // ── Rule 6: cannot be duplicated by a given player ────────────────────────

  test('a second copy is not playable while the player already has one in play', () => {
    const state = orgState({
      characters: [{ defId: ADUNAPHEL, items: [YELLOW_FACE] }],
      hand: [YELLOW_FACE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('the opponent may still play their own copy while one is in play', () => {
    const state = orgState({
      characters: [{ defId: ADUNAPHEL, items: [YELLOW_FACE] }],
      hand: [],
      p2Hand: [YELLOW_FACE],
    });
    const p2Actions = viableActions({ ...state, activePlayer: PLAYER_2 }, PLAYER_2, 'play-permanent-event');
    expect(p2Actions.length).toBe(1);
    const p2RwId = findCharInstanceId(state, HAZARD_PLAYER, HOARMURATH);
    expect((p2Actions[0].action as PlayPermanentEventAction).targetCharacterId).toBe(p2RwId);
  });

  // ── Rule 7: cannot be included in a Balrog's deck ─────────────────────────

  test('deck validation rejects the card in a Balrog deck', () => {
    const errors = validateDeck(BALROG_DECK_WITH_YELLOW_FACE, pool);
    expect(errors.some(e => e.card === YELLOW_FACE && e.section === 'resources')).toBe(true);
  });

  test('deck validation accepts the card in a minion (Ringwraith) deck', () => {
    const errors = validateDeck(MINION_DECK_WITH_YELLOW_FACE, pool);
    expect(errors.some(e => e.card === YELLOW_FACE)).toBe(false);
  });
});
