/**
 * @module dm-143.test
 *
 * Card test: The Hunt (dm-143)
 * Type: hero-resource-event (short), alignment wizard, non-unique, 0 MP
 *
 * Card text:
 *   "Playable on Alatar during the organization phase. Name a specific hazard
 *    creature card your opponent revealed to you through a mechanism of the
 *    game and discarded. Unless eliminated or prevented from being in play,
 *    your opponent then finds this particular card (reshuffling his play deck
 *    if it was searched). This creature immediately attacks Alatar as though
 *    he were a one-character company. Alatar cannot use or benefit from
 *    spells against the attack. If untapped, tap Alatar afterwards."
 *
 * Effects:
 *   1. play-window organization
 *   2. play-target character filter target.name "Alatar" (no cost)
 *   3. named-creature-hunt — the whole mechanic (see engine/hunt.ts)
 *
 * "Revealed to you ... and discarded" is modeled by
 * `GameState.revealedInstances`: only a hazard-creature instance recorded
 * there (still sitting in the opponent's play deck or discard pile) is a
 * legal candidate — this is CRF 22's broad reading ("the discarding and
 * revealing of the card do not have to be in any specific order"), so a
 * creature merely seen attacking counts, not just one exposed by an explicit
 * hand/deck-reveal effect. Playing the card discards it immediately and enqueues a
 * `hunt-target-choice` pending resolution; naming a candidate builds a
 * `hunt-attack` combat with `soloDefenderInstanceId` (one-character company)
 * and `spellsIneffective` (no spell may cancel it or boost against it);
 * naming nothing (no candidate) is a mandatory `pass` — a fizzle with no tap.
 * The bearer is tapped (if untapped) once the forced attack concludes,
 * whether finalized or canceled.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, dispatch, executeAction, findInPile, findCharInstanceId, findHandCardId,
  companyIdAt, expectCharStatus, assertEveryInstanceReachable, revealOpponentPileInstances,
  makeMHState, playCreatureHazardAndResolve,
  CAVE_DRAKE, ORC_PATROL, GLAMDRING, VANISHMENT, pool,
} from '../test-helpers.js';
import { CardStatus, RegionType, SiteType, describeAction } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, ChooseHuntTargetAction } from '../../index.js';

const THE_HUNT = 'dm-143' as CardDefinitionId;
const ALATAR = 'tw-117' as CardDefinitionId;
const WIZARDS_FLAME = 'tw-361' as CardDefinitionId;

/**
 * An organization-phase state: P1 (active) has Alatar (plus an optional extra
 * company-mate) at Rivendell holding The Hunt; P2's play deck / discard pile
 * are configurable (the piles The Hunt may search).
 */
function huntState(opts: {
  alatarStatus?: CardStatus;
  extraChar?: CardDefinitionId;
  hand?: CardDefinitionId[];
  p2Deck?: CardDefinitionId[];
  p2Discard?: CardDefinitionId[];
} = {}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{
          site: RIVENDELL,
          characters: [
            opts.alatarStatus ? { defId: ALATAR, status: opts.alatarStatus } : ALATAR,
            ...(opts.extraChar ? [opts.extraChar] : []),
          ],
        }],
        hand: opts.hand ?? [THE_HUNT],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        playDeck: opts.p2Deck ?? [],
        discardPile: opts.p2Discard ?? [],
      },
    ],
  });
}

/** The play-short-event action for The Hunt (targeting Alatar). */
function huntPlayAction(state: GameState): PlayShortEventAction {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, THE_HUNT);
  const ea = viableActions(state, PLAYER_1, 'play-short-event')
    .find(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
  expect(ea).toBeDefined();
  return ea!.action as PlayShortEventAction;
}

/** Play The Hunt (discards it immediately, enqueues hunt-target-choice). */
function playHunt(state: GameState): GameState {
  return dispatch(state, huntPlayAction(state));
}

/**
 * Assign every strike of the active combat to Alatar (the solo defender —
 * excess strikes pile onto the one legal target) and resolve each with a high
 * roll so he parries. Returns the state once combat finalizes.
 */
function resolveSoloAttackAgainstAlatar(state: GameState): GameState {
  let working = state;
  // Assignment alternates between the defender (Alatar's controller) and the
  // attacker (the creature's controller), who piles the remaining strikes
  // onto Alatar as excess once he's the only unassigned-or-assignable target.
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
  return working;
}

/** A path keying Orc-patrol ({w} region type) ending at a Ruins & Lairs, for the M/H control test. */
const orcPath = () => makeMHState({
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Hithaeglir'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
});

describe('The Hunt (dm-143)', () => {
  beforeEach(() => resetMint());

  // ── play-window / play-target ────────────────────────────────────────────

  test('not offered outside the organization phase', () => {
    const state = { ...huntState(), phaseState: { phase: Phase.LongEvent } as GameState['phaseState'] };
    const cardId = findHandCardId(state, RESOURCE_PLAYER, THE_HUNT);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not playable without Alatar in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [THE_HUNT], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, THE_HUNT);
    const plays = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as PlayShortEventAction).cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playable on Alatar during the organization phase, targeting him', () => {
    const state = huntState();
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    const action = huntPlayAction(state);
    expect(action.targetCharacterId).toBe(alatarId);
  });

  // ── Candidate discovery ──────────────────────────────────────────────────

  test('fizzles (mandatory pass, no tap) when the opponent holds no revealed hazard creature', () => {
    // Present in the discard pile, but never revealed to the controller.
    const state = huntState({ p2Discard: [ORC_PATROL] });
    const afterPlay = playHunt(state);

    expect(afterPlay.pendingResolutions.some(r => r.kind.type === 'hunt-target-choice')).toBe(true);
    expect(viableActions(afterPlay, PLAYER_1, 'choose-hunt-target')).toHaveLength(0);
    expect(viableActions(afterPlay, PLAYER_1, 'pass').length).toBeGreaterThan(0);

    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat).toBeNull();
    expect(afterPass.pendingResolutions.some(r => r.kind.type === 'hunt-target-choice')).toBe(false);
    expectCharStatus(afterPass, RESOURCE_PLAYER, ALATAR, CardStatus.Untapped);
    assertEveryInstanceReachable(afterPass);
  });

  test('excludes a revealed non-creature card from the candidate list', () => {
    const state0 = huntState({ p2Discard: [GLAMDRING] });
    const glamdringId = findInPile(state0, HAZARD_PLAYER, 'discardPile', GLAMDRING)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [glamdringId]);
    const afterPlay = playHunt(state);
    expect(viableActions(afterPlay, PLAYER_1, 'choose-hunt-target')).toHaveLength(0);
  });

  test('names a revealed hazard creature sitting in the opponent discard pile — attacks in place, no reshuffle', () => {
    const state0 = huntState({ p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    const afterPlay = playHunt(state);

    const offered = viableActions(afterPlay, PLAYER_1, 'choose-hunt-target');
    expect(offered).toHaveLength(1);
    expect((offered[0].action as ChooseHuntTargetAction).creatureInstanceId).toBe(orcId);

    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });
    expect(afterChoice.combat).not.toBeNull();
    const combat = afterChoice.combat!;
    expect(combat.attackSource.type).toBe('hunt-attack');
    if (combat.attackSource.type === 'hunt-attack') {
      expect(combat.attackSource.creatureInstanceId).toBe(orcId);
      expect(combat.attackSource.bearerInstanceId).toBe(alatarId);
    }
    expect(combat.defendingPlayerId).toBe(PLAYER_1);
    expect(combat.attackingPlayerId).toBe(PLAYER_2);
    expect(combat.companyId as string).toBe(companyIdAt(afterChoice, RESOURCE_PLAYER));
    expect(combat.creatureRace).toBe('orc');
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(6);
    expect(combat.soloDefenderInstanceId).toBe(alatarId);
    expect(combat.spellsIneffective).toBe(true);
    // Stays right where it was — no card ever disappears.
    expect(findInPile(afterChoice, HAZARD_PLAYER, 'discardPile', orcId)).toBeDefined();
    assertEveryInstanceReachable(afterChoice);
  });

  test('names a revealed hazard creature sitting in the opponent play deck — reshuffles the deck, attacks in place', () => {
    const state0 = huntState({ p2Deck: [CAVE_DRAKE, GLAMDRING, GLAMDRING] });
    const drakeId = findInPile(state0, HAZARD_PLAYER, 'playDeck', CAVE_DRAKE)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [drakeId]);
    const afterPlay = playHunt(state);
    const deckSizeBefore = afterPlay.players[HAZARD_PLAYER].playDeck.length;

    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: drakeId, definitionId: CAVE_DRAKE });
    expect(afterChoice.combat).not.toBeNull();
    if (afterChoice.combat!.attackSource.type === 'hunt-attack') {
      expect(afterChoice.combat!.attackSource.creatureInstanceId).toBe(drakeId);
    }
    expect(afterChoice.combat!.creatureRace).toBe('dragon');
    expect(afterChoice.combat!.strikesTotal).toBe(2);
    expect(afterChoice.combat!.strikeProwess).toBe(10);
    // Deck is intact (no card lost) after the reshuffle, the drake still in it.
    expect(afterChoice.players[HAZARD_PLAYER].playDeck).toHaveLength(deckSizeBefore);
    expect(findInPile(afterChoice, HAZARD_PLAYER, 'playDeck', drakeId)).toBeDefined();
    assertEveryInstanceReachable(afterChoice);
  });

  test('offers a creature known only from having attacked (revealedInstances), not an explicit hand/deck reveal', () => {
    // CRF 22 (The Hunt): "the discarding and revealing of the card do not
    // have to be in any specific order" — a creature that attacked earlier
    // in the game (publicly seen, then later reshuffled back into the play
    // deck once discarded) counts as "revealed to you" even though no
    // explicit reveal effect (Riddling Talk, a peek, ...) ever ran on it.
    const state0 = huntState({ p2Deck: [CAVE_DRAKE, GLAMDRING, GLAMDRING] });
    const drakeId = findInPile(state0, HAZARD_PLAYER, 'playDeck', CAVE_DRAKE)!.instanceId;
    const state = {
      ...state0,
      revealedInstances: { ...state0.revealedInstances, [drakeId]: CAVE_DRAKE },
    };
    expect(state.handRevealedInstances[drakeId]).toBeUndefined();
    const afterPlay = playHunt(state);

    const offered = viableActions(afterPlay, PLAYER_1, 'choose-hunt-target');
    expect(offered).toHaveLength(1);
    expect((offered[0].action as ChooseHuntTargetAction).creatureInstanceId).toBe(drakeId);
  });

  test('names the creature in its description even though the acting player\'s own view redacts the instance', () => {
    // Bug report: a candidate known only via the broad `revealedInstances`
    // ledger (see the test above) is still fully redacted in the acting
    // player's own PlayerView of the opponent's deck/discard pile — that
    // pile is unredacted from the narrower `handRevealedInstances` only.
    // With no card-name label on the offered action, every "choose-hunt-target"
    // button rendered client-side described an indistinguishable "a card",
    // leaving the human unable to make an informed choice ("hangs"). The
    // action must carry its own `definitionId` so the choice stays legible
    // without depending on the (redacted) instance lookup at all.
    const state0 = huntState({ p2Deck: [CAVE_DRAKE, GLAMDRING, GLAMDRING] });
    const drakeId = findInPile(state0, HAZARD_PLAYER, 'playDeck', CAVE_DRAKE)!.instanceId;
    const state = {
      ...state0,
      revealedInstances: { ...state0.revealedInstances, [drakeId]: CAVE_DRAKE },
    };
    const afterPlay = playHunt(state);

    const offered = viableActions(afterPlay, PLAYER_1, 'choose-hunt-target');
    expect(offered).toHaveLength(1);
    const action = offered[0].action as ChooseHuntTargetAction;
    expect(action.definitionId).toBe(CAVE_DRAKE);

    // No instanceLookup passed — exactly what a client sees once the
    // opponent's deck/discard pile is redacted to UNKNOWN_CARD.
    const desc = describeAction(action, pool);
    expect(desc).toContain('Cave-drake');
  });

  test('sweeps every offered candidate into handRevealedInstances so the naming player\'s client can show its identity', () => {
    // Regression for bug 3b44552654241d9c (game msrxe5s2-rwhk9n, seq 1402):
    // `findHuntCandidates` deliberately reads the broad `revealedInstances`
    // ledger (CRF 22 — a creature merely seen attacking counts), but
    // `projection.ts` only redacts the opponent's play-deck/discard-pile view
    // against the narrower `handRevealedInstances`. Without sweeping the
    // offered candidates into that narrower map too, the naming player would
    // be forced to choose blind among candidates their own client shows only
    // as "a card" — playing The Hunt must reveal them so the choice is
    // actually meaningful.
    const state0 = huntState({ p2Deck: [CAVE_DRAKE], p2Discard: [ORC_PATROL] });
    const drakeId = findInPile(state0, HAZARD_PLAYER, 'playDeck', CAVE_DRAKE)!.instanceId;
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [drakeId, orcId]);
    expect(state.handRevealedInstances[drakeId]).toBeUndefined();
    expect(state.handRevealedInstances[orcId]).toBeUndefined();

    const afterPlay = playHunt(state);

    expect(viableActions(afterPlay, PLAYER_1, 'choose-hunt-target')).toHaveLength(2);
    expect(afterPlay.handRevealedInstances[drakeId]).toBe(CAVE_DRAKE);
    expect(afterPlay.handRevealedInstances[orcId]).toBe(ORC_PATROL);
  });

  // ── "As though he were a one-character company" ─────────────────────────

  test('the creature attacks Alatar alone even when his company has other characters', () => {
    const state0 = huntState({ extraChar: ARAGORN, p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    const afterPlay = playHunt(state);
    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });

    expect(afterChoice.combat!.soloDefenderInstanceId).toBe(alatarId);
    const strikeTargets = new Set(
      viableActions(afterChoice, PLAYER_1, 'assign-strike')
        .map(a => (a.action as { characterId: CardInstanceId }).characterId),
    );
    expect(strikeTargets).toEqual(new Set([alatarId]));
  });

  // ── "Cannot use or benefit from spells against the attack" ──────────────

  test('cannot play Vanishment (a spell) to cancel the forced attack', () => {
    const state0 = huntState({ hand: [THE_HUNT, VANISHMENT], p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const afterPlay = playHunt(state);
    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });

    expect(viableActions(afterChoice, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('control: Vanishment IS offered against a normal (non-Hunt) creature attack on Alatar', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ALATAR] }], hand: [VANISHMENT], siteDeck: [MINAS_TIRITH] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ORC_PATROL], siteDeck: [MINAS_TIRITH] },
        ],
      }),
      phaseState: orcPath(),
    };
    const orcId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === ORC_PATROL)!.instanceId;
    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, orcId, companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.spellsIneffective).toBeFalsy();
    expect(viableActions(after, PLAYER_1, 'cancel-attack').length).toBeGreaterThan(0);
  });

  test('an active Wizard\'s Flame prowess-reduction constraint does not apply to the forced attack', () => {
    const state0 = huntState({ p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const revealed = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const alatarCompanyId = companyIdAt(revealed, RESOURCE_PLAYER);
    const state = addConstraint(revealed, {
      source: 'flame-instance-1' as never,
      sourceDefinitionId: WIZARDS_FLAME,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: alatarCompanyId },
      kind: { type: 'creature-attack-boost', strikes: 0, prowess: -2 },
    });
    const afterPlay = playHunt(state);
    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });

    // Orc-patrol's printed prowess is 6; the -2 spell boost must not apply.
    expect(afterChoice.combat!.strikeProwess).toBe(6);
  });

  // ── "If untapped, tap Alatar afterwards" ─────────────────────────────────

  test('taps Alatar (was untapped) once the forced attack finalizes', () => {
    const state0 = huntState({ p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const afterPlay = playHunt(state);
    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });
    expectCharStatus(afterChoice, RESOURCE_PLAYER, ALATAR, CardStatus.Untapped);

    const working = resolveSoloAttackAgainstAlatar(afterChoice);
    expectCharStatus(working, RESOURCE_PLAYER, ALATAR, CardStatus.Tapped);
    assertEveryInstanceReachable(working);
  });

  test('leaves an already-tapped Alatar tapped after the forced attack finalizes', () => {
    const state0 = huntState({ alatarStatus: CardStatus.Tapped, p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const afterPlay = playHunt(state);
    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });

    const working = resolveSoloAttackAgainstAlatar(afterChoice);
    expectCharStatus(working, RESOURCE_PLAYER, ALATAR, CardStatus.Tapped);
  });

  test('taps Alatar (was untapped) even when the forced attack is canceled', () => {
    const state0 = huntState({ p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const afterPlay = playHunt(state);
    const huntInstanceId = findInPile(afterPlay, RESOURCE_PLAYER, 'discardPile', THE_HUNT)!.instanceId;
    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });
    expect(afterChoice.combat).not.toBeNull();

    // Grant a free (non-spell) cancellation and consume it — the spell ban
    // only blocks spell-keyword cards, not every cancellation mechanism.
    const withGrant = addConstraint(afterChoice, {
      source: huntInstanceId,
      sourceDefinitionId: THE_HUNT,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'free-attack-cancel', restrictToBalrogCompany: false },
    });
    const afterCancel = dispatch(withGrant, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: huntInstanceId, mode: 'free-later-cancel',
    });
    expect(afterCancel.combat).toBeNull();
    expectCharStatus(afterCancel, RESOURCE_PLAYER, ALATAR, CardStatus.Tapped);
    assertEveryInstanceReachable(afterCancel);
  });

  // ── Kill marshalling points on defeat (CoE rule 964) ─────────────────────

  test('awards kill marshalling points: defeating the named creature moves it to the defender\'s kill pile', () => {
    const state0 = huntState({ p2Discard: [ORC_PATROL] });
    const orcId = findInPile(state0, HAZARD_PLAYER, 'discardPile', ORC_PATROL)!.instanceId;
    const state = revealOpponentPileInstances(state0, HAZARD_PLAYER, [orcId]);
    const afterPlay = playHunt(state);
    const afterChoice = dispatch(afterPlay, { type: 'choose-hunt-target', player: PLAYER_1, creatureInstanceId: orcId, definitionId: ORC_PATROL });

    const working = resolveSoloAttackAgainstAlatar(afterChoice);
    expect(working.combat).toBeNull();
    expect(findInPile(working, HAZARD_PLAYER, 'discardPile', orcId)).toBeUndefined();
    expect(findInPile(working, RESOURCE_PLAYER, 'killPile', orcId)).toBeDefined();
    assertEveryInstanceReachable(working);
  });
});
