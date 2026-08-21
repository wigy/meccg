/**
 * @module dm-70.test
 *
 * Card test: Long Dark Reach (dm-70)
 * Type: hazard-event (short), non-unique
 *
 * Card text:
 *   "Playable on a moving company with at least one Wilderness [{w}] in its
 *    site path if you have at least 10 cards in your play deck. Reveal the
 *    top seven cards of your play deck. One revealed Nazgûl, Dragon, or a
 *    non-unique creature of your choice must immediately attack the company
 *    regardless of its playability requirements (not count against the
 *    hazard limit). The creature must be playable in a region besides
 *    Coastal Sea [{c}]. If the creature could not normally be played on the
 *    company, modify its prowess by -4. Shuffle all unused cards and return
 *    them to the top of your play deck."
 *
 * Effects:
 *   1. play-condition requires "site-path", sitePath.wildernessCount >= 1
 *   2. play-condition requires "card-player-deck-size", minDeckSize 10 — "you"
 *      is the hazard player playing the card, not the moving company's owner
 *   3. reveal-deck-choose-attacker — the whole mechanic (see
 *      engine/long-dark-reach.ts): reveal top 7 of the card-player's own play
 *      deck; a candidate is eligible when it is a hazard-creature that is a
 *      Nazgûl (race ringwraith), a Dragon, or any non-unique creature, AND its
 *      printed keyedTo offers a non-Coastal-Sea region. With no eligible
 *      candidate the reveal fizzles (all 7 shuffled back to the top). With at
 *      least one, the card-player must name one to immediately attack the
 *      target company, bypassing its normal keying/playability check; the
 *      attack does not count against the hazard limit; the creature's
 *      prowess is modified -4 when it could not normally have been played on
 *      the company. The unused revealed cards are shuffled back to the top of
 *      the deck.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, CRAM, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, HAUBERK_OF_BRIGHT_MAIL,
  BERT_BURAT, ORC_PATROL, CAVE_DRAKE,
  MORIA, LORIEN, RIVENDELL,
  viableActions, dispatch, resolveChain, findInPile, findHandCardId, executeAction,
  companyIdAt, assertEveryInstanceReachable, makeMHState,
} from '../test-helpers.js';
import { Phase, RegionType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHazardAction, ChooseLongDarkReachAttackerAction } from '../../index.js';

const LONG_DARK_REACH = 'dm-70' as CardDefinitionId;
const AKHORAHIL = 'tw-4' as CardDefinitionId; // hazard creature, race ringwraith (Nazgûl), keyed to dark-domain/named regions
const FELL_TURTLE = 'tw-34' as CardDefinitionId; // hazard creature, non-unique animal, keyed ONLY to Coastal Sea

// Non-creature, non-unique filler items (each capped at 3 copies, the
// deck-building limit) used to pad the hazard player's play deck for the
// deck-size gate and as ineligible "no candidate" reveal fodder.
const FILLERS = [CRAM, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, HAUBERK_OF_BRIGHT_MAIL];
function fillerCards(count: number): CardDefinitionId[] {
  const cards: CardDefinitionId[] = [];
  for (let i = 0; i < count; i++) cards.push(FILLERS[Math.floor(i / 3) % FILLERS.length]);
  return cards;
}

/**
 * An M/H state: P1 (active/resource) has a company (ARAGORN, plus any extra
 * characters) moving with `sitePath` in its site path, at MORIA. P2 (hazard)
 * holds Long Dark Reach plus any other hand cards, and a configurable own
 * play deck (the deck the card reveals from, top-first).
 */
function buildLongDarkReach(opts: {
  sitePath?: readonly RegionType[];
  destinationSiteType?: import('../../index.js').SiteType | null;
  hazardHand?: CardDefinitionId[];
  ownDeck?: CardDefinitionId[];
  extraChar?: CardDefinitionId;
  hazardLimit?: number;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN, ...(opts.extraChar ? [opts.extraChar] : [])] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [LONG_DARK_REACH, ...(opts.hazardHand ?? [])],
        siteDeck: [RIVENDELL],
        playDeck: opts.ownDeck ?? [],
      },
    ],
  });
  return {
    ...base,
    phaseState: makeMHState({
      resolvedSitePath: opts.sitePath ?? [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: opts.destinationSiteType ?? null,
      destinationSiteName: 'Moria',
      hazardLimitAtReveal: opts.hazardLimit ?? 4,
    }),
  };
}

/** The viable play-hazard action for Long Dark Reach (undefined if not playable). */
function longDarkReachPlay(state: GameState) {
  const cardId = findHandCardId(state, HAZARD_PLAYER, LONG_DARK_REACH);
  return viableActions(state, PLAYER_2, 'play-hazard')
    .find(a => (a.action as PlayHazardAction).cardInstanceId === cardId);
}

/** Play Long Dark Reach (by the hazard player) and resolve the chain. */
function playLongDarkReach(state: GameState): GameState {
  const play = longDarkReachPlay(state);
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
}

const chooseAttackerPending = (s: GameState) =>
  s.pendingResolutions.find(r => r.kind.type === 'reveal-deck-choose-attacker');

/** Instance id at a position in the hazard player's own play deck. */
function deckIdAt(state: GameState, pos: number): CardInstanceId {
  return state.players[HAZARD_PLAYER].playDeck[pos].instanceId;
}

describe('Long Dark Reach (dm-70)', () => {
  beforeEach(() => resetMint());

  // ── Play conditions ──────────────────────────────────────────────────────

  test('not playable on a company with no Wilderness in its site path', () => {
    const state = buildLongDarkReach({
      sitePath: [RegionType.Shadow],
      ownDeck: fillerCards(10),
    });
    expect(longDarkReachPlay(state)).toBeUndefined();
  });

  test('not playable with fewer than 10 cards in the hazard player\'s own play deck', () => {
    const state = buildLongDarkReach({ ownDeck: fillerCards(9) });
    expect(longDarkReachPlay(state)).toBeUndefined();
  });

  test('"you" is the hazard player\'s own deck, not the moving company owner\'s — playable even with the resource player holding zero cards', () => {
    // The resource (active) player's deck is irrelevant to this card's gate;
    // only the hazard player's own deck size matters ("if you have...").
    const state = buildLongDarkReach({ ownDeck: fillerCards(10) });
    expect(state.players[RESOURCE_PLAYER].playDeck).toHaveLength(0);
    expect(longDarkReachPlay(state)).toBeDefined();
  });

  test('playable once both the Wilderness path and the 10-card deck gates are met', () => {
    const state = buildLongDarkReach({ ownDeck: fillerCards(10) });
    expect(longDarkReachPlay(state)).toBeDefined();
  });

  // ── Candidate eligibility / fizzle ───────────────────────────────────────

  test('fizzles (no pending resolution, no combat) when none of the revealed cards is an eligible creature', () => {
    // All non-creature cards revealed.
    const deck = fillerCards(10);
    const state = buildLongDarkReach({ ownDeck: deck });
    const deckLenBefore = state.players[HAZARD_PLAYER].playDeck.length;

    const resolved = playLongDarkReach(state);

    expect(chooseAttackerPending(resolved)).toBeUndefined();
    expect(resolved.combat).toBeNull();
    // Deck size preserved (nothing removed) — all 7 revealed cards shuffled back on top.
    expect(resolved.players[HAZARD_PLAYER].playDeck).toHaveLength(deckLenBefore);
    assertEveryInstanceReachable(resolved);
  });

  test('excludes a revealed creature keyed only to Coastal Sea, and a revealed unique non-Nazgûl/Dragon creature', () => {
    // Fell Turtle: non-unique, but keyed ONLY to Coastal Sea — fails the
    // "playable in a region besides Coastal Sea" requirement. Bert (Burat):
    // unique troll (not Nazgûl/Dragon) — fails the race/uniqueness gate.
    const deck = [FELL_TURTLE, BERT_BURAT, ...fillerCards(8)];
    const state = buildLongDarkReach({ ownDeck: deck });

    const resolved = playLongDarkReach(state);
    expect(chooseAttackerPending(resolved)).toBeUndefined();
    expect(resolved.combat).toBeNull();
    assertEveryInstanceReachable(resolved);
  });

  test('offers one choice per eligible candidate among the revealed top 7, excluding ineligible siblings', () => {
    const deck = [ORC_PATROL, AKHORAHIL, FELL_TURTLE, BERT_BURAT, ...fillerCards(6)];
    const state = buildLongDarkReach({ ownDeck: deck });
    const orcInstId = deckIdAt(state, 0);
    const nazgulInstId = deckIdAt(state, 1);

    const resolved = playLongDarkReach(state);
    const pending = chooseAttackerPending(resolved);
    expect(pending).toBeDefined();
    expect(pending!.kind.type === 'reveal-deck-choose-attacker' && new Set(pending!.kind.eligibleInstanceIds))
      .toEqual(new Set([orcInstId, nazgulInstId]));

    const offered = viableActions(resolved, PLAYER_2, 'choose-long-dark-reach-attacker')
      .map(a => (a.action as ChooseLongDarkReachAttackerAction).cardInstanceId);
    expect(new Set(offered)).toEqual(new Set([orcInstId, nazgulInstId]));
    assertEveryInstanceReachable(resolved);
  });

  // ── Forced attack: bypasses playability, prowess penalty, hazard limit ──

  test('a normally-playable chosen creature (Orc-patrol keyed to Wilderness) attacks with no prowess penalty', () => {
    const deck = [ORC_PATROL, ...fillerCards(9)];
    const state = buildLongDarkReach({ ownDeck: deck, hazardLimit: 2 });
    const orcInstId = deckIdAt(state, 0);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const resolved = playLongDarkReach(state);

    const afterChoice = dispatch(resolved, {
      type: 'choose-long-dark-reach-attacker', player: PLAYER_2, cardInstanceId: orcInstId, definitionId: ORC_PATROL,
    });

    expect(afterChoice.combat).not.toBeNull();
    const combat = afterChoice.combat!;
    expect(combat.attackSource.type).toBe('long-dark-reach-attack');
    if (combat.attackSource.type === 'long-dark-reach-attack') {
      expect(combat.attackSource.creatureInstanceId).toBe(orcInstId);
    }
    expect(combat.attackingPlayerId).toBe(PLAYER_2);
    expect(combat.defendingPlayerId).toBe(PLAYER_1);
    expect(combat.companyId as string).toBe(companyId as string);
    expect(combat.creatureRace).toBe('orc');
    expect(combat.strikesTotal).toBe(3);
    // Orc-patrol's printed prowess is 6 — no -4 penalty (keyed to Wilderness, matches the path).
    expect(combat.strikeProwess).toBe(6);
    // Never counted against the hazard limit — only Long Dark Reach's own play did.
    expect((afterChoice.phaseState as { hazardsPlayedThisCompany?: number }).hazardsPlayedThisCompany).toBe(1);
    // The creature is still reachable in the deck, attacking "in place".
    expect(findInPile(afterChoice, HAZARD_PLAYER, 'playDeck', orcInstId)).toBeDefined();
    assertEveryInstanceReachable(afterChoice);
  });

  test('a chosen creature that could not normally be played on the company (Cave-drake needs 2 Wilderness) attacks with -4 prowess', () => {
    // Cave-drake keys to {w}{w} (two Wildernesses) or a Ruins & Lairs
    // destination; this company's path has only one Wilderness and no R&L
    // destination, so it "could not normally be played" here.
    const deck = [CAVE_DRAKE, ...fillerCards(9)];
    const state = buildLongDarkReach({ ownDeck: deck });
    const drakeInstId = deckIdAt(state, 0);
    const resolved = playLongDarkReach(state);

    const afterChoice = dispatch(resolved, {
      type: 'choose-long-dark-reach-attacker', player: PLAYER_2, cardInstanceId: drakeInstId, definitionId: CAVE_DRAKE,
    });

    expect(afterChoice.combat).not.toBeNull();
    expect(afterChoice.combat!.creatureRace).toBe('dragon');
    expect(afterChoice.combat!.strikesTotal).toBe(2);
    // Cave-drake's printed prowess is 10, minus the -4 "not normally playable" penalty.
    expect(afterChoice.combat!.strikeProwess).toBe(6);
    assertEveryInstanceReachable(afterChoice);
  });

  test('regardless of playability requirements: the forced attack proceeds even though the creature is not normally playable here', () => {
    // Confirms the attack itself is never blocked by the failed keying check
    // above — only the prowess is penalized. If the bypass were missing,
    // buildLongDarkReachCombat would still produce combat (it never gates on
    // keying), but this test locks in that expectation explicitly.
    const deck = [CAVE_DRAKE, ...fillerCards(9)];
    const state = buildLongDarkReach({ ownDeck: deck });
    const drakeInstId = deckIdAt(state, 0);
    const resolved = playLongDarkReach(state);
    const afterChoice = dispatch(resolved, {
      type: 'choose-long-dark-reach-attacker', player: PLAYER_2, cardInstanceId: drakeInstId, definitionId: CAVE_DRAKE,
    });
    expect(afterChoice.combat).not.toBeNull();
  });

  // Note: unlike ba-16/dm-63, the reveal count here can never be capped by
  // deck length in a reachable game state — the `card-player-deck-size`
  // play-condition already requires at least 10 cards to play the event at
  // all, and the printed reveal count is only 7.

  // ── Shuffle unused cards back to the top ─────────────────────────────────

  test('shuffles the unused revealed cards back to the top of the deck; the rest of the deck below is untouched', () => {
    const deck = [ORC_PATROL, ...fillerCards(9)];
    const state = buildLongDarkReach({ ownDeck: deck });
    const orcInstId = deckIdAt(state, 0);
    const unusedIds = new Set([1, 2, 3, 4, 5, 6].map(i => deckIdAt(state, i)));
    const restBelow = state.players[HAZARD_PLAYER].playDeck.slice(7).map(c => c.instanceId);
    const deckLenBefore = state.players[HAZARD_PLAYER].playDeck.length;

    const resolved = playLongDarkReach(state);
    const afterChoice = dispatch(resolved, {
      type: 'choose-long-dark-reach-attacker', player: PLAYER_2, cardInstanceId: orcInstId, definitionId: ORC_PATROL,
    });

    const deckAfter = afterChoice.players[HAZARD_PLAYER].playDeck;
    expect(deckAfter).toHaveLength(deckLenBefore);
    // Top 6 are the shuffled unused cards.
    expect(new Set(deckAfter.slice(0, 6).map(c => c.instanceId))).toEqual(unusedIds);
    // The chosen (attacking) creature rests directly beneath them.
    expect(deckAfter[6].instanceId).toBe(orcInstId);
    // Everything below the original top 7 is untouched.
    expect(deckAfter.slice(7).map(c => c.instanceId)).toEqual(restBelow);
    assertEveryInstanceReachable(afterChoice);
  });

  // ── Kill marshalling points on defeat (CoE rule 964) ─────────────────────

  test('defeating the forced attacker moves it to the defender\'s kill pile', () => {
    const deck = [ORC_PATROL, ...fillerCards(9)];
    const state = buildLongDarkReach({ ownDeck: deck });
    const orcInstId = deckIdAt(state, 0);
    const resolved = playLongDarkReach(state);
    const afterChoice = dispatch(resolved, {
      type: 'choose-long-dark-reach-attacker', player: PLAYER_2, cardInstanceId: orcInstId, definitionId: ORC_PATROL,
    });
    expect(afterChoice.combat).not.toBeNull();

    // Orc-patrol: 3 strikes, prowess 6. Resolve every strike with a high roll
    // so ARAGORN (the company's sole member) parries all of them, defeating
    // the creature outright — mirroring The Hunt's (dm-143)
    // resolveSoloAttackAgainstAlatar pattern, but against a normal
    // (non-solo-defender) company.
    let working = afterChoice;
    while (working.combat?.phase === 'assign-strikes') {
      const assigner = working.combat.assignmentPhase === 'attacker' ? PLAYER_2 : PLAYER_1;
      const assignable = viableActions(working, assigner, 'assign-strike');
      working = assignable.length > 0
        ? dispatch(working, assignable[0].action)
        : dispatch(working, { type: 'pass', player: assigner });
    }
    while (working.combat) {
      working = working.combat.phase === 'choose-strike-order'
        ? executeAction(working, PLAYER_1, 'choose-strike-order')
        : executeAction(working, PLAYER_1, 'resolve-strike', 12);
    }

    expect(working.combat).toBeNull();
    expect(findInPile(working, HAZARD_PLAYER, 'playDeck', orcInstId)).toBeUndefined();
    expect(findInPile(working, RESOURCE_PLAYER, 'killPile', orcInstId)).toBeDefined();
    assertEveryInstanceReachable(working);
  });
});
