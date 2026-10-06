/**
 * @module td-122.test
 *
 * Card test: Helm of Her Secrecy (td-122)
 * Type: hero-resource-event (permanent), non-unique, 0 MP.
 *
 * Text:
 *   "If Éowyn is in your hand, this card is playable on a company facing an
 *    attack (before strikes are assigned)—the company must contain a character
 *    with Edoras as a home site. If enough influence is available to control
 *    her, Éowyn may be played with (i. e., joins) the company. She gains +2
 *    prowess, +1 body, and +1 direct influence. If the attack is a Nazgûl,
 *    place Helm of Her Secrecy with Éowyn following the attack. Otherwise,
 *    discard this card following the attack. Regardless, Éowyn remains in
 *    play."
 *
 * Effects:
 *   - `combat-join-character` { characterName: "Éowyn",
 *     requiresCompanyHomesite: "Edoras",
 *     keepWhen: { "attack.creatureRace": "ringwraith" } } — offered in the
 *     defender's pre-assignment window as a `play-character` carrying
 *     `viaCombatEventInstanceId`, once per available influence source (general
 *     influence, or the direct influence of a character in the company). On
 *     play Éowyn joins the attacked company with the Helm placed on her; unless
 *     the attack is a Nazgûl (race `ringwraith`), a post-attack effect discards
 *     the Helm.
 *   - `stat-modifier` +2 prowess / +1 body / +1 direct influence — apply to
 *     Éowyn as the Helm's bearer.
 *
 * Fixtures: Théoden (tw-182, Edoras, DI 3), Háma (tw-165, Edoras, DI 0),
 * Aragorn II (tw-120, not Edoras), Éowyn (tw-147, mind 2, prowess 2, body 7).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, makeCompanyCombatState,
  viableActions, viablePlayCharacterActions, dispatch, executeAction,
  findCharInstanceId, findHandCardId, expectInDiscardPile,
  ARAGORN, THEODEN, EOWYN,
  PLAYER_1, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';
import { Race } from '../../index.js';

const HELM = 'td-122' as CardDefinitionId;
const HAMA = 'tw-165' as CardDefinitionId;

describe('Helm of Her Secrecy (td-122)', () => {
  beforeEach(() => resetMint());

  // ─── Playability ─────────────────────────────────────────────────────────────

  test('playable before strikes are assigned with Éowyn in hand and an Edoras character in the company', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM);
    const eowynId = findHandCardId(state, RESOURCE_PLAYER, EOWYN);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.map(a => a.controlledBy).sort()).toEqual(['general', theodenId].sort());
    for (const a of actions) {
      expect(a.characterInstanceId).toBe(eowynId);
      expect(a.viaCombatEventInstanceId).toBe(helmId);
    }
    // Never offered as a bare permanent event.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('not playable when no character in the company has Edoras as a home site', () => {
    const state = makeCompanyCombatState({
      characters: [ARAGORN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('not playable when Éowyn is not in hand', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('not playable when Éowyn is already in play', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN, EOWYN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  test('not playable once strikes have been assigned', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null, strikesTotal: 2,
    });
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const assigned = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: theodenId });
    expect(assigned.combat!.strikeAssignments.length).toBe(1);
    expect(viablePlayCharacterActions(assigned, PLAYER_1)).toHaveLength(0);
  });

  test('requires enough influence: only direct influence when general influence is exhausted', () => {
    const base = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    const state: GameState = { ...base, players: [{ ...base.players[0], generalInfluenceUsed: 20 }, base.players[1]] };
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    expect(viablePlayCharacterActions(state, PLAYER_1).map(a => a.controlledBy)).toEqual([theodenId]);
  });

  test('not playable when no influence is available to control Éowyn', () => {
    // Háma (DI 0) is the company's only Edoras character; general influence is spent.
    const base = makeCompanyCombatState({
      characters: [HAMA], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    const state: GameState = { ...base, players: [{ ...base.players[0], generalInfluenceUsed: 20 }, base.players[1]] };
    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
  });

  // ─── Play ────────────────────────────────────────────────────────────────────

  test('Éowyn joins the company with the Helm and gains +2 prowess, +1 body, +1 direct influence', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM);
    const eowynId = findHandCardId(state, RESOURCE_PLAYER, EOWYN);
    const after = dispatch(state, viablePlayCharacterActions(state, PLAYER_1).find(a => a.controlledBy === 'general')!);

    const p = after.players[RESOURCE_PLAYER];
    expect(p.hand).toHaveLength(0);
    expect(p.companies.find(c => c.id === after.combat!.companyId)!.characters).toContain(eowynId);
    const eowyn = p.characters[eowynId];
    expect(eowyn.controlledBy).toBe('general');
    expect(eowyn.items.map(i => i.instanceId)).toEqual([helmId]);
    expect(eowyn.effectiveStats.prowess).toBe(4);
    expect(eowyn.effectiveStats.body).toBe(8);
    expect(eowyn.effectiveStats.directInfluence).toBe(1);
    // Still in the pre-assignment window: Éowyn may now be assigned a strike.
    const targets = viableActions(after, PLAYER_1, 'assign-strike')
      .map(ea => (ea.action as { characterId?: CardInstanceId }).characterId);
    expect(targets).toContain(eowynId);
  });

  test('Éowyn may join as a follower under direct influence', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 6, creatureBody: null,
    });
    const eowynId = findHandCardId(state, RESOURCE_PLAYER, EOWYN);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const after = dispatch(state, viablePlayCharacterActions(state, PLAYER_1).find(a => a.controlledBy === theodenId)!);

    const p = after.players[RESOURCE_PLAYER];
    expect(p.characters[eowynId].controlledBy).toBe(theodenId);
    expect(p.characters[theodenId].followers).toContain(eowynId);
  });

  // ─── Following the attack ────────────────────────────────────────────────────

  test('non-Nazgûl attack: the Helm is discarded following the attack, Éowyn remains in play', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM, EOWYN],
      creatureRace: Race.Orc, creatureProwess: 3, creatureBody: null,
    });
    const eowynId = findHandCardId(state, RESOURCE_PLAYER, EOWYN);
    const afterPlay = dispatch(state, viablePlayCharacterActions(state, PLAYER_1).find(a => a.controlledBy === 'general')!);
    const afterAssign = dispatch(afterPlay, { type: 'assign-strike', player: PLAYER_1, characterId: eowynId });
    const resolved = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 11, false);

    expect(resolved.combat).toBeNull();
    expectInDiscardPile(resolved, RESOURCE_PLAYER, HELM);
    const eowyn = resolved.players[RESOURCE_PLAYER].characters[eowynId];
    expect(eowyn).toBeDefined();
    expect(eowyn.items).toHaveLength(0);
    expect(eowyn.effectiveStats.body).toBe(7);
  });

  test('Nazgûl attack: the Helm stays with Éowyn following the attack', () => {
    const state = makeCompanyCombatState({
      characters: [THEODEN], hand: [HELM, EOWYN],
      creatureRace: Race.Ringwraith, creatureProwess: 3, creatureBody: null,
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM);
    const eowynId = findHandCardId(state, RESOURCE_PLAYER, EOWYN);
    const afterPlay = dispatch(state, viablePlayCharacterActions(state, PLAYER_1).find(a => a.controlledBy === 'general')!);
    const afterAssign = dispatch(afterPlay, { type: 'assign-strike', player: PLAYER_1, characterId: eowynId });
    const resolved = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 11, false);

    expect(resolved.combat).toBeNull();
    const eowyn = resolved.players[RESOURCE_PLAYER].characters[eowynId];
    expect(eowyn.items.map(i => i.instanceId)).toEqual([helmId]);
    expect(eowyn.effectiveStats.body).toBe(8);
    expect(eowyn.effectiveStats.directInfluence).toBe(1);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === helmId)).toBe(false);
  });
});
