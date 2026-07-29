/**
 * @module le-193.test
 *
 * Card test: Hoarmûrath Unleashed (le-193)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0.
 *
 * Card text:
 *   "Playable on Hoarmûrath the Ringwraith (as your Ringwraith). Cancel an
 *    attack against any one of your companies."
 *
 * Modelled by two DSL effects:
 *   1. `play-condition` `requires: "player-state"` with condition
 *      `{ "player.avatar": "Hoarmûrath the Ringwraith" }` — `player.avatar` is
 *      the name of the player's **revealed avatar in play**, so the gate holds
 *      exactly while Hoarmûrath the Ringwraith (le-53) is the player's own
 *      Ringwraith. A Hoarmûrath riding as another Ringwraith's *follower* is
 *      not controlled under general influence and therefore is not the
 *      player's avatar, so the card is not playable then.
 *   2. `cancel-attack` — a costless from-hand cancel with no `when` gate:
 *      "an attack" covers hazard creatures, on-guard creatures and site
 *      automatic-attacks alike. The cancel is offered to the defending player
 *      during the pre-strike cancel window and routes through the chain (the
 *      Dark Quarrels tw-207 from-hand path).
 *
 * "Against any one of your companies" needs no company binding: the from-hand
 * cancel-attack loop in `cancelAttackActions` is scoped to whichever company is
 * defending, and the player-state gate is company-independent — so Hoarmûrath
 * may cancel an attack on a company he is not travelling with.
 *
 * Rule coverage:
 * | # | Rule                                                              | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Playable while Hoarmûrath the Ringwraith is the revealed avatar    | IMPLEMENTED |
 * | 2 | Cancels an attack against *any* of your companies, not just his   | IMPLEMENTED |
 * | 3 | Not playable when another Ringwraith is your revealed avatar      | IMPLEMENTED |
 * | 4 | Not playable when Hoarmûrath rides as a follower (not your avatar)| IMPLEMENTED |
 * | 5 | Not playable when no avatar is in play at all                     | IMPLEMENTED |
 * | 6 | "An attack" — automatic-attacks and on-guard creatures included    | IMPLEMENTED |
 * | 7 | Costless: no character taps, no check enqueued; card discards      | IMPLEMENTED |
 * | 8 | Cancel window only: not offered once a strike has been assigned    | IMPLEMENTED |
 * | 9 | Combat-only: never offered as a generic short event outside combat | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, resolveChain,
  viableActions, viableActionsForHandCard, findCharInstanceId,
  makeCancelWindowCombat, expectInDiscardPile,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS, MINAS_TIRITH, LORIEN,
} from '../test-helpers.js';
import { Phase, Alignment, Race } from '../../index.js';
import type { CardDefinitionId, GameState, CancelAttackAction } from '../../index.js';

const HOARMURATH_UNLEASHED = 'le-193' as CardDefinitionId;
const HOARMURATH = 'le-53' as CardDefinitionId;   // Hoarmûrath the Ringwraith (avatar)
const KHAMUL = 'le-55' as CardDefinitionId;       // a different Ringwraith avatar
const THE_MOUTH = 'le-24' as CardDefinitionId;    // non-avatar minion character (Man)

// Minion sites for the Ringwraith's companies, hero sites for the opponent.
const MORIA_MINION = 'le-392' as CardDefinitionId;  // minion shadow-hold
const VARIAG_CAMP = 'le-411' as CardDefinitionId;   // minion border-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion darkhaven (site deck)

/**
 * A minion (Ringwraith) player holding Hoarmûrath Unleashed, with one company
 * per entry of `companies`. Combat is always built against the **first**
 * company (see {@link makeCancelWindowCombat}), so putting Hoarmûrath in a
 * later company exercises "any one of your companies".
 */
function buildState(opts: {
  companies?: { site: CardDefinitionId; characters: (CardDefinitionId | { defId: CardDefinitionId; followerOf?: number })[] }[];
  phase?: Phase;
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: opts.phase ?? Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: opts.companies ?? [{ site: MORIA_MINION, characters: [HOARMURATH] }],
        hand: [HOARMURATH_UNLEASHED],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** Viable cancel-attack actions for the Ringwraith player. */
function cancelActions(state: GameState): CancelAttackAction[] {
  return viableActions(state, PLAYER_1, 'cancel-attack')
    .map(ea => ea.action as CancelAttackAction);
}

describe('Hoarmûrath Unleashed (le-193)', () => {
  beforeEach(() => resetMint());

  // ── "Playable on Hoarmûrath the Ringwraith (as your Ringwraith)" ────────

  test('offered while Hoarmûrath is the revealed Ringwraith avatar', () => {
    const state = makeCancelWindowCombat(buildState({}), { creatureRace: Race.Orc });

    const actions = cancelActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0].cardInstanceId).toBe(state.players[RESOURCE_PLAYER].hand[0].instanceId);
    // Costless: no character pays for the cancellation.
    expect(actions[0].scoutInstanceId).toBeUndefined();
    expect(actions[0].targetCharacterId).toBeUndefined();
  });

  test('not offered when a different Ringwraith is your revealed avatar', () => {
    const state = makeCancelWindowCombat(
      buildState({ companies: [{ site: MORIA_MINION, characters: [KHAMUL] }] }),
      { creatureRace: Race.Orc },
    );

    expect(cancelActions(state)).toHaveLength(0);
  });

  test('not offered when Hoarmûrath rides as a follower rather than your avatar', () => {
    const state = makeCancelWindowCombat(
      buildState({
        companies: [{ site: MORIA_MINION, characters: [KHAMUL, { defId: HOARMURATH, followerOf: 0 }] }],
      }),
      { creatureRace: Race.Orc },
    );

    // Sanity: Hoarmûrath really is Khamûl's follower, not under general influence.
    const hoarId = findCharInstanceId(state, RESOURCE_PLAYER, HOARMURATH);
    expect(state.players[RESOURCE_PLAYER].characters[hoarId].controlledBy).not.toBe('general');

    expect(cancelActions(state)).toHaveLength(0);
  });

  test('not offered when no avatar is in play at all', () => {
    const state = makeCancelWindowCombat(
      buildState({ companies: [{ site: MORIA_MINION, characters: [THE_MOUTH] }] }),
      { creatureRace: Race.Orc },
    );

    expect(cancelActions(state)).toHaveLength(0);
  });

  // ── "Cancel an attack against any one of your companies" ────────────────

  test('cancels an attack on another of your companies — Hoarmûrath need not be there', () => {
    // Company 0 (the defender) holds only The Mouth; Hoarmûrath travels alone
    // in company 1 at a different site.
    const state = makeCancelWindowCombat(
      buildState({
        companies: [
          { site: MORIA_MINION, characters: [THE_MOUTH] },
          { site: VARIAG_CAMP, characters: [HOARMURATH] },
        ],
      }),
      { creatureRace: Race.Orc },
    );

    // The combat really is against the company Hoarmûrath is *not* in.
    const defendingCompany = state.players[RESOURCE_PLAYER].companies[0];
    expect(state.combat!.companyId).toBe(defendingCompany.id);
    const hoarId = findCharInstanceId(state, RESOURCE_PLAYER, HOARMURATH);
    expect(defendingCompany.characters).not.toContain(hoarId);

    expect(cancelActions(state)).toHaveLength(1);

    const after = resolveChain(dispatch(state, cancelActions(state)[0]));
    expect(after.combat).toBeNull();
  });

  // ── "An attack" — every attack source qualifies ─────────────────────────

  test('offered against a site automatic-attack', () => {
    const state = makeCancelWindowCombat(buildState({}), {
      creatureRace: Race.Orc, attackSourceType: 'automatic-attack',
    });

    expect(cancelActions(state)).toHaveLength(1);
  });

  test('offered against an on-guard creature', () => {
    const state = makeCancelWindowCombat(buildState({}), {
      creatureRace: Race.Orc, attackSourceType: 'on-guard-creature',
    });

    expect(cancelActions(state)).toHaveLength(1);
  });

  // ── Resolution ──────────────────────────────────────────────────────────

  test('cancelling discards the event and ends the combat, at no cost', () => {
    const state = makeCancelWindowCombat(buildState({}), { creatureRace: Race.Orc });
    const hoarId = findCharInstanceId(state, RESOURCE_PLAYER, HOARMURATH);

    const declared = dispatch(state, cancelActions(state)[0]);

    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, HOARMURATH_UNLEASHED);
    // No cost: nothing taps, no check is enqueued.
    expect(declared.players[RESOURCE_PLAYER].characters[hoarId].status)
      .toBe(state.players[RESOURCE_PLAYER].characters[hoarId].status);
    expect(declared.pendingResolutions).toHaveLength(0);
    // Combat stays active until the chain resolves the cancellation.
    expect(declared.combat).not.toBeNull();

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });

  // ── Cancel window ───────────────────────────────────────────────────────

  test('not offered once a strike has been assigned (cancel window closed)', () => {
    const base = makeCancelWindowCombat(buildState({}), { creatureRace: Race.Orc });
    const hoarId = findCharInstanceId(base, RESOURCE_PLAYER, HOARMURATH);
    const state: GameState = {
      ...base,
      combat: {
        ...base.combat!,
        strikeAssignments: [{ characterId: hoarId, excessStrikes: 0, resolved: false }],
      },
    };

    expect(cancelActions(state)).toHaveLength(0);
  });

  // ── Outside combat ──────────────────────────────────────────────────────

  test('not offered as a generic short event outside combat', () => {
    const state = buildState({ phase: Phase.Organization });

    expect(
      viableActionsForHandCard(state, PLAYER_1, 'play-short-event', RESOURCE_PLAYER, HOARMURATH_UNLEASHED),
    ).toHaveLength(0);
  });
});
