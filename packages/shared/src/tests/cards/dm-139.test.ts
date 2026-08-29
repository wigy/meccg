/**
 * @module dm-139.test
 *
 * Card test: Hobbit-lore (dm-139)
 * Type: hero-resource-event (permanent), played on a character (Gandalf)
 * Effects:
 *   1. play-target character filter target.name "Gandalf" — only Gandalf may bear it
 *   2. play-window organization — only playable during the organization phase
 *   3. play-condition site-type haven — Gandalf's company must be at a Haven [{H}]
 *   4. on-event self-enters-play → set-character-status tapped, when
 *      target.status untapped — "If untapped, tap Gandalf afterwards."
 *   5. stat-modifier direct-influence +2, gated on
 *      (reason: influence-check, target.race: hobbit) OR
 *      (reason: faction-influence-check, faction.race: hobbit) —
 *      "He receives +2 direct influence against Hobbits and Hobbit factions."
 *
 * "Playable on Gandalf during the organization phase while at a Haven [{H}].
 *  If untapped, tap Gandalf afterwards. He receives +2 direct influence
 *  against Hobbits and Hobbit factions."
 *
 * Playable: YES
 *
 * Fixtures:
 *   GANDALF (tw-156)      — subject under test, printed direct influence 10
 *   DAIN_II (tw-138)      — dwarf, mind 7 — placed as an existing follower so
 *                           Gandalf's unrestricted DI is reduced to 3, making
 *                           the +2 Hobbit bonus (or its absence) decisive
 *                           against a mind-5 target
 *   BILBO (tw-131)        — hobbit, mind 5, homesite Bag End — control target
 *   BALIN (tw-123)        — dwarf, mind 5, homesite Blue Mountain Dwarf-hold —
 *                           non-Hobbit control target (negative case)
 *   HOBBITS_FACTION (tw-258) — hobbit faction, influence# 9, playable at Bag End
 *   BAG_END (tw-372)      — free-hold (NOT a Haven); Bilbo's and the Hobbits
 *                           faction's home site
 *   RIVENDELL / LORIEN    — Havens, used for the play-window/play-condition tests
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN, LEGOLAS, BALIN,
  RIVENDELL, LORIEN, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  viableActions, viablePlayCharacterActions,
  firstFactionInfluenceAttempt,
  playPermanentEventAndResolve,
  makeSitePhase,
  findCharInstanceId, findHandCardId,
  expectCharStatus, expectCharItemCount,
  CardStatus,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, PlayPermanentEventAction, InfluenceAttemptAction,
} from '../../index.js';

const HOBBIT_LORE = 'dm-139' as CardDefinitionId;
const DAIN_II = 'tw-138' as CardDefinitionId;         // dwarf, mind 7 — DI sink
const BILBO = 'tw-131' as CardDefinitionId;           // hobbit, mind 5, homesite Bag End
const HOBBITS_FACTION = 'tw-258' as CardDefinitionId; // hobbit faction, influence# 9, playable at Bag End
const BAG_END = 'tw-372' as CardDefinitionId;         // free-hold (not a Haven)

describe('Hobbit-lore (dm-139)', () => {
  beforeEach(() => resetMint());

  // ── play-window: organization phase only ─────────────────────────────────

  test('not playable during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [HOBBIT_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('not playable during site phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [HOBBIT_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── play-target: only Gandalf qualifies ───────────────────────────────────

  test('not playable when Gandalf is not in the company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [HOBBIT_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('only Gandalf is offered as a target, not other company members', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, GANDALF] }], hand: [HOBBIT_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const a = actions[0].action as PlayPermanentEventAction;
    expect(a.targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, GANDALF));
  });

  // ── play-condition site-type haven ────────────────────────────────────────

  test('not offered when Gandalf\'s company is not at a Haven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [HOBBIT_LORE], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('offered when Gandalf\'s company is at a Haven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [HOBBIT_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  // ── on-event self-enters-play: tap Gandalf if untapped ────────────────────

  test('playing the card taps Gandalf when he was untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [HOBBIT_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expectCharStatus(state, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const after = playPermanentEventAndResolve(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, HOBBIT_LORE), gandalfId);

    expectCharStatus(after, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    // The permanent event attaches to Gandalf (as an item), not the discard pile.
    expectCharItemCount(after, RESOURCE_PLAYER, GANDALF, 1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('playing the card on an already-tapped Gandalf leaves him tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF, status: CardStatus.Tapped }] }], hand: [HOBBIT_LORE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const after = playPermanentEventAndResolve(state, PLAYER_1, findHandCardId(state, RESOURCE_PLAYER, HOBBIT_LORE), gandalfId);

    expectCharStatus(after, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    expectCharItemCount(after, RESOURCE_PLAYER, GANDALF, 1);
  });

  // ── stat-modifier: "+2 direct influence against Hobbits" (influence-check) ─
  // Dáin II (mind 7) is placed as an existing follower, spending 7 of
  // Gandalf's printed 10 DI and leaving 3 unrestricted. A mind-5 target is
  // then exactly on the boundary the +2 Hobbit bonus decides.

  test('+2 DI lets Gandalf control a Hobbit follower (Bilbo, mind 5) he otherwise could not', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BAG_END,
            characters: [
              { defId: GANDALF, items: [HOBBIT_LORE] },
              { defId: DAIN_II, followerOf: 0 },
            ],
          }],
          hand: [BILBO],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const bilboUnderGandalf = actions.filter(a => a.controlledBy === gandalfId);
    expect(bilboUnderGandalf.length).toBeGreaterThanOrEqual(1);
  });

  test('without Hobbit-lore attached, Gandalf (3 unrestricted DI) cannot control the same mind-5 Hobbit', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BAG_END,
            characters: [
              GANDALF,
              { defId: DAIN_II, followerOf: 0 },
            ],
          }],
          hand: [BILBO],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const bilboUnderGandalf = actions.filter(a => a.controlledBy === gandalfId);
    expect(bilboUnderGandalf).toHaveLength(0);
  });

  test('+2 DI bonus does NOT apply to a non-Hobbit (Balin, dwarf, mind 5) — still uncontrollable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BLUE_MOUNTAIN_DWARF_HOLD,
            characters: [
              { defId: GANDALF, items: [HOBBIT_LORE] },
              { defId: DAIN_II, followerOf: 0 },
            ],
          }],
          hand: [BALIN],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const balinUnderGandalf = actions.filter(a => a.controlledBy === gandalfId);
    expect(balinUnderGandalf).toHaveLength(0);
  });

  // ── stat-modifier: "...and Hobbit factions" (faction-influence-check) ─────

  test('+2 DI reduces the influence need for the Hobbits faction', () => {
    // Hobbits faction: influence# 9. Gandalf's unrestricted DI is reduced to
    // 3 by Dáin II's follower cost (mind 7 from printed DI 10).
    // need = 9 - (3 + 2) = 4.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BAG_END,
            characters: [
              { defId: GANDALF, items: [HOBBIT_LORE] },
              { defId: DAIN_II, followerOf: 0 },
            ],
          }],
          hand: [HOBBITS_FACTION],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt: InfluenceAttemptAction | undefined = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('without Hobbit-lore attached, the influence need for the Hobbits faction is 2 higher', () => {
    // Same DI sink (Dáin II), but no Hobbit-lore bonus: need = 9 - 3 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BAG_END,
            characters: [
              GANDALF,
              { defId: DAIN_II, followerOf: 0 },
            ],
          }],
          hand: [HOBBITS_FACTION],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt: InfluenceAttemptAction | undefined = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });
});
