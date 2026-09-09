/**
 * @module wh-13.test
 *
 * Card test: Goblin-faces (wh-13)
 * Type: hazard-creature
 * Race: Orcs, Men (additionalRaces). Three strikes at prowess 7, no body.
 *
 * Card text:
 *   "Orcs. Men. 3 strikes. Following the attack, the attacker looks at a
 *    number of cards from the top of the defender's play deck equal to the
 *    number of successful strikes of the attack. The attacker may place any
 *    of these cards face down on the bottom of the defender's play deck (in
 *    any order he chooses). He places the rest on top of the defender's deck
 *    (in any order he chooses)."
 *
 * Canonical cost (`data/cards.json` WH-13 `attributes.playable`): `{b}{s}{B}`
 * — a Border-land [{b}] OR Shadow-land [{s}] region in the site path, OR a
 * Border-hold [{B}] destination (distinct symbol alternatives — the standard
 * TW/WH region/site keying, mirrors tw-71's `{s}{d}{D}`). Encoded as a single
 * `keyedTo` entry `{ regionTypes: ['border','shadow'], siteTypes:
 * ['border-hold'] }`.
 *
 * Effects:
 * | # | Rule                                                | Encoding                                     |
 * |---|------------------------------------------------------|-----------------------------------------------|
 * | 1 | 3 strikes at prowess 7, no body                      | base stats — combat                            |
 * | 2 | Keyed to Border-land/Shadow-land region or Border-hold| keyedTo regionTypes/siteTypes                  |
 * | 3 | Following the attack, attacker looks at N cards from  | on-event: attack-strike-successful →            |
 * |   | top of defender's deck (N = successful strikes) and  | rearrange-defender-deck-by-strikes             |
 * |   | splits them between the deck's top and bottom piles,  |                                                 |
 * |   | each pile in an order the attacker chooses             |                                                 |
 *
 * The deck-rearrangement is implemented as a new `rearrange-defender-deck`
 * pending resolution (`engine/combat-finalize.ts`, `engine/pending-reducers.ts`,
 * `engine/legal-actions/pending.ts`): the attacker places each looked-at card,
 * one at a time via a `rearrange-defender-deck-card` action, onto either pile;
 * once every card is placed the deck is rebuilt as
 * `[...topPile, ...untouchedRemainder, ...bottomPile]`.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FARAMIR, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makePlayDeck,
  makeMHState,
  resolveChain,
  findCharInstanceId,
  handCardId, companyIdAt, dispatch, executeAction, viableActions,
  expectCharStatus, expectInPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { GLAMDRING, STING, THE_MITHRIL_COAT } from '../../card-ids.js';
import { Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, PendingResolution } from '../../index.js';

const GOBLIN_FACES = 'wh-13' as CardDefinitionId;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Two-company state: P1 (resource) defends with a 3-character company, P2 (hazard) holds Goblin-faces. */
function threeCharacterState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: LORIEN, characters: [ARAGORN, FARAMIR, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        playDeck: makePlayDeck(),
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [GOBLIN_FACES], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/** Viable play-hazard actions for Goblin-faces against P1's company. */
function playableActions(state: GameState) {
  const cardId = handCardId(state, HAZARD_PLAYER);
  return viableActions(state, PLAYER_2, 'play-hazard')
    .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === cardId && a.viable);
}

/** Play Goblin-faces keyed as given and resolve the chain into combat. */
function initiateCombat(mhState: MovementHazardPhaseState): GameState {
  const ready = { ...threeCharacterState(), phaseState: mhState };
  const cardId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  const matched = playableActions(ready);
  expect(matched.length).toBeGreaterThan(0);
  const keyedBy = (matched[0].action as { keyedBy: { method: 'region-type' | 'site-type'; value: string } }).keyedBy;
  const afterPlay = dispatch(ready, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: cardId,
    targetCompanyId: companyId,
    keyedBy,
  });
  return resolveChain(afterPlay);
}

const BORDER_ONLY_MH = makeMHState({
  resolvedSitePath: [RegionType.Border],
  resolvedSitePathNames: ['Andrast'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
});

const SHADOW_ONLY_MH = makeMHState({
  resolvedSitePath: [RegionType.Shadow],
  resolvedSitePathNames: ['Imlad Morgul'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
});

const BORDER_HOLD_ONLY_MH = makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Rhudaur'],
  destinationSiteType: SiteType.BorderHold,
  destinationSiteName: 'Pelargir',
});

const NON_KEYED_MH = makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: ['Rhudaur'],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Moria',
});

describe('Goblin-faces (wh-13)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: {b}{s}{B} alternatives ─────────────────────────────────────────

  test('playable keyed to a Border-land region [{b}] in the path', () => {
    const ready = { ...threeCharacterState(), phaseState: BORDER_ONLY_MH };
    const matched = playableActions(ready);
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'region-type' && a.action.keyedBy.value === 'border')).toBe(true);
  });

  test('playable keyed to a Shadow-land region [{s}] in the path', () => {
    const ready = { ...threeCharacterState(), phaseState: SHADOW_ONLY_MH };
    const matched = playableActions(ready);
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'region-type' && a.action.keyedBy.value === 'shadow')).toBe(true);
  });

  test('playable at a Border-hold site [{B}] (path has no border/shadow region)', () => {
    const ready = { ...threeCharacterState(), phaseState: BORDER_HOLD_ONLY_MH };
    const matched = playableActions(ready);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.some(a => a.action.type === 'play-hazard'
      && a.action.keyedBy?.method === 'site-type' && a.action.keyedBy.value === SiteType.BorderHold)).toBe(true);
    expect(matched.every(a => a.action.type === 'play-hazard' && a.action.keyedBy?.method !== 'region-type')).toBe(true);
  });

  test('NOT playable on a non-keyed path/site (wilderness region, ruins-and-lairs site)', () => {
    const ready = { ...threeCharacterState(), phaseState: NON_KEYED_MH };
    expect(playableActions(ready)).toHaveLength(0);
  });

  // ─── Combat: three strikes, prowess 7, no body ──────────────────────────────

  test('combat initiates with 3 strikes, prowess 7, no body', () => {
    const afterChain = initiateCombat(BORDER_ONLY_MH);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(7);
    expect(afterChain.combat!.creatureBody).toBeNull();
  });

  // ─── No successful strikes → no rearrange resolution ────────────────────────

  test('all strikes defeated — no rearrange-defender-deck resolution, deck untouched', () => {
    const afterChain = initiateCombat(BORDER_ONLY_MH);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FARAMIR);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    // Every character taps to fight at full prowess + a high roll → every
    // strike total exceeds Goblin-faces' prowess 7 → all strikes defeated
    // (no body on the creature, so a defeated strike is auto-final — no body
    // check phase at all).
    let guard = 0;
    while (s.combat && guard++ < 20) {
      if (s.combat.phase === 'choose-strike-order') {
        s = executeAction(s, PLAYER_1, 'choose-strike-order');
      } else if (s.combat.phase === 'resolve-strike') {
        s = executeAction(s, PLAYER_1, 'resolve-strike', 12, true);
      } else {
        break;
      }
    }

    expect(s.combat).toBeNull();
    expect(s.pendingResolutions).toHaveLength(0);
    // No cards looked at → the defender's play deck is exactly as it started.
    expect(s.players[RESOURCE_PLAYER].playDeck.map(c => c.definitionId)).toEqual(makePlayDeck());
    // All three strikes defeated → the creature is destroyed (defender's kill pile).
    expectInPile(s, RESOURCE_PLAYER, 'killPile', GOBLIN_FACES);
  });

  // ─── Successful strikes → attacker looks at + rearranges the defender's deck ─

  test('2 successful strikes → attacker looks at the top 2 cards of the defender\'s deck and may place them', () => {
    const afterChain = initiateCombat(BORDER_ONLY_MH);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FARAMIR);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    // Aragorn (prowess 6) taps to fight with a high roll → defeats his strike.
    // Faramir and Legolas (prowess 5 each) fight untapped (halved effective
    // prowess 2) with the minimum roll → total 4 < creature prowess 7 → both
    // are wounded (2 successful strikes).
    const rollFor = (charId: string): { roll: number; tap: boolean } =>
      charId === aragornId ? { roll: 12, tap: true } : { roll: 2, tap: false };

    let guard = 0;
    while (s.combat && guard++ < 20) {
      if (s.combat.phase === 'choose-strike-order') {
        s = executeAction(s, PLAYER_1, 'choose-strike-order');
      } else if (s.combat.phase === 'resolve-strike') {
        const targetId = s.combat.strikeAssignments[s.combat.currentStrikeIndex].characterId;
        const { roll, tap } = rollFor(targetId as string);
        s = executeAction(s, PLAYER_1, 'resolve-strike', roll, tap);
      } else if (s.combat.phase === 'body-check' && s.combat.bodyCheckTarget === 'character') {
        // Attacker (hazard player) rolls the character body check (CoE 3.I.1).
        // Low roll, well under body 8 → the character survives, wounded.
        s = executeAction(s, PLAYER_2, 'body-check-roll', 3);
      } else {
        break;
      }
    }

    // Faramir and Legolas both survive wounded (Inverted); Aragorn's strike was
    // defeated so he stays merely tapped.
    expect(s.combat).toBeNull();
    expectCharStatus(s, RESOURCE_PLAYER, FARAMIR, CardStatus.Inverted);
    expectCharStatus(s, RESOURCE_PLAYER, LEGOLAS, CardStatus.Inverted);
    expectCharStatus(s, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    // Not all 3 strikes defeated → Goblin-faces survives to the hazard
    // player's discard pile (not the defender's kill pile).
    expectInPile(s, HAZARD_PLAYER, 'discardPile', GOBLIN_FACES);

    // The rearrange-defender-deck resolution is queued for the attacker
    // (hazard player), with the top 2 cards of the defender's deck looked at.
    const top = s.pendingResolutions[0];
    expect(top).toBeDefined();
    expect(top.kind.type).toBe('rearrange-defender-deck');
    expect(top.actor).toBe(PLAYER_2);
    const kind = top.kind as Extract<PendingResolution['kind'], { type: 'rearrange-defender-deck' }>;
    expect(kind.count).toBe(2);
    expect(kind.remainingInstanceIds).toHaveLength(2);
    expect(kind.deckOwnerIndex).toBe(RESOURCE_PLAYER);

    // The two looked-at cards are the deck's original top two: Glamdring and Sting.
    const deckBefore = s.players[RESOURCE_PLAYER].playDeck;
    expect(deckBefore[0].definitionId).toBe(GLAMDRING);
    expect(deckBefore[1].definitionId).toBe(STING);
    const [glamdringId, stingId] = kind.remainingInstanceIds;
    expect(deckBefore.find(c => c.instanceId === glamdringId)?.definitionId).toBe(GLAMDRING);
    expect(deckBefore.find(c => c.instanceId === stingId)?.definitionId).toBe(STING);

    // Both cards' identities became public (this codebase's established
    // precedent for "reveal to yourself" deck-look effects, per Desire All
    // for Thy Belly ba-16 — see docs/certification-engine-support.md).
    expect(s.revealedInstances[glamdringId]).toBe(GLAMDRING);
    expect(s.revealedInstances[stingId]).toBe(STING);

    // Exactly 4 legal actions are offered: each of the 2 looked-at cards may
    // go to either the top or the bottom pile. No pass — placement is mandatory.
    const rearrangeActions = viableActions(s, PLAYER_2, 'rearrange-defender-deck-card');
    expect(rearrangeActions).toHaveLength(4);
    expect(viableActions(s, PLAYER_2, 'pass')).toHaveLength(0);

    // Attacker places Sting on the bottom first, then Glamdring on top.
    s = dispatch(s, { type: 'rearrange-defender-deck-card', player: PLAYER_2, cardInstanceId: stingId, destination: 'bottom' });
    // Resolution still queued — one card remains.
    expect(s.pendingResolutions).toHaveLength(1);
    s = dispatch(s, { type: 'rearrange-defender-deck-card', player: PLAYER_2, cardInstanceId: glamdringId, destination: 'top' });

    // Resolution cleared once both cards are placed.
    expect(s.pendingResolutions).toHaveLength(0);

    // Final deck: Glamdring on top, the untouched remainder in the middle
    // (starting with the original 3rd card, The Mithril Coat), Sting at the
    // very bottom.
    const finalDeck = s.players[RESOURCE_PLAYER].playDeck;
    const originalRest = makePlayDeck().slice(2);
    expect(finalDeck.map(c => c.definitionId)).toEqual([GLAMDRING, ...originalRest, STING]);
    expect(finalDeck[0].instanceId).toBe(glamdringId);
    expect(finalDeck[finalDeck.length - 1].instanceId).toBe(stingId);
    expect(finalDeck[1].definitionId).toBe(THE_MITHRIL_COAT);
  });

  test('attacker may place both looked-at cards on the same pile, preserving pick order', () => {
    const afterChain = initiateCombat(BORDER_ONLY_MH);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FARAMIR);
    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    const rollFor = (charId: string): { roll: number; tap: boolean } =>
      charId === aragornId ? { roll: 12, tap: true } : { roll: 2, tap: false };

    let guard = 0;
    while (s.combat && guard++ < 20) {
      if (s.combat.phase === 'choose-strike-order') {
        s = executeAction(s, PLAYER_1, 'choose-strike-order');
      } else if (s.combat.phase === 'resolve-strike') {
        const targetId = s.combat.strikeAssignments[s.combat.currentStrikeIndex].characterId;
        const { roll, tap } = rollFor(targetId as string);
        s = executeAction(s, PLAYER_1, 'resolve-strike', roll, tap);
      } else if (s.combat.phase === 'body-check' && s.combat.bodyCheckTarget === 'character') {
        s = executeAction(s, PLAYER_2, 'body-check-roll', 3);
      } else {
        break;
      }
    }

    const kind = s.pendingResolutions[0].kind as Extract<PendingResolution['kind'], { type: 'rearrange-defender-deck' }>;
    const [glamdringId, stingId] = kind.remainingInstanceIds;

    // Both cards placed on top, Glamdring picked first → Glamdring ends up
    // literally topmost, Sting immediately below it.
    s = dispatch(s, { type: 'rearrange-defender-deck-card', player: PLAYER_2, cardInstanceId: glamdringId, destination: 'top' });
    s = dispatch(s, { type: 'rearrange-defender-deck-card', player: PLAYER_2, cardInstanceId: stingId, destination: 'top' });

    expect(s.pendingResolutions).toHaveLength(0);
    const finalDeck = s.players[RESOURCE_PLAYER].playDeck;
    const originalRest = makePlayDeck().slice(2);
    expect(finalDeck.map(c => c.definitionId)).toEqual([GLAMDRING, STING, ...originalRest]);
  });
});
