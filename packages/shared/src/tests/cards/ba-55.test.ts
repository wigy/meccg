/**
 * @module ba-55.test
 *
 * Card test: Darkness Wielded (ba-55)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable on an attack against The Balrog's company if
 *    Great Shadow is in play. You may bring this card from your sideboard into
 *    your play deck and reshuffle during your organization phase. The attack
 *    receives -2 prowess, -1 body, and is reduced to one strike. Alternatively,
 *    cancel this attack and a latter attack of your choice against his company
 *    this turn."
 *
 * Rules:
 *   1. Play gate — a combat card played by the DEFENDER (the Balrog player) on
 *      an attack against a company that contains The Balrog, and only while
 *      Great Shadow is in play. Great Shadow (ba-62) is a Demon fána held on The
 *      Balrog, so the gate is attachment-aware (`defender.inPlay`) and requires
 *      `defender.companyContainsBalrog`.
 *   2. Mode 1 — `modify-attack` (fromHand, player "defender"): the attack gets
 *      -2 prowess, -1 body, and is reduced to exactly one strike (`setStrikesTo`).
 *   3. Mode 2 — `cancel-attack` with `alsoCancelLaterAttack`: cancels this attack
 *      and grants a turn-scoped `free-attack-cancel` constraint so a *later*
 *      attack against The Balrog's company may be cancelled for free.
 *   4. Sideboard self-relocation — a `move` (`select: self`, `from: sideboard`,
 *      `to: deck`, `shuffleAfter`) surfaced during the organization phase as a
 *      `card-sideboard-to-deck` action.
 *
 * "Balrog specific" is a deck-construction keyword (`balrog-specific`), no
 * play-time gate — per the ba-45/ba-46 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                              | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Mode 1 offered to the defender when Balrog company + Great Shadow  | IMPLEMENTED |
 * | 2 | Mode 1 NOT offered without Great Shadow in play                    | IMPLEMENTED |
 * | 3 | Mode 1 NOT offered when the company lacks The Balrog               | IMPLEMENTED |
 * | 4 | Mode 1 applies -2 prowess / -1 body / reduce to one strike; discard| IMPLEMENTED |
 * | 5 | Mode 2 cancel-attack offered under the same gate                   | IMPLEMENTED |
 * | 6 | Mode 2 cancels the attack AND grants a free-attack-cancel this turn| IMPLEMENTED |
 * | 7 | The grant lets a later Balrog-company attack be cancelled for free | IMPLEMENTED |
 * | 8 | The free cancel is NOT offered against a non-Balrog company        | IMPLEMENTED |
 * | 9 | A sideboard copy offers card-sideboard-to-deck in the org phase    | IMPLEMENTED |
 * |10 | Dispatching it moves the card sideboard → play deck                | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   DARKNESS_WIELDED (ba-55) - minion short event (this card)
 *   GREAT_SHADOW (ba-62)     - minion permanent-event (Demon fána on The Balrog)
 *   THE_BALROG (ba-3)        - minion balrog avatar
 *   ORC_CAPTAIN (le-31)      - minion orc (non-Balrog company filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch, resolveChain,
  makeCancelWindowCombat, addP1CardsInPlay,
  findHandCardId, expectInDiscardPile,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
} from '../test-helpers.js';
import { Alignment, CardStatus, Race } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, CardInPlay } from '../../index.js';

const DARKNESS_WIELDED = 'ba-55' as CardDefinitionId;
const GREAT_SHADOW = 'ba-62' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;

/**
 * A movement/hazard state whose defending company (PLAYER_1, the Balrog player)
 * is at MORIA facing an automatic-attack. The company holds `characters`; the
 * card is in PLAYER_1's hand.
 */
function defendingCombat(opts: {
  characters: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'];
  hand?: CardDefinitionId[];
  strikesTotal?: number;
  strikeProwess?: number;
  creatureBody?: number | null;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: opts.characters }],
        hand: opts.hand ?? [DARKNESS_WIELDED], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  const combat = makeCancelWindowCombat(base, {
    attackSourceType: 'automatic-attack',
    creatureRace: Race.Orc,
    strikesTotal: opts.strikesTotal ?? 3,
    strikeProwess: opts.strikeProwess ?? 11,
  });
  return opts.creatureBody !== undefined
    ? { ...combat, combat: { ...combat.combat!, creatureBody: opts.creatureBody } }
    : combat;
}

describe('Darkness Wielded (ba-55)', () => {
  beforeEach(() => resetMint());

  // ─── Mode 1: modify-attack (-2 prowess, -1 body, reduce to one strike) ──────

  test('the defender is offered mode 1 (modify-attack) when the Balrog company has Great Shadow in play', () => {
    const combat = defendingCombat({
      characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }],
    });
    const actions = viableActions(combat, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { cardInstanceId: CardInstanceId }).cardInstanceId).toBe(combat.players[RESOURCE_PLAYER].hand[0].instanceId);
    // The attacker (hazard player) may never play this defender card.
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('mode 1 is NOT offered when Great Shadow is not in play', () => {
    const combat = defendingCombat({
      characters: [THE_BALROG], // Balrog present, but no Great Shadow
    });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
    expect(viableActions(combat, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('mode 1 is NOT offered when the defending company does not contain The Balrog', () => {
    // Great Shadow is in play (bare in cardsInPlay), but the defending company
    // has no Balrog — the "against The Balrog's company" gate must fail.
    let combat = defendingCombat({ characters: [ORC_CAPTAIN] });
    combat = addP1CardsInPlay(combat, [
      { instanceId: 'gs-bare' as CardInstanceId, definitionId: GREAT_SHADOW, status: CardStatus.Untapped },
    ] as CardInPlay[]);
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
    expect(viableActions(combat, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('mode 1 applies -2 prowess, -1 body, reduces the attack to one strike, and discards the card', () => {
    const combat = defendingCombat({
      characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }],
      strikesTotal: 3,
      strikeProwess: 11,
      creatureBody: 8,
    });
    const cardInstance = findHandCardId(combat, RESOURCE_PLAYER, DARKNESS_WIELDED);
    const action = viableActions(combat, PLAYER_1, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(9);  // 11 - 2
    expect(after.combat!.creatureBody).toBe(7);   // 8 - 1
    expect(after.combat!.strikesTotal).toBe(1);   // reduced to one strike (from 3)
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  // ─── Mode 2: cancel this attack + a later attack this turn ──────────────────

  test('the defender is offered mode 2 (cancel-attack) under the same gate', () => {
    const combat = defendingCombat({
      characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }],
    });
    const cancels = viableActions(combat, PLAYER_1, 'cancel-attack');
    expect(cancels.length).toBeGreaterThanOrEqual(1);
    expect(cancels.some(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === combat.players[RESOURCE_PLAYER].hand[0].instanceId)).toBe(true);
  });

  test('mode 2 cancels the attack and grants a turn-scoped free-attack-cancel for the Balrog player', () => {
    const combat = defendingCombat({
      characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }],
    });
    const cardInstance = findHandCardId(combat, RESOURCE_PLAYER, DARKNESS_WIELDED);
    const action = viableActions(combat, PLAYER_1, 'cancel-attack')
      .find(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === cardInstance)!.action;
    // Costless cancel routes through the chain; resolve it to completion.
    const after = resolveChain(dispatch(combat, action));

    expect(after.combat).toBeNull(); // this attack was cancelled
    const grants = after.activeConstraints.filter(c => c.kind.type === 'free-attack-cancel');
    expect(grants).toHaveLength(1);
    expect(grants[0].scope.kind).toBe('turn');
    if (grants[0].target.kind === 'player') expect(grants[0].target.playerId).toBe(PLAYER_1);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('the free-attack-cancel grant lets a LATER attack against the Balrog company be cancelled for free', () => {
    // A grant is present (as if Darkness Wielded's cancel mode resolved earlier
    // this turn). A new attack against the Balrog company is offered a costless
    // free-later-cancel that consumes the grant.
    let combat = defendingCombat({
      characters: [{ defId: THE_BALROG, items: [GREAT_SHADOW] }],
      hand: [], // no card in hand — the free cancel needs none
    });
    combat = {
      ...combat,
      activeConstraints: [
        ...combat.activeConstraints,
        {
          id: 'grant-1' as unknown as (typeof combat.activeConstraints)[number]['id'],
          source: 'dw-1' as CardInstanceId,
          sourceDefinitionId: DARKNESS_WIELDED,
          scope: { kind: 'turn' },
          target: { kind: 'player', playerId: PLAYER_1 },
          kind: { type: 'free-attack-cancel', restrictToBalrogCompany: true },
        },
      ],
    };
    const free = viableActions(combat, PLAYER_1, 'cancel-attack')
      .filter(ea => (ea.action as { mode?: string }).mode === 'free-later-cancel');
    expect(free).toHaveLength(1);

    const after = dispatch(combat, free[0].action);
    expect(after.combat).toBeNull(); // the later attack was cancelled
    // Grant consumed.
    expect(after.activeConstraints.filter(c => c.kind.type === 'free-attack-cancel')).toHaveLength(0);
  });

  test('the free-later-cancel is NOT offered when the defending company lacks The Balrog', () => {
    let combat = defendingCombat({ characters: [ORC_CAPTAIN], hand: [] });
    combat = {
      ...combat,
      activeConstraints: [
        ...combat.activeConstraints,
        {
          id: 'grant-2' as unknown as (typeof combat.activeConstraints)[number]['id'],
          source: 'dw-2' as CardInstanceId,
          sourceDefinitionId: DARKNESS_WIELDED,
          scope: { kind: 'turn' },
          target: { kind: 'player', playerId: PLAYER_1 },
          kind: { type: 'free-attack-cancel', restrictToBalrogCompany: true },
        },
      ],
    };
    const free = viableActions(combat, PLAYER_1, 'cancel-attack')
      .filter(ea => (ea.action as { mode?: string }).mode === 'free-later-cancel');
    expect(free).toHaveLength(0);
  });

  // ─── Sideboard self-relocation ──────────────────────────────────────────────

  test('a sideboard copy offers a card-sideboard-to-deck action during the org phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [THE_BALROG] }],
          hand: [], sideboard: [DARKNESS_WIELDED], playDeck: [MINAS_TIRITH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const offers = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')
      .map(ea => ea.action as { cardInstanceId: CardInstanceId });
    expect(offers).toHaveLength(1);
    expect(offers[0].cardInstanceId).toBe(sideboardInst);
  });

  test('dispatching card-sideboard-to-deck moves the card from the sideboard into the play deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [THE_BALROG] }],
          hand: [], sideboard: [DARKNESS_WIELDED], playDeck: [MINAS_TIRITH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const sideboardInst = state.players[RESOURCE_PLAYER].sideboard[0].instanceId;
    const action = viableActions(state, PLAYER_1, 'card-sideboard-to-deck')[0].action;
    const after = dispatch(state, action);

    expect(after.players[RESOURCE_PLAYER].sideboard.map(c => c.instanceId)).not.toContain(sideboardInst);
    expect(after.players[RESOURCE_PLAYER].playDeck.map(c => c.instanceId)).toContain(sideboardInst);
    expect(after.players[RESOURCE_PLAYER].playDeck).toHaveLength(2);
  });
});
