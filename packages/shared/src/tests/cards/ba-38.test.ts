/**
 * @module ba-38.test
 *
 * Card test: Great Army of the North (ba-38)
 * Type: minion-resource-event, alignment ringwraith, non-unique.
 * Subtype: Permanent-event/Short-event. Marshalling Points: (2) misc.
 *
 * Text:
 *   "As a permanent-event, +1 to your influence attempts against Orc and Troll
 *    factions. If you have at least 4 unique Orc and/or Troll factions —none
 *    playable at a Darkhold [{D}]—you receive this card's marshalling points.
 *    Cannot be duplicated as a permanent-event. Alternatively, as a short-event,
 *    you may choose any Orc and Troll factions from your discard pile and
 *    shuffle them into your play deck."
 *
 * This is a dual "Permanent-event/Short-event" card, modeled as an
 * `eventType: "permanent"` card whose four effects cover both modes:
 *   1. `check-modifier` (`target: "player-in-play"`, +1 influence gated on
 *      `faction.race` ∈ {orc, troll}) — the ongoing permanent-event influence
 *      bonus, collected from the influencing player's bare in-play permanent
 *      events at every faction-influence check.
 *   2. `conditional-mp` (bonus 2, `requiresFactionCount` min 4, races orc/troll,
 *      unique, excludePlayableAtSiteType dark-hold) — scores the printed 2 MP
 *      only while the player fields ≥4 qualifying factions.
 *   3. `duplication-limit` scope game — "Cannot be duplicated as a
 *      permanent-event."
 *   4. `reshuffle-from-discard` (`scope: "self"`, `altShortEventMode: true`,
 *      filter minion Orc/Troll factions) — the alternative resource short-event
 *      mode: recycle Orc/Troll factions from the discard into the play deck.
 *
 * Rule coverage:
 * | # | Rule                                                                  | Status      |
 * |---|-----------------------------------------------------------------------|-------------|
 * | 1 | +1 to influence against an Orc/Troll faction while in play             | IMPLEMENTED |
 * | 2 | No bonus to influence against a non-Orc/Troll faction                  | IMPLEMENTED |
 * | 3 | Bonus is per-player: opponent's copy does not help                     | IMPLEMENTED |
 * | 4 | Scores 2 MP with ≥4 qualifying Orc/Troll factions in play              | IMPLEMENTED |
 * | 5 | Scores 0 MP with fewer than 4 qualifying factions                      | IMPLEMENTED |
 * | 6 | A faction playable at a Dark-hold does not count toward the 4          | IMPLEMENTED |
 * | 7 | Cannot be played as a permanent-event while a copy is in play          | IMPLEMENTED |
 * | 8 | Alternative short-event mode reshuffles Orc/Troll factions from discard | IMPLEMENTED |
 * | 9 | Short-event mode not offered when no matching faction sits in discard   | IMPLEMENTED |
 * | 10| Both modes offered together in the organization phase                  | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   BA_38 (ba-38)                 - this card
 *   GOBLINS_GOBLIN_GATE (le-265)  - orc faction, inf# 9, at Goblin-gate
 *   ORCS_MORIA (le-278)           - orc faction, at Moria (shadow-hold)
 *   GREY_MOUNTAIN_GOBLINS (le-266)- orc faction, at Gondmaeglom (ruins-&-lairs)
 *   ORCS_ANGMAR (le-274)          - orc faction, at Mount Gram (shadow-hold)
 *   BLACK_TROLLS (le-262)         - troll faction, playable at Barad-dûr (dark-hold)
 *   VARIAGS (le-292)              - man faction, inf# 9, at Variag Camp
 *   LAGDUF (le-18)                - orc, DI 0, no effects (influencer)
 *   GOBLIN_GATE (le-378)          - shadow-hold (home of GOBLINS_GOBLIN_GATE)
 *   VARIAG_CAMP (le-411)          - border-hold (home of VARIAGS)
 *   CARN_DUM (le-359)             - minion haven (opponent site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, findHandCardId,
  makeSitePhase, firstFactionInfluenceAttempt, expectInDiscardPile,
  Phase, CardStatus, Alignment, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay,
  PlayShortEventAction, PlayPermanentEventAction,
} from '../../index.js';

const BA_38 = 'ba-38' as CardDefinitionId;
const GOBLINS_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const ORCS_MORIA = 'le-278' as CardDefinitionId;
const GREY_MOUNTAIN_GOBLINS = 'le-266' as CardDefinitionId;
const ORCS_ANGMAR = 'le-274' as CardDefinitionId;
const BLACK_TROLLS = 'le-262' as CardDefinitionId;
const VARIAGS = 'le-292' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

/** Builds a card-in-play entry (faction or bare permanent-event). */
function inPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped };
}

/** The viable ba-38 short-event action for the resource player, if offered. */
function shortEventPlay(state: ReturnType<typeof buildTestState>): PlayShortEventAction | undefined {
  const inst = findHandCardId(state, RESOURCE_PLAYER, BA_38);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .find(a => a.cardInstanceId === inst);
}

/** The viable ba-38 permanent-event action for the resource player, if offered. */
function permEventPlay(state: ReturnType<typeof buildTestState>): PlayPermanentEventAction | undefined {
  const inst = findHandCardId(state, RESOURCE_PLAYER, BA_38);
  return viableActions(state, PLAYER_1, 'play-permanent-event')
    .map(ea => ea.action as PlayPermanentEventAction)
    .find(a => a.cardInstanceId === inst);
}

describe('Great Army of the North (ba-38)', () => {
  beforeEach(() => resetMint());

  // ─── Permanent-event mode: +1 influence vs Orc/Troll factions ────────────────

  test('adds +1 to an influence attempt against an Orc faction while in play', () => {
    // Lagduf (orc, DI 0) at Goblin-gate influencing Goblins of Goblin-gate
    // (inf# 9). Baseline need = 9 - DI(0) = 9. With ba-38 in play: +1 → need 8.
    const baseNoCard = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const noCard = { ...baseNoCard, phaseState: makeSitePhase() };
    const baselineFactionInst = noCard.players[RESOURCE_PLAYER].hand[0].instanceId;
    const baseline = firstFactionInfluenceAttempt(noCard, baselineFactionInst);
    expect(baseline).toBeDefined();
    expect(baseline!.need).toBe(9);

    const baseWithCard = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
          cardsInPlay: [inPlay(BA_38, 'gan-1')] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withCard = { ...baseWithCard, phaseState: makeSitePhase() };
    const boostedFactionInst = withCard.players[RESOURCE_PLAYER].hand[0].instanceId;
    const boosted = firstFactionInfluenceAttempt(withCard, boostedFactionInst);
    expect(boosted).toBeDefined();
    expect(boosted!.need).toBe(8);
  });

  test('does NOT add a bonus to an influence attempt against a non-Orc/Troll faction', () => {
    // Variags of Khand (man, inf# 9) at Variag Camp. ba-38 in play, but the
    // faction is Man → no bonus. need stays 9 - DI(0) = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [LAGDUF] }],
          hand: [VARIAGS], siteDeck: [CARN_DUM],
          cardsInPlay: [inPlay(BA_38, 'gan-1')] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('the bonus is per-player: only the opponent holding a copy does not help', () => {
    // ba-38 on the OPPONENT's side; PLAYER_1 influences an Orc faction. The
    // bonus is collected from the influencing player's own cardsInPlay only, so
    // the need stays at baseline 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM],
          cardsInPlay: [inPlay(BA_38, 'gan-opp-1')] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  // ─── Conditional marshalling points ──────────────────────────────────────────

  test('scores 2 misc marshalling points with 4 qualifying Orc factions in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM],
          cardsInPlay: [
            inPlay(BA_38, 'gan-1'),
            inPlay(GOBLINS_GOBLIN_GATE, 'f1'),
            inPlay(ORCS_MORIA, 'f2'),
            inPlay(GREY_MOUNTAIN_GOBLINS, 'f3'),
            inPlay(ORCS_ANGMAR, 'f4'),
          ] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(2);
  });

  test('scores 0 misc marshalling points with only 3 qualifying factions in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM],
          cardsInPlay: [
            inPlay(BA_38, 'gan-1'),
            inPlay(GOBLINS_GOBLIN_GATE, 'f1'),
            inPlay(ORCS_MORIA, 'f2'),
            inPlay(GREY_MOUNTAIN_GOBLINS, 'f3'),
          ] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('a faction playable at a Dark-hold does not count toward the required 4', () => {
    // 3 qualifying orc factions + Black Trolls (playable at Barad-dûr, a
    // Dark-hold). 4 factions in play, but only 3 qualify → 0 misc MP.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM],
          cardsInPlay: [
            inPlay(BA_38, 'gan-1'),
            inPlay(GOBLINS_GOBLIN_GATE, 'f1'),
            inPlay(ORCS_MORIA, 'f2'),
            inPlay(GREY_MOUNTAIN_GOBLINS, 'f3'),
            inPlay(BLACK_TROLLS, 'f4'),
          ] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  // ─── Cannot be duplicated as a permanent-event ───────────────────────────────

  test('cannot be played as a permanent-event while a copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [BA_38], siteDeck: [CARN_DUM],
          cardsInPlay: [inPlay(BA_38, 'gan-1')] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(permEventPlay(state)).toBeUndefined();
  });

  // ─── Alternative short-event mode ────────────────────────────────────────────

  test('short-event mode reshuffles Orc/Troll factions from the discard into the play deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [BA_38], playDeck: [CARN_DUM],
          discardPile: [GOBLINS_GOBLIN_GATE, VARIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const eventInst = findHandCardId(state, RESOURCE_PLAYER, BA_38);
    const orcFactionInst = state.players[RESOURCE_PLAYER].discardPile
      .find(c => c.definitionId === GOBLINS_GOBLIN_GATE)!.instanceId;
    const manFactionInst = state.players[RESOURCE_PLAYER].discardPile
      .find(c => c.definitionId === VARIAGS)!.instanceId;

    const play = shortEventPlay(state);
    expect(play).toBeDefined();
    const after = dispatch(state, play!);

    // The Orc faction moved discard → play deck; the Man faction stayed.
    expect(after.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toContain(orcFactionInst);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).not.toContain(orcFactionInst);
    expect(after.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(manFactionInst);
    // The spent event went to the discard pile (no instance lost).
    expectInDiscardPile(after, RESOURCE_PLAYER, eventInst);
  });

  test('short-event mode is not offered when no Orc/Troll faction sits in the discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [BA_38], playDeck: [CARN_DUM],
          discardPile: [VARIAGS], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(shortEventPlay(state)).toBeUndefined();
  });

  test('both the permanent-event and the short-event modes are offered in the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [BA_38], playDeck: [CARN_DUM],
          discardPile: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(permEventPlay(state)).toBeDefined();
    expect(shortEventPlay(state)).toBeDefined();
  });
});
