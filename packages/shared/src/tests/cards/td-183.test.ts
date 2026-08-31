/**
 * @module td-183.test
 *
 * Card test: Horn of Defiance (td-183)
 * Type: hero-resource-item (greater, hoard item)
 *
 * Printed text:
 *   "Unique. Hoard item. +2 direct influence. A stored Reforging may be
 *    placed with this item to "restore" it. Once restored, Horn of Defiance
 *    gives 3 marshalling points and 2 corruption points. If its bearer is
 *    the first to face a strike, that character may choose to face all
 *    strikes of an attack. The character faces a separate strike sequence
 *    for each strike."
 *
 * Card shape (packages/shared/src/data/td-items.json): unique, greater hoard
 * item, printed 1 marshalling point / 1 corruption point / +2 prowess (flat,
 * not restore-gated — verified against the CRF-22 errata page and the
 * "+2 (+3)" attribute-shorthand precedent on Dwarven Axe tw-499, whose
 * printed text spells out both numbers; Horn of Defiance's own text never
 * mentions a prowess change on restore).
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Hoard item — playable only at hoard sites                     | IMPLEMENTED |
 * | 2 | +2 direct influence                                           | IMPLEMENTED |
 * | 3 | A stored Reforging may be placed with this item to restore it | IMPLEMENTED |
 * | 4 | Once restored: 3 marshalling points, 2 corruption points      | IMPLEMENTED |
 * | 5 | First-to-face-a-strike may choose to face all strikes         | IMPLEMENTED |
 * | 6 | Each such strike is a separate strike sequence                | IMPLEMENTED |
 *
 * Modeling:
 *  - Rule 1: the shared `item-play-site` DSL effect (hoard-keyword filter).
 *  - Rule 2: `stat-modifier` `direct-influence` +2.
 *  - Rules 3-4: a new `grant-action` (`restore-item`) with cost
 *    `{ discard: "named-stored-card", discardCardName: "Reforging" }` and
 *    apply `restore-item`, which flags the item's `ItemInPlay.restored`.
 *    A paired `restored-item-stats` effect then overrides the item's printed
 *    marshalling/corruption points once that flag is set
 *    (`recompute-derived.ts`).
 *  - Rules 5-6: the new `face-all-strikes-option` effect. During the
 *    `assign-strikes` defender phase, as long as no strike has yet been
 *    assigned (CoE 3.i.5's "must be declared before strikes are assigned"),
 *    the bearer may be assigned *every* strike of the attack via
 *    `assign-strike`'s `allStrikes` flag — the same auto-assignment loop
 *    `CombatState.forceSingleTarget` drives, producing one *separate*
 *    strike-sequence assignment per strike (`excessStrikes: 0` each) rather
 *    than the "excess strikes" -1-prowess pool a repeat assignment would
 *    otherwise produce.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, THEODEN, RIVENDELL,
  MORIA, LORIEN, MINAS_TIRITH,
  resetMint, pool, dispatch,
  buildSitePhaseState, buildTestState,
  viableActions,
  getCharacter, findCharInstanceId,
  attachItemToChar, addStoredCard, findInPile,
  makeCompanyCombatState,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CharacterCard, GameAction } from '../../index.js';
import { Phase, Race } from '../../index.js';

const HORN_OF_DEFIANCE = 'td-183' as CardDefinitionId;
const REFORGING = 'tw-314' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // hoard site (Smaug's lair)

describe('Horn of Defiance (td-183)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: hoard-item site restriction ─────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [HORN_OF_DEFIANCE],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [HORN_OF_DEFIANCE],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Rule 2: +2 direct influence ──────────────────────────────────────────

  test('bearer gains +2 direct influence', () => {
    const baseDef = pool[ARAGORN as string] as CharacterCard;
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [HORN_OF_DEFIANCE] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence).toBe(baseDef.directInfluence + 2);
  });

  // ─── Rules 3-4: restoring via a stored Reforging ─────────────────────────

  test('offers restore-item when a stored Reforging is present', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, HORN_OF_DEFIANCE);
    const state = addStoredCard(withItem, RESOURCE_PLAYER, REFORGING, RIVENDELL).state;

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const reforgingId = findInPile(state, RESOURCE_PLAYER, 'killPile', REFORGING)!.instanceId;

    const matches = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; targetCardId?: unknown; characterId?: unknown })
      .filter(a => a.actionId === 'restore-item');

    expect(matches.some(a => a.characterId === aragornId && a.targetCardId === reforgingId)).toBe(true);
  });

  // Bug report (game mthd1qtm-uee04u): restore-item was missing `anyPhase`,
  // so the generic per-phase scanner (`extractGrantActions`) only surfaced
  // it during the organization phase. A player with a stored Reforging and
  // an untapped Horn of Defiance/Ringil at end-of-turn had no way to restore
  // it — rule 2.1.1 makes resource/character actions on cards in play legal
  // "during any phase of their turn" unless the card text itself restricts
  // the phase, and neither item's text names one.
  test('offered during the end-of-turn phase (rule 2.1.1: any phase unless restricted)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, HORN_OF_DEFIANCE);
    const state = addStoredCard(withItem, RESOURCE_PLAYER, REFORGING, RIVENDELL).state;

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const reforgingId = findInPile(state, RESOURCE_PLAYER, 'killPile', REFORGING)!.instanceId;

    const matches = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; targetCardId?: unknown; characterId?: unknown })
      .filter(a => a.actionId === 'restore-item');

    expect(matches.some(a => a.characterId === aragornId && a.targetCardId === reforgingId)).toBe(true);
  });

  test('NOT offered when there is no stored Reforging', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, HORN_OF_DEFIANCE);

    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'restore-item');
    expect(offered).toBe(false);
  });

  test('NOT offered once the item is already restored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, HORN_OF_DEFIANCE);
    const withReforging = addStoredCard(withItem, RESOURCE_PLAYER, REFORGING, RIVENDELL).state;

    const aragornId = findCharInstanceId(withReforging, RESOURCE_PLAYER, ARAGORN);
    const aragorn = withReforging.players[RESOURCE_PLAYER].characters[aragornId];
    const restoredItems = aragorn.items.map(i => i.definitionId === HORN_OF_DEFIANCE ? { ...i, restored: true as const } : i);
    const updatedPlayer = {
      ...withReforging.players[RESOURCE_PLAYER],
      characters: { ...withReforging.players[RESOURCE_PLAYER].characters, [aragornId as string]: { ...aragorn, items: restoredItems } },
    };
    const state = { ...withReforging, players: [updatedPlayer, withReforging.players[1]] as unknown as typeof withReforging.players };

    const offered = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as { actionId?: string })
      .some(a => a.actionId === 'restore-item');
    expect(offered).toBe(false);
  });

  test('activating discards the stored Reforging and marks the item restored, updating its marshalling/corruption points', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, HORN_OF_DEFIANCE);
    const stored = addStoredCard(withItem, RESOURCE_PLAYER, REFORGING, RIVENDELL).state;
    const state = recomputeDerived(stored);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const reforgingId = findInPile(state, RESOURCE_PLAYER, 'killPile', REFORGING)!.instanceId;

    // Before restoring: printed 1 MP / 1 CP.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(1);
    const cpBefore = getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints;

    const act = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(a => a.action as GameAction & { actionId?: string; targetCardId?: unknown; characterId?: unknown })
      .find(a => a.actionId === 'restore-item' && a.characterId === aragornId && a.targetCardId === reforgingId);
    expect(act).toBeDefined();

    const after = dispatch(state, act as GameAction);

    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    const item = aragorn.items.find(i => i.definitionId === HORN_OF_DEFIANCE);
    expect(item?.restored).toBe(true);

    // The stored Reforging is gone from the kill pile and discarded.
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === REFORGING)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === REFORGING)).toBe(true);

    // After restoring: 3 MP / 2 CP replace the printed 1 / 1.
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(3);
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(cpBefore + 1);
  });

  // ─── Rules 5-6: face-all-strikes-option ──────────────────────────────────

  test('offers the face-all-strikes choice as the first strike is assigned', () => {
    const state = makeCompanyCombatState({
      characters: [{ defId: ARAGORN, items: [HORN_OF_DEFIANCE] }, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const normal = viableActions(state, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as { characterId?: unknown; allStrikes?: unknown });

    expect(normal.some(a => a.characterId === aragornId && !a.allStrikes)).toBe(true);
    expect(normal.some(a => a.characterId === aragornId && a.allStrikes === true)).toBe(true);
    // Théoden bears no such item — never offered the all-strikes choice.
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    expect(normal.some(a => a.characterId === theodenId && a.allStrikes === true)).toBe(false);
  });

  test('NOT offered when the attack has only one strike', () => {
    const state = makeCompanyCombatState({
      characters: [{ defId: ARAGORN, items: [HORN_OF_DEFIANCE] }, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 1,
    });
    const offered = viableActions(state, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as { allStrikes?: unknown })
      .some(a => a.allStrikes === true);
    expect(offered).toBe(false);
  });

  test('NOT offered once a strike has already been assigned to someone else', () => {
    const base = makeCompanyCombatState({
      characters: [{ defId: ARAGORN, items: [HORN_OF_DEFIANCE] }, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const theodenId = findCharInstanceId(base, RESOURCE_PLAYER, THEODEN);
    const afterFirst = dispatch(base, { type: 'assign-strike', player: PLAYER_1, characterId: theodenId });

    const offered = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as { allStrikes?: unknown })
      .some(a => a.allStrikes === true);
    expect(offered).toBe(false);
  });

  test('choosing it assigns every strike to the bearer as separate strike sequences', () => {
    const state = makeCompanyCombatState({
      characters: [{ defId: ARAGORN, items: [HORN_OF_DEFIANCE] }, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const action = viableActions(state, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as { characterId?: unknown; allStrikes?: unknown })
      .find(a => a.characterId === aragornId && a.allStrikes === true);
    expect(action).toBeDefined();

    const after = dispatch(state, action as GameAction);

    expect(after.combat!.strikeAssignments).toHaveLength(3);
    for (const assignment of after.combat!.strikeAssignments) {
      expect(assignment.characterId).toBe(aragornId);
      expect(assignment.excessStrikes).toBe(0);
    }
    expect(after.combat!.forceSingleTarget).toBe(true);
    // 3 unresolved strikes on one character → defender chooses the order.
    expect(after.combat!.phase).toBe('choose-strike-order');
  });
});
