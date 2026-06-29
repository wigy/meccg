/**
 * @module le-184.test
 *
 * Card test: Focus Palantír (le-184)
 * Type: minion-resource-event (permanent)
 * Effects: 3 (play-flag can-use-palantir, play-target, on-event bearer-company-moves)
 *
 * "Sage only. Playable on a Palantír with a sage in the company. If the
 *  bearer of the Palantír is not a Ringwraith, he now has the ability to
 *  use the Palantír. Discard Focus Palantír if the Palantír's company moves."
 *
 * Focus Palantír is the minion twin of Align Palantír (tw-190). It attaches
 * to the bearer of a Palantír and grants the `can-use-palantir` ability via
 * the same machinery, but differs in three ways:
 *   - it only benefits a bearer who is NOT a Ringwraith (modelled by gating
 *     the play-target on `target.race != ringwraith`);
 *   - it has no "stored with the Palantír" clause; and
 *   - it has no duplication limit (the card is non-unique).
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                              |
 * |---|------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Grants Palantír use to bearer            | IMPLEMENTED | play-flag can-use-palantir on an attached item     |
 * | 2 | Playable on Palantír bearer + sage       | IMPLEMENTED | play-target filter (itemKeywords/company.skills)   |
 * | 3 | Only on a non-Ringwraith bearer          | IMPLEMENTED | play-target filter target.race != ringwraith       |
 * | 4 | Discarded when company moves             | IMPLEMENTED | on-event bearer-company-moves → discard-self       |
 *
 * Fixtures are minion (LE): Layos (le-19, Man sage), Hoarmûrath (le-53,
 * Ringwraith with a sage skill), Gorbag (le-11, Orc, no Palantír ability),
 * bearing Palantír of Minas Tirith (le-333).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  buildTestState, resetMint,
  viableActions, dispatch, makePlayDeck,
  playPermanentEventAndResolve,
  findCharInstanceId, getCharacter, makeMHState, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  PlayPermanentEventAction,
  ActivateGrantedAction,
  CardDefinitionId,
} from '../../index.js';

// ─── Local card-ID constants ────────────────────────────────────────────────
const FOCUS_PALANTIR        = 'le-184' as CardDefinitionId; // permanent event under test
const PALANTIR_MINAS_TIRITH = 'le-333' as CardDefinitionId; // unique minion Palantír (keyword palantir)
const LAYOS                 = 'le-19'  as CardDefinitionId; // minion Man, sage (non-Ringwraith)
const HOARMURATH            = 'le-53'  as CardDefinitionId; // Ringwraith with a sage skill
const GORBAG                = 'le-11'  as CardDefinitionId; // minion Orc, no Palantír ability
const GRISHNAKH             = 'le-12'  as CardDefinitionId; // minion Orc (opponent filler)
const MINAS_TIRITH_MINION   = 'le-391' as CardDefinitionId; // free-hold
const MINAS_MORGUL_SITE     = 'le-390' as CardDefinitionId; // darkhaven
const MORIA_MINION          = 'le-392' as CardDefinitionId; // shadow-hold

describe('Focus Palantír (le-184)', () => {
  beforeEach(() => resetMint());

  // ── Effect: play-target (palantír + sage in company, non-Ringwraith bearer) ──

  test('playable on a non-Ringwraith bearer of a Palantír with a sage in company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_TIRITH_MINION, characters: [{ defId: LAYOS, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [FOCUS_PALANTIR],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, LAYOS));
  });

  test('NOT playable when no Palantír item on the character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_TIRITH_MINION, characters: [LAYOS] }],
          hand: [FOCUS_PALANTIR],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('NOT playable when no sage in the company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_TIRITH_MINION, characters: [{ defId: GORBAG, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [FOCUS_PALANTIR],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect: "not a Ringwraith" gate ──

  test('NOT playable on a Ringwraith bearer, even with a sage in company', () => {
    // Company holds a separate sage (Layos), but the only Palantír-bearer is
    // a Ringwraith (Hoarmûrath). The race gate blocks the play entirely.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_TIRITH_MINION,
            characters: [
              LAYOS,
              { defId: HOARMURATH, items: [PALANTIR_MINAS_TIRITH] },
            ],
          }],
          hand: [FOCUS_PALANTIR],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('playable on the non-Ringwraith bearer when both a Ringwraith and a sage share the company', () => {
    // Same company as above, but now the non-Ringwraith sage (Layos) bears
    // the Palantír — Focus Palantír targets Layos, not Hoarmûrath.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_TIRITH_MINION,
            characters: [
              { defId: LAYOS, items: [PALANTIR_MINAS_TIRITH] },
              HOARMURATH,
            ],
          }],
          hand: [FOCUS_PALANTIR],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;
    expect(action.targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, LAYOS));
  });

  // ── Reducer: attaches to bearer's items ──

  test('reducer places Focus Palantír into the bearer items on resolution', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_TIRITH_MINION, characters: [{ defId: LAYOS, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [FOCUS_PALANTIR],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;
    const charId = action.targetCharacterId!;

    const after = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, charId);

    const char = after.players[RESOURCE_PLAYER].characters[charId];
    expect(char.items.some(i => i.definitionId === FOCUS_PALANTIR)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === FOCUS_PALANTIR)).toBe(false);
  });

  // ── Effect: grants the ability to use the Palantír ──

  test('Focus Palantír enables palantir-peek-shuffle for a bearer who otherwise cannot use it', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_TIRITH_MINION,
            characters: [{ defId: GORBAG, items: [PALANTIR_MINAS_TIRITH, FOCUS_PALANTIR] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const peek = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle');
    expect(peek.length).toBe(1);
  });

  test('without Focus Palantír the same bearer cannot use the Palantír', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_TIRITH_MINION,
            characters: [{ defId: GORBAG, items: [PALANTIR_MINAS_TIRITH] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const peek = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle');
    expect(peek.length).toBe(0);
  });

  // ── Effect: on-event bearer-company-moves → discard-self ──

  test('Focus Palantír is discarded when its company moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_TIRITH_MINION,
            characters: [{ defId: LAYOS, items: [PALANTIR_MINAS_TIRITH, FOCUS_PALANTIR] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const destCard = base.players[0].siteDeck[0];
    const withDest = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: destCard.instanceId, definitionId: destCard.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
    };

    const stateAtMH = { ...withDest, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const layosId = findCharInstanceId(stateAtMH, RESOURCE_PLAYER, LAYOS);
    expect(getCharacter(stateAtMH, RESOURCE_PLAYER, LAYOS).items.some(i => i.definitionId === FOCUS_PALANTIR)).toBe(true);

    const afterResourcePass = dispatch(stateAtMH, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const charAfter = afterHazardPass.players[RESOURCE_PLAYER].characters[layosId];
    expect(charAfter.items.some(i => i.definitionId === FOCUS_PALANTIR)).toBe(false);
    expect(afterHazardPass.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === FOCUS_PALANTIR)).toBe(true);
    // The Palantír itself stays on the bearer.
    expect(charAfter.items.some(i => i.definitionId === PALANTIR_MINAS_TIRITH)).toBe(true);
  });

  test('Focus Palantír NOT discarded when the company stays (no destination)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_TIRITH_MINION,
            characters: [{ defId: LAYOS, items: [PALANTIR_MINAS_TIRITH, FOCUS_PALANTIR] }],
          }],
          hand: [],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL_SITE, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const stateAtMH = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterResourcePass = dispatch(stateAtMH, { type: 'pass', player: PLAYER_1 });
    const afterHazardPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const layosId = findCharInstanceId(stateAtMH, RESOURCE_PLAYER, LAYOS);
    const charAfter = afterHazardPass.players[RESOURCE_PLAYER].characters[layosId];
    expect(charAfter.items.some(i => i.definitionId === FOCUS_PALANTIR)).toBe(true);
  });
});
