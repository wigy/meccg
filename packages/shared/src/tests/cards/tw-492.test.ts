/**
 * @module tw-492.test
 *
 * Card test: Fury of the Iron Crown (tw-492)
 * Type: hazard-event (short)
 *
 * "Unique. May not be played if The Iron Crown is in play. The prowess of
 *  one strike of an attack by an Orc, Troll, Man, or Nazgûl creature is
 *  increased by +4. After the attack is resolved, if the creature is not a
 *  Nazgûl: the creature is removed from play (defender receives the
 *  marshalling points); and, in addition, if the defender has The Iron Crown
 *  in his hand, he may immediately play it with a character in the
 *  defending company."
 *
 * Engine Support:
 * | # | Rule                                             | Status      | Notes                                     |
 * |---|---------------------------------------------------|-------------|--------------------------------------------|
 * | 1 | Playable only during an Orc/Troll/Man/Nazgûl       | IMPLEMENTED | play-window combat/resolve-strike +       |
 * |   | creature attack                                    |             | play-target filter on attack.race.        |
 * | 2 | May not be played if The Iron Crown is in play     | IMPLEMENTED | play-condition card-not-in-play, checked  |
 * |   |                                                     |             | in combatHazardPermanentPlays; extended   |
 * |   |                                                     |             | isCardNameInPlayOrCharacters to scan items.|
 * | 3 | +4 prowess to the current strike; resolves and     | IMPLEMENTED | short-event on-event self-enters-play-    |
 * |   | discards immediately (does not attach)             |             | combat + modify-current-strike-prowess.   |
 * | 4 | After the attack resolves, if not a Nazgûl: the    | IMPLEMENTED | force-attacker-kill-on-resolution apply,  |
 * |   | creature is removed from play and the defender     |             | consumed by finalizeCombat regardless of  |
 * |   | receives the marshalling points                    |             | the strike's true outcome.                |
 * | 5 | Nazgûl are exempt from the forced kill              | IMPLEMENTED | excludeRace: "ringwraith" on the apply.   |
 * | 6 | If the defender holds The Iron Crown in hand, he   | IMPLEMENTED | named-card-play-offer pending resolution, |
 * |   | may immediately play it onto a defending character |             | enqueued from finalizeCombat.             |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, executeAction, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  companyIdAt, findCharInstanceId, dispatch, viableActions, viableFor,
  expectInDiscardPile, attachItemToChar, addP2CardsInPlay,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, CombatState, GameState,
  PlayHazardAction,
} from '../../index.js';
import { CardStatus, Race } from '../../index.js';

const FURY_OF_THE_IRON_CROWN = 'tw-492' as CardDefinitionId;
const THE_IRON_CROWN = 'tw-496' as CardDefinitionId;
/** Any Orc hazard creature — only needs to physically exist in cardsInPlay for finalizeCombat's disposal logic. */
const ORC_CREATURE = 'tw-074' as CardDefinitionId;
const CREATURE_ID = 'fury-creature-1' as CardInstanceId;

/**
 * Build a resolve-strike combat state: Aragorn (prowess 6, body 9) alone in
 * a company, facing a single strike from a real creature card instance
 * (so finalizeCombat's kill-pile/discard disposal logic has something to
 * move), with Fury of the Iron Crown in the hazard player's hand.
 */
function makeFuryResolveStrikeState(opts: {
  creatureRace?: Race;
  cardInHand?: boolean;
  strikeProwess?: number;
  ironCrownInDefenderHand?: boolean;
  ironCrownAttachedToDefender?: boolean;
}): { state: GameState } {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: opts.ironCrownInDefenderHand ? [THE_IRON_CROWN] : [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts.cardInHand === false ? [] : [FURY_OF_THE_IRON_CROWN],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  // Combat-window hazard plays also consult hazard-limit bookkeeping once a
  // company-targeting constraint exists (see tw-115's test scaffolding note).
  const withMhState: GameState = {
    ...base,
    phaseState: {
      ...base.phaseState,
      hazardLimitAtReveal: 4,
      preRevealHazardLimitConstraintIds: [],
      hazardsEncountered: [],
    } as GameState['phaseState'],
  };
  const withIronCrown = opts.ironCrownAttachedToDefender
    ? attachItemToChar(withMhState, RESOURCE_PLAYER, ARAGORN, THE_IRON_CROWN)
    : withMhState;
  const withCreature = addP2CardsInPlay(withIronCrown, [
    { instanceId: CREATURE_ID, definitionId: ORC_CREATURE, status: CardStatus.Untapped } as CardInPlay,
  ]);

  const aragornId = findCharInstanceId(withCreature, RESOURCE_PLAYER, ARAGORN);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: CREATURE_ID },
    companyId: companyIdAt(withCreature, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess ?? 30,
    creatureBody: null,
    creatureRace: opts.creatureRace ?? Race.Orc,
    strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { state: { ...withCreature, combat } };
}

describe('Fury of the Iron Crown (tw-492)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable only vs Orc/Troll/Man/Nazgûl attacks ──────────────

  test('offered against an Orc creature attack', () => {
    const { state } = makeFuryResolveStrikeState({});
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.length).toBeGreaterThan(0);
  });

  test('offered against a Nazgûl (Ringwraith) creature attack', () => {
    const { state } = makeFuryResolveStrikeState({ creatureRace: Race.Ringwraith });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT offered against a Wolf creature attack (not Orc/Troll/Man/Nazgûl)', () => {
    const { state } = makeFuryResolveStrikeState({ creatureRace: Race.Wolf });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 2: may not be played if The Iron Crown is in play ─────────────

  test('NOT offered while The Iron Crown is attached to a character in play', () => {
    const { state } = makeFuryResolveStrikeState({ ironCrownAttachedToDefender: true });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 3: +4 prowess to the current strike; resolves and discards ────

  test('playing the card discards it immediately and adds +4 to the strike (defender -4)', () => {
    const { state } = makeFuryResolveStrikeState({});
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(1);
    const next = dispatch(state, plays[0].action);

    // Never attaches to the target's hazards.
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(0);
    // Discards straight to the hazard player's discard pile.
    expectInDiscardPile(next, HAZARD_PLAYER, FURY_OF_THE_IRON_CROWN);

    // +4 to the attack's strike prowess == -4 to the defender's effective
    // prowess on that strike (engine convention, see combat-hazard-play.ts).
    const currentStrike = next.combat!.strikeAssignments[next.combat!.currentStrikeIndex];
    expect(currentStrike.strikeProwessBonus).toBe(-4);

    // Forced-kill schedule recorded on the combat state for finalizeCombat.
    expect(next.combat!.forcedCreatureKillOnResolution).toEqual({
      excludeRace: Race.Ringwraith,
      offerCardName: 'The Iron Crown',
    });
  });

  // ─── Rule 4: forced kill + marshalling points regardless of outcome ─────

  test('creature is forced into the defender\'s kill pile even though it WON the strike (character merely wounded)', () => {
    const { state } = makeFuryResolveStrikeState({ strikeProwess: 30 });

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const afterPlay = dispatch(state, plays[0].action);

    // Aragorn (prowess 6, -4 from the card) cannot beat strike prowess 30
    // regardless of roll or tap — the creature wins this strike outright.
    let s = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 12, true);
    expect(s.combat?.bodyCheckTarget).toBe('character');
    // Aragorn's body is 9; a low roll of 2 survives as wounded (the body
    // check eliminates only when the roll exceeds body).
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);

    // Combat finalized.
    expect(s.combat).toBeNull();
    // Aragorn survived, merely wounded.
    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    expect(s.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();

    // Despite the creature having WON the strike (not "all defeated"), the
    // card's forced-kill still routes it to the defender's kill pile —
    // marshalling points are awarded from there, same as a normal kill.
    expect(s.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === CREATURE_ID)).toBe(true);
    expect(s.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === CREATURE_ID)).toBe(false);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === CREATURE_ID)).toBe(false);

    // The defender doesn't hold The Iron Crown, so no offer is enqueued.
    expect(s.pendingResolutions.some(r => r.kind.type === 'named-card-play-offer')).toBe(false);
  });

  // ─── Rule 5: Nazgûl are exempt from the forced kill ─────────────────────

  test('a Nazgûl that wins its strike is NOT forced into the kill pile (normal disposal applies)', () => {
    const { state } = makeFuryResolveStrikeState({ creatureRace: Race.Ringwraith, strikeProwess: 30, ironCrownInDefenderHand: true });

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const afterPlay = dispatch(state, plays[0].action);

    let s = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 12, true);
    expect(s.combat?.bodyCheckTarget).toBe('character');
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);

    expect(s.combat).toBeNull();
    // Not forced into the kill pile — the Nazgûl exclusion means normal
    // disposal (not defeated → attacker's discard) applies.
    expect(s.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === CREATURE_ID)).toBe(false);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === CREATURE_ID)).toBe(true);

    // No Iron Crown offer either, even though the defender holds it — the
    // offer is conditioned on the forced kill actually firing.
    expect(s.pendingResolutions.some(r => r.kind.type === 'named-card-play-offer')).toBe(false);
  });

  // ─── Rule 6: defender may immediately play The Iron Crown ───────────────

  test('defender holding The Iron Crown is offered an immediate play onto a company character', () => {
    const { state } = makeFuryResolveStrikeState({ strikeProwess: 30, ironCrownInDefenderHand: true });

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const afterPlay = dispatch(state, plays[0].action);
    let s = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 12, true);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);

    expect(s.combat).toBeNull();
    const offer = s.pendingResolutions.find(r => r.kind.type === 'named-card-play-offer');
    expect(offer).toBeDefined();
    expect(offer!.actor).toBe(PLAYER_1);
    if (offer!.kind.type !== 'named-card-play-offer') throw new Error('unreachable');
    expect(offer!.kind.cardName).toBe('The Iron Crown');
    expect(offer!.kind.companyId).toBe(companyIdAt(s, RESOURCE_PLAYER));

    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const offerActions = viableFor(s, PLAYER_1);
    const playAction = offerActions.find(a => a.action.type === 'play-named-card-offer');
    expect(playAction).toBeDefined();

    const next = dispatch(s, playAction!.action);
    // Iron Crown attaches to Aragorn and leaves the hand.
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].items.map(i => i.definitionId)).toContain(THE_IRON_CROWN);
    expect(next.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(next.pendingResolutions.some(r => r.kind.type === 'named-card-play-offer')).toBe(false);
  });

  test('defender may decline the Iron Crown offer with a pass', () => {
    const { state } = makeFuryResolveStrikeState({ strikeProwess: 30, ironCrownInDefenderHand: true });

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const afterPlay = dispatch(state, plays[0].action);
    let s = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 12, true);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);

    const next = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(next.pendingResolutions.some(r => r.kind.type === 'named-card-play-offer')).toBe(false);
    expect(next.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === THE_IRON_CROWN)).toBe(true);
  });

  test('no offer enqueued when the defender does not hold The Iron Crown', () => {
    const { state } = makeFuryResolveStrikeState({ strikeProwess: 30, ironCrownInDefenderHand: false });

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const afterPlay = dispatch(state, plays[0].action);
    let s = executeAction(afterPlay, PLAYER_1, 'resolve-strike', 12, true);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);

    expect(s.pendingResolutions.some(r => r.kind.type === 'named-card-play-offer')).toBe(false);
  });
});
