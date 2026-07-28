/**
 * @module tw-364.test
 *
 * Card test: Wizard's River-horses (tw-364)
 * Type: hero-resource-event (short, spell), alignment wizard, 0 MP
 *
 * Card text:
 *   "Spell. Wizard only. All Nazgûl events are discarded or cancels an attack
 *    against a Wizard if he is the only character in the company. Wizard makes
 *    a corruption check modified by -2."
 *
 * Two modes, one card — the shape The Cock Crows (tw-342) established:
 *   1. Sweep: `move { select: 'filter-all', from: 'in-play', to: 'discard' }`
 *      filtered on the `Nazgûl` keyword, discarding every Nazgûl
 *      permanent-event in play (the Nine are dual creature/permanent-event
 *      cards — Adûnaphel tw-2, Ûvatha tw-107, … — and reach `cardsInPlay` only
 *      in their permanent-event mode). Carries `corruptionCheck: -2`, made by
 *      the `play-target` Wizard.
 *   2. Cancel: `cancel-attack` with `requiredRace: "wizard"`,
 *      `cost: { check: corruption, modifier: -2 }` and
 *      `when: { "bearer.companySize": 1 }` — "if he is the only character in
 *      the company" (allies do not count against it; they are not characters).
 *
 * Engine support:
 * | # | Feature                                            | Status      | Notes                                             |
 * |---|----------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Wizard only (both modes)                           | IMPLEMENTED | play-target filter target.race wizard / requiredRace |
 * | 2 | Sweep discards every Nazgûl permanent-event        | IMPLEMENTED | move filter-all in-play → discard (new)           |
 * | 3 | Sweep rides the chain (CoE 9.4/9.5 response window)| IMPLEMENTED | payload `discardAllInPlay` + chain-reducer branch  |
 * | 4 | Sweep unplayable with no Nazgûl in play            | IMPLEMENTED | legal-action gate in long-event.ts                |
 * | 5 | Cancel an attack on a lone Wizard                  | IMPLEMENTED | cancel-attack `when` bearer.companySize            |
 * | 6 | Not offered when the Wizard has company            | IMPLEMENTED | same `when` gate                                   |
 * | 7 | Wizard makes a corruption check modified by -2     | IMPLEMENTED | both modes enqueue a -2 corruption check           |
 * | 8 | Card discarded after play                          | IMPLEMENTED | chain / cancel-attack reducer                      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  addP2CardsInPlay,
  handCardId, companyIdAt, dispatch, resolveChain, expectInDiscardPile,
  findCharInstanceId,
  CardStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, PlayShortEventAction } from '../../index.js';

const RIVER_HORSES = 'tw-364' as CardDefinitionId;
/** Adûnaphel — one of the Nine, in play in her permanent-event mode. */
const ADUNAPHEL = 'tw-2' as CardDefinitionId;
/** Ûvatha the Horseman — a second Nazgûl permanent-event, to prove "all". */
const UVATHA = 'tw-107' as CardDefinitionId;
/**
 * The Nazgûl are Abroad — a hazard permanent-event *about* Nazgûl that is not
 * itself one (no `Nazgûl` keyword). The sweep must leave it in play.
 */
const NAZGUL_ARE_ABROAD = 'tw-96' as CardDefinitionId;

const adunaphelInPlay: CardInPlay = {
  instanceId: 'nz-1' as CardInstanceId,
  definitionId: ADUNAPHEL,
  status: CardStatus.Untapped,
};
const uvathaInPlay: CardInPlay = {
  instanceId: 'nz-2' as CardInstanceId,
  definitionId: UVATHA,
  status: CardStatus.Untapped,
};
const abroadInPlay: CardInPlay = {
  instanceId: 'nz-3' as CardInstanceId,
  definitionId: NAZGUL_ARE_ABROAD,
  status: CardStatus.Untapped,
};

describe("Wizard's River-horses (tw-364)", () => {
  beforeEach(() => resetMint());

  // ─── Mode 1: "All Nazgûl events are discarded" ──────────────────────────────

  test('sweep mode is offered in the long-event phase, targeting the Wizard', () => {
    const state = addP2CardsInPlay(buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [RIVER_HORSES], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }), [adunaphelInPlay]);

    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as PlayShortEventAction;
    expect(action.targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, GANDALF));
  });

  test('NOT playable when no Nazgûl permanent-event is in play', () => {
    const state = addP2CardsInPlay(buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [RIVER_HORSES], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      // Only a lookalike: a hazard permanent-event named after the Nazgûl.
    }), [abroadInPlay]);

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable without a Wizard in play (Spell. Wizard only.)', () => {
    const state = addP2CardsInPlay(buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [RIVER_HORSES], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }), [adunaphelInPlay]);

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('sweep rides the chain and discards every Nazgûl permanent-event in play', () => {
    const state = addP2CardsInPlay(buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [RIVER_HORSES], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }), [adunaphelInPlay, uvathaInPlay, abroadInPlay]);

    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    const declared = dispatch(state, plays[0].action);

    // Declaration only: the opponent is owed a response window, so nothing has
    // left play yet (CoE 9.4/9.5).
    expect(declared.chain).not.toBeNull();
    expect(declared.players[1].cardsInPlay).toHaveLength(3);

    const after = resolveChain(declared);

    // Both Nazgûl gone to their owner's discard; the lookalike stays in play.
    const stillInPlay = after.players[1].cardsInPlay.map(c => c.definitionId);
    expect(stillInPlay).toEqual([NAZGUL_ARE_ABROAD]);
    const oppDiscard = after.players[1].discardPile.map(c => c.definitionId);
    expect(oppDiscard).toContain(ADUNAPHEL);
    expect(oppDiscard).toContain(UVATHA);
  });

  test('sweep enqueues a -2 corruption check on the Wizard and discards the card', () => {
    const state = addP2CardsInPlay(buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [RIVER_HORSES], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }), [adunaphelInPlay]);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    const after = resolveChain(dispatch(state, plays[0].action));

    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    const cc = after.pendingResolutions[0].kind as { type: 'corruption-check'; modifier: number; characterId: CardInstanceId };
    expect(cc.modifier).toBe(-2);
    expect(cc.characterId).toBe(gandalfId);

    expect(after.players[0].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, RIVER_HORSES);
  });

  // ─── Mode 2: cancel an attack against a lone Wizard ──────────────────────────

  test('cancel mode is offered when the Wizard is the only character in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [RIVER_HORSES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, handCardId(stateAtMH, HAZARD_PLAYER), companyIdAt(stateAtMH, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const cancels = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancels).toHaveLength(1);
    expect((cancels[0].action as { scoutInstanceId?: CardInstanceId }).scoutInstanceId)
      .toBe(findCharInstanceId(combatState, RESOURCE_PLAYER, GANDALF));
  });

  test('cancel mode is NOT offered when another character shares the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [RIVER_HORSES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, handCardId(stateAtMH, HAZARD_PLAYER), companyIdAt(stateAtMH, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );

    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('cancel mode is NOT offered when the lone character is not a Wizard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [RIVER_HORSES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    });
    const stateAtMH = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, handCardId(stateAtMH, HAZARD_PLAYER), companyIdAt(stateAtMH, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );

    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('cancelling ends the combat, costs a -2 corruption check, and leaves Nazgûl in play alone', () => {
    const base = addP2CardsInPlay(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [RIVER_HORSES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [RIVENDELL] },
      ],
    }), [adunaphelInPlay]);
    const stateAtMH = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, handCardId(stateAtMH, HAZARD_PLAYER), companyIdAt(stateAtMH, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );

    const cancels = viableActions(combatState, PLAYER_1, 'cancel-attack');
    const declared = dispatch(combatState, cancels[0].action);

    expect(declared.players[0].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, RIVER_HORSES);
    expect(declared.pendingResolutions).toHaveLength(1);
    const cc = declared.pendingResolutions[0].kind as { type: 'corruption-check'; modifier: number; characterId: CardInstanceId };
    expect(cc.type).toBe('corruption-check');
    expect(cc.modifier).toBe(-2);
    expect(cc.characterId).toBe(findCharInstanceId(combatState, RESOURCE_PLAYER, GANDALF));

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expectInDiscardPile(after, HAZARD_PLAYER, ORC_PATROL);

    // The cancel mode is *not* the sweep: Adûnaphel is still in play.
    expect(after.players[1].cardsInPlay.map(c => c.definitionId)).toContain(ADUNAPHEL);
  });
});
