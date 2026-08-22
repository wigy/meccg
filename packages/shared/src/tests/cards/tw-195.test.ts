/**
 * @module tw-195.test
 *
 * Card test: Athelas (tw-195)
 * Type: hero-resource-item (minor, corruption 1), alignment wizard.
 *
 * "A Dúnadan can tap and use this item to heal a character in his company
 *  (change from wounded to well, character remains tapped). Aragorn II can
 *  also tap and use this item to remove a corruption card from a character
 *  in his company. Discard after use."
 *
 * Engine support:
 * | # | Feature                                                          | Status      | Notes                                                                          |
 * |---|-------------------------------------------------------------------|-------------|---------------------------------------------------------------------------------|
 * | 1 | Only a Dúnadan bearer may heal (mode A)                          | IMPLEMENTED | grant-action `when: { "bearer.race": "dunadan" }`                                |
 * | 2 | Heal a wounded company member, but it remains Tapped (not Untapped) | IMPLEMENTED | `heal-company-character` apply `set-character-status` status `"tapped"` (le-310/tw-255 precedent, differing only in target status) |
 * | 3 | Only Aragorn II may remove a corruption card (mode B)            | IMPLEMENTED | grant-action `when: { "bearer.name": "Aragorn II" }`                             |
 * | 4 | Corruption-removal target restricted to bearer's own company    | IMPLEMENTED | new `targets.scope: "company-hazard-corruption-cards"` (company-scoped counterpart of Palantír of Amon Sûl tw-296's `own-hazard-corruption-cards`) |
 * | 5 | Tap bearer AND discard the item to pay the cost (both modes)     | IMPLEMENTED | grant-action cost `{ tap: "bearer", discard: "self" }`                          |
 * | 6 | Activate during any phase of the player's turn (2.1.1)           | IMPLEMENTED | grant-action carries `anyPhase: true`                                           |
 *
 * Fixtures: Aragorn II (tw-120, Dúnadan) satisfies both gates at once.
 * Halbarad (tw-162, Dúnadan, not Aragorn II) is used to prove mode A works
 * for any Dúnadan while mode B stays Aragorn-II-only. Bilbo (tw-131,
 * Hobbit) proves neither mode is offered to a non-Dúnadan, non-Aragorn
 * bearer. Despair of the Heart (tw-27) is used as a generic
 * `hazard-corruption`-keyworded card to attach as a "corruption card".
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch, attachHazardToChar,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  findCharInstanceId,
  RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus, makeMHState,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const ATHELAS = 'tw-195' as CardDefinitionId;
const HALBARAD = 'tw-162' as CardDefinitionId; // Dúnadan, not Aragorn II
const DESPAIR_OF_THE_HEART = 'tw-27' as CardDefinitionId; // hazard-event, keywords: ["corruption"]

function healActions(state: ReturnType<typeof buildTestState>) {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === 'heal-company-character');
}

function removeCorruptionActions(state: ReturnType<typeof buildTestState>) {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === 'athelas-remove-corruption');
}

describe('Athelas (tw-195)', () => {
  beforeEach(() => resetMint());

  // ── Mode A: any Dúnadan heals a wounded company member (stays Tapped) ────

  test('heal-company-character available when a Dúnadan bearer has a wounded company member', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: HALBARAD, items: [ATHELAS] },
            { defId: LEGOLAS, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(healActions(state).length).toBe(1);
  });

  test('heal-company-character NOT available when the bearer is not a Dúnadan', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: BILBO, items: [ATHELAS] },
            { defId: LEGOLAS, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(healActions(state).length).toBe(0);
  });

  test('heal-company-character NOT available when nobody in the company is wounded', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: HALBARAD, items: [ATHELAS] },
            LEGOLAS,
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(healActions(state).length).toBe(0);
  });

  test('activating heal-company-character heals target to Tapped (not Untapped), taps bearer, and discards the item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: HALBARAD, items: [ATHELAS] },
            { defId: LEGOLAS, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const action = healActions(state)[0];
    const next = dispatch(state, action);

    // Legolas is healed but remains Tapped — the key difference from
    // Healing Herbs / Foul-smelling Paste, which fully untap the target.
    expectCharStatus(next, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);
    expectCharItemCount(next, RESOURCE_PLAYER, HALBARAD, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, ATHELAS);
    expectCharStatus(next, RESOURCE_PLAYER, HALBARAD, CardStatus.Tapped);
  });

  test('heal-company-character available during movement/hazard phase (rule 2.1.1: any phase)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: HALBARAD, items: [ATHELAS] },
            { defId: LEGOLAS, status: CardStatus.Inverted },
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState() };

    expect(healActions(ready).length).toBe(1);
  });

  // ── Mode B: only Aragorn II removes a corruption card from his company ──

  test('athelas-remove-corruption available when Aragorn II bears the item and a company-mate carries a corruption card', () => {
    const state = attachHazardToChar(
      buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: RIVENDELL, characters: [
              { defId: ARAGORN, items: [ATHELAS] },
              LEGOLAS,
            ] }],
            hand: [], siteDeck: [MORIA],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );

    expect(removeCorruptionActions(state).length).toBe(1);
  });

  test('athelas-remove-corruption NOT available for a Dúnadan bearer who is not Aragorn II', () => {
    const state = attachHazardToChar(
      buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: RIVENDELL, characters: [
              { defId: HALBARAD, items: [ATHELAS] },
              LEGOLAS,
            ] }],
            hand: [], siteDeck: [MORIA],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );

    // Halbarad qualifies for mode A (heal) but not mode B (Aragorn-II-only).
    expect(removeCorruptionActions(state).length).toBe(0);
  });

  test('athelas-remove-corruption NOT available when no company-mate carries a corruption card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: ARAGORN, items: [ATHELAS] },
            LEGOLAS,
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(removeCorruptionActions(state).length).toBe(0);
  });

  test('athelas-remove-corruption is restricted to the bearer\'s own company — a corruption card in another company is NOT offered', () => {
    const state = attachHazardToChar(
      buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            companies: [
              { site: RIVENDELL, characters: [{ defId: ARAGORN, items: [ATHELAS] }] },
              { site: MINAS_TIRITH, characters: [LEGOLAS] },
            ],
            hand: [], siteDeck: [MORIA],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );

    // Legolas (bearing the corruption card) is in a different company than
    // Aragorn/Athelas, so it must not be a valid target.
    expect(removeCorruptionActions(state).length).toBe(0);
  });

  test('activating athelas-remove-corruption discards the corruption card to its owner\'s pile, taps bearer, and discards the item', () => {
    const state = attachHazardToChar(
      buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: RIVENDELL, characters: [
              { defId: ARAGORN, items: [ATHELAS] },
              LEGOLAS,
            ] }],
            hand: [], siteDeck: [MORIA],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const corruptionInstId = state.players[0].characters[legolasId].hazards[0].instanceId;

    const action = removeCorruptionActions(state)[0];
    expect(action.targetCardId).toBe(corruptionInstId);

    const after = dispatch(state, action);

    expect(after.players[0].characters[legolasId].hazards.length).toBe(0);
    // Corruption cards are owned by the opponent (hazard player).
    expect(after.players[1].discardPile.some(c => c.instanceId === corruptionInstId)).toBe(true);
    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, ATHELAS);
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });

  // ── Cost gating: bearer must be untapped to activate either mode ─────────

  test('neither mode is offered when the bearer is already tapped', () => {
    const state = attachHazardToChar(
      buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: RIVENDELL, characters: [
              { defId: ARAGORN, items: [ATHELAS], status: CardStatus.Tapped },
              { defId: LEGOLAS, status: CardStatus.Inverted },
            ] }],
            hand: [], siteDeck: [MORIA],
          },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      RESOURCE_PLAYER, LEGOLAS, DESPAIR_OF_THE_HEART, 1,
    );

    expect(healActions(state).length).toBe(0);
    expect(removeCorruptionActions(state).length).toBe(0);
  });
});
