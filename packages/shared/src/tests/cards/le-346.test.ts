/**
 * @module le-346.test
 *
 * Card test: Trifling Ring (le-346)
 * Type: minion-resource-item (subtype: special)
 * Corruption: 1, Marshalling Points: 2
 * Keywords: ring, lesser-ring
 *
 * "Lesser Ring. Playable only with a gold ring and after a test indicates a
 *  Lesser Ring. +3 to direct influence against characters. Cannot be
 *  duplicated on a given character."
 *
 * Unlike Minor Ring (le-324, "+2 to direct influence"), Trifling Ring's bonus
 * is qualified "against characters": it applies when the direct influence is
 * used to control a character (as a follower) or to influence an opponent's
 * character, but NOT when influencing a faction (bringing a faction under
 * control, or stealing an opponent's faction) or an ally/item. Per CRF 22
 * (Followers): "Bonuses to direct influence against characters apply only once."
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                              |
 * |---|--------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | +1 corruption point to bearer                    | IMPLEMENTED | itemDef.corruptionPoints summed in recomputeDerived|
 * | 2 | +3 DI when controlling a character (follower)    | IMPLEMENTED | conditional stat-modifier, reason influence-check  |
 * | 3 | +3 DI when influencing an opponent's character   | IMPLEMENTED | conditional stat-modifier, opponent-influence-check |
 * | 4 | NO bonus vs factions / allies / items            | IMPLEMENTED | target.kind gate; faction path excludes the reason  |
 * | 5 | Not a blanket DI boost (effective DI unchanged)  | IMPLEMENTED | conditional effects excluded from effective stats  |
 * | 6 | Playable via gold ring test (lesser-ring keyword)| IMPLEMENTED | ring-play-offer checks card keywords for category  |
 * | 7 | Cannot be duplicated on a given character        | IMPLEMENTED | duplication-limit scope:character; ring-play-offer  |
 *
 * Fixture alignment: minion (ringwraith) — uses minion characters, sites and a
 * minion faction from the LE set.
 *
 * Character fixtures:
 *   - LAGDUF   (le-18): orc warrior, DI 0 — bearer / influencer / controller
 *   - CIRYAHER (le-6):  dúnadan, DI 2 — target character
 *
 * Faction / ally fixtures:
 *   - SNAGA_HAI (le-286): orc faction, playable at any Shadow-hold, influence# 10
 *   - WAR_WOLF  (le-157): minion ally, mind 1
 *
 * Site fixtures:
 *   - MORIA        (le-392): shadow-hold (Redhorn Gate)
 *   - MINAS_MORGUL (le-390): haven
 *   - DOL_GULDUR   (le-367): haven
 *   - ETTENMOORS   (le-373): ruins-and-lairs
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  attachItemToChar, attachAllyToChar, addCardInPlay, addCardToHand,
  charIdAt, findCharInstanceId, viableActions, dispatchResult,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  makeSitePhase, getCharacter, pool,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, GameState } from '../../index.js';
import { Alignment } from '../../index.js';
import { enqueueResolution } from '../../engine/pending.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const TRIFLING_RING = 'le-346' as CardDefinitionId;

// Minion fixtures — declared locally per card-ids.ts constants policy
const LAGDUF = 'le-18' as CardDefinitionId;    // orc warrior, DI 0
const CIRYAHER = 'le-6' as CardDefinitionId;   // dúnadan, DI 2
const SNAGA_HAI = 'le-286' as CardDefinitionId; // orc faction, shadow-hold, influence# 10
const WAR_WOLF = 'le-157' as CardDefinitionId;  // minion ally, mind 1

const MORIA = 'le-392' as CardDefinitionId;        // shadow-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // haven
const ETTENMOORS = 'le-373' as CardDefinitionId;   // ruins-and-lairs

describe('Trifling Ring (le-346)', () => {
  beforeEach(() => resetMint());

  // ─── +1 corruption on bearer (structural) ─────────────────────────────────

  test('bearer gains +1 effective corruption points while ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    expect(getCharacter(base, RESOURCE_PLAYER, LAGDUF).effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LAGDUF, TRIFLING_RING));
    expect(getCharacter(withRing, RESOURCE_PLAYER, LAGDUF).effectiveStats.corruptionPoints).toBe(1);
  });

  // ─── "against characters" is NOT a blanket boost to the DI stat ────────────

  test('effective direct influence is unchanged by the ring (conditional, not a stat boost)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [TRIFLING_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    // Base LAGDUF DI is 0; the +3 is conditional ("against characters") so it
    // must not inflate the general direct-influence stat.
    expect(getCharacter(state, RESOURCE_PLAYER, LAGDUF).effectiveStats.directInfluence).toBe(0);
  });

  // ─── Effect: +3 DI when controlling a character (follower) ────────────────

  test('+3 DI applies when the bearer checks influence to control a character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [TRIFLING_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const ciryaherDef = pool[CIRYAHER as string] as CharacterCard;

    // Against a character target: base DI 0 + 3 = 3.
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER], ciryaherDef)).toBe(3);
    // With no specific character target the bonus does not fire: base DI 0.
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER])).toBe(0);
  });

  test('no +3 DI to control a character when the ring is not held', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const ciryaherDef = pool[CIRYAHER as string] as CharacterCard;
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER], ciryaherDef)).toBe(0);
  });

  // ─── Effect: +3 DI when influencing an opponent's character ───────────────

  test('+3 DI applies to an opponent-influence attempt against a character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [TRIFLING_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const ciryaherId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);

    const attempt = firstOpponentInfluenceAttempt(state, ciryaherId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('character');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // LAGDUF base DI 0 + 3 (against a character) = 3.
    expect(pending.kind.attempt.influencerDI).toBe(3);
  });

  test('no +3 DI to influence an opponent-controlled ally (not a character)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [TRIFLING_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = attachAllyToChar(state, HAZARD_PLAYER, CIRYAHER, WAR_WOLF);
    const ciryaherId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);
    const allyId = state.players[HAZARD_PLAYER].characters[ciryaherId].allies[0].instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, allyId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('ally');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Ally target → "against characters" bonus does not apply: base DI 0.
    expect(pending.kind.attempt.influencerDI).toBe(0);
  });

  test('no +3 DI to steal an opponent-controlled faction (not a character)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [TRIFLING_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, SNAGA_HAI);
    const factionId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SNAGA_HAI)!.instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Faction target → no bonus: base DI 0.
    expect(pending.kind.attempt.influencerDI).toBe(0);
  });

  // ─── Effect: NO bonus to a faction-influence roll (bring faction under control)

  test('no +3 DI to a faction-influence attempt (bringing a faction under control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [TRIFLING_RING] }] }], hand: [SNAGA_HAI], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    // influence# 10, LAGDUF DI 0, ring gives NO faction bonus → need = 10 - 0 = 10.
    // (A +3 "against characters" bonus wrongly applied to factions would give 7.)
    expect(attempt!.need).toBe(10);
  });

  // ─── Playability: ring-play-offer offers only when lesser-ring is eligible ─

  test('ring is offered in ring-play-offer when lesser-ring is eligible', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [LAGDUF] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const lagdufId = charIdAt(state, RESOURCE_PLAYER);
    const withRing = addCardToHand(state, RESOURCE_PLAYER, TRIFLING_RING);
    const withOffer = enqueueResolution(withRing, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: lagdufId,
        eligibleCategories: ['lesser-ring'],
        rollTotal: 5,
        storedPlacement: false,
      },
    });
    expect(viableActions(withOffer, PLAYER_1, 'play-ring-after-test')).toHaveLength(1);
  });

  test('ring is NOT offered when lesser-ring is not in the eligible categories', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [LAGDUF] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const lagdufId = charIdAt(state, RESOURCE_PLAYER);
    const withRing = addCardToHand(state, RESOURCE_PLAYER, TRIFLING_RING);
    const withOffer = enqueueResolution(withRing, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: lagdufId,
        eligibleCategories: ['magic-ring'],
        rollTotal: 3,
        storedPlacement: false,
      },
    });
    expect(viableActions(withOffer, PLAYER_1, 'play-ring-after-test')).toHaveLength(0);
  });

  // ─── Duplication-limit: cannot be duplicated on a given character ─────────

  test('ring-play-offer does NOT offer a second Trifling Ring for a bearer who already holds one', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [TRIFLING_RING] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const lagdufId = charIdAt(state, RESOURCE_PLAYER);
    // LAGDUF already bears one Trifling Ring; add a second to hand.
    const withInHand = addCardToHand(state, RESOURCE_PLAYER, TRIFLING_RING);
    const withOffer = enqueueResolution(withInHand, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: lagdufId,
        eligibleCategories: ['lesser-ring'],
        rollTotal: 5,
        storedPlacement: false,
      },
    });
    expect(viableActions(withOffer, PLAYER_1, 'play-ring-after-test')).toHaveLength(0);
  });

  test('ring-play-offer DOES offer a Trifling Ring for a bearer who holds none', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [LAGDUF] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const lagdufId = charIdAt(state, RESOURCE_PLAYER);
    const withInHand = addCardToHand(state, RESOURCE_PLAYER, TRIFLING_RING);
    const withOffer = enqueueResolution(withInHand, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: {
        type: 'ring-play-offer',
        characterInstanceId: lagdufId,
        eligibleCategories: ['lesser-ring'],
        rollTotal: 5,
        storedPlacement: false,
      },
    });
    expect(viableActions(withOffer, PLAYER_1, 'play-ring-after-test')).toHaveLength(1);
  });
});
