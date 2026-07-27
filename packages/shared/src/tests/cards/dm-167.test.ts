/**
 * @module dm-167.test
 *
 * Card test: Dragon-helm (dm-167)
 * Type: hero-resource-item (Special Item), alignment wizard, unique.
 * Marshalling Points: 4. Corruption Points: 2. Helmet.
 *
 * Card text: "Unique. Playable at any Under-deeps Dark-hold [{D}] or
 * Shadow-hold [{S}]. Helmet. Warrior only: +1 prowess; +2 body (to a maximum
 * of 10); +3 direct influence. Tap Dragon-helm to cancel one Dragon or Drake
 * attack against the bearer's company."
 *
 * Rule coverage:
 *
 * | # | Rule                                                | Mechanism                                                     |
 * |---|-----------------------------------------------------|---------------------------------------------------------------|
 * | 1 | Playable at any Under-deeps Dark-hold or Shadow-hold| item-play-site filter: under-deeps keyword AND siteType $in    |
 * | 2 | Warrior only: +1 prowess                            | stat-modifier prowess, when bearer.skills $includes warrior    |
 * | 3 | Warrior only: +2 body to a maximum of 10            | stat-modifier body max:10, when warrior                        |
 * | 4 | Warrior only: +3 direct influence                   | stat-modifier direct-influence, when warrior                   |
 * | 5 | Tap to cancel one Dragon or Drake attack            | cancel-attack cost { tap: "self" }, when enemy.race $in        |
 *
 * The "Warrior only:" clause covers the three stat bonuses; the tap-to-cancel
 * ability is a separate sentence and is not warrior-gated. The tap cost is
 * "self" (item only) — the bearer's tapped status is irrelevant and the
 * bearer does not tap (Helm of Fear as-126 precedent).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus, CardDefinitionId,
  dispatch, viableActions, attachItemToChar, setCharStatus,
  findHandCardId, findCharInstanceId, getCharacter, recomputeDerived,
  makeCancelWindowCombat,
  ARAGORN, FRODO, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import type { CancelAttackAction, GameState } from '../../index.js';

const DRAGON_HELM = 'dm-167' as CardDefinitionId;

// Hero warrior with body 7 — proves the un-clamped +2 body case.
const DWALIN = 'tw-142' as CardDefinitionId;

// DM Under-deeps sites (canonical hero-map versions).
const IRON_DEEPS = 'dm-33' as CardDefinitionId;     // dark-hold, under-deeps — valid
const UNDER_LEAS = 'dm-40' as CardDefinitionId;     // shadow-hold, under-deeps — valid
const UNDER_VAULTS = 'dm-41' as CardDefinitionId;   // ruins-and-lairs, under-deeps — wrong site type

// Creatures for the cancel gate (races from card data).
const DAELOMIN = 'tw-26' as CardDefinitionId;       // race dragon
const NAMELESS_THING = 'dm-109' as CardDefinitionId; // race drake
const ORC_PATROL_DEF = 'tw-074' as CardDefinitionId; // race orc — must NOT be cancellable

/** Find the in-play instance of the Helm on a given character. */
function helmOnChar(state: GameState, charDefId: CardDefinitionId) {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, charDefId);
  return state.players[RESOURCE_PLAYER].characters[charId].items.find(
    i => i.definitionId === DRAGON_HELM,
  );
}

describe('Dragon-helm (dm-167)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at any Under-deeps Dark-hold or Shadow-hold ─────────

  function helmPlays(state: ReturnType<typeof buildSitePhaseState>) {
    const helmId = findHandCardId(state, RESOURCE_PLAYER, DRAGON_HELM);
    return computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (helmId as string),
    );
  }

  test('playable at an Under-deeps Dark-hold (The Iron-deeps)', () => {
    const state = buildSitePhaseState({ site: IRON_DEEPS, characters: [ARAGORN], hand: [DRAGON_HELM] });
    expect(helmPlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at an Under-deeps Shadow-hold (The Under-leas)', () => {
    const state = buildSitePhaseState({ site: UNDER_LEAS, characters: [ARAGORN], hand: [DRAGON_HELM] });
    expect(helmPlays(state).length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at an Under-deeps site of another type (The Under-vaults, Ruins & Lairs)', () => {
    const state = buildSitePhaseState({ site: UNDER_VAULTS, characters: [ARAGORN], hand: [DRAGON_HELM] });
    expect(helmPlays(state)).toHaveLength(0);
  });

  test('NOT playable at a non-Under-deeps Shadow-hold (Moria)', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [DRAGON_HELM] });
    expect(helmPlays(state)).toHaveLength(0);
  });

  // ─── Rules 2–4: warrior-only +1 prowess / +2 body (max 10) / +3 DI ────────

  function statsState(bearerDefId: CardDefinitionId): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [bearerDefId] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    return recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, bearerDefId, DRAGON_HELM));
  }

  test('warrior bearer (Aragorn): +1 prowess, body clamped at the maximum of 10, +3 direct influence', () => {
    const state = statsState(ARAGORN);
    const stats = getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats;
    expect(stats.prowess).toBe(7);          // base 6 + 1
    expect(stats.body).toBe(10);            // base 9 + 2 = 11 → clamped to 10
    expect(stats.directInfluence).toBe(6);  // base 3 + 3
  });

  test('warrior bearer below the cap (Dwalin, body 7) gains the full +2 body', () => {
    const state = statsState(DWALIN);
    const stats = getCharacter(state, RESOURCE_PLAYER, DWALIN).effectiveStats;
    expect(stats.prowess).toBe(3);          // base 2 + 1
    expect(stats.body).toBe(9);             // base 7 + 2, under the max
  });

  test('non-warrior bearer (Frodo) gains none of the bonuses', () => {
    const state = statsState(FRODO);
    const stats = getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats;
    expect(stats.prowess).toBe(1);          // unchanged
    expect(stats.body).toBe(9);             // unchanged
    expect(stats.directInfluence).toBe(1);  // unchanged
  });

  // ─── Rule 5: tap Dragon-helm to cancel one Dragon or Drake attack ─────────

  function combatBase(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  function combatVs(creatureDefId: CardDefinitionId, race: Race, sourceType: 'creature' | 'automatic-attack' = 'creature'): GameState {
    const withItem = attachItemToChar(combatBase(), RESOURCE_PLAYER, ARAGORN, DRAGON_HELM);
    return makeCancelWindowCombat(withItem, {
      creatureDefId,
      creatureRace: race,
      attackSourceType: sourceType,
      strikesTotal: 1,
      strikeProwess: 9,
    });
  }

  test('cancel-attack is offered against a Dragon attack (Daelomin)', () => {
    const state = combatVs(DAELOMIN, Race.Dragon);
    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as CancelAttackAction).cardInstanceId).toBe(helmOnChar(state, ARAGORN)!.instanceId);
  });

  test('cancel-attack is offered against a Drake attack (Nameless Thing)', () => {
    const state = combatVs(NAMELESS_THING, Race.Drake);
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('cancel-attack is offered against a Dragon automatic-attack (e.g. at a Dragon\'s lair)', () => {
    const state = combatVs(DAELOMIN, Race.Dragon, 'automatic-attack');
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('cancel-attack is NOT offered against a non-Dragon/Drake attack (Orcs)', () => {
    const state = combatVs(ORC_PATROL_DEF, Race.Orc);
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('activating cancels the attack, taps the Helm but NOT the bearer', () => {
    const state = combatVs(DAELOMIN, Race.Dragon);
    const [cancel] = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, cancel.action);

    // Combat is cancelled immediately — no chain entry (in-play item cancel).
    expect(after.combat).toBeNull();
    expect(after.chain).toBeNull();

    // The Helm is tapped and stays on Aragorn; Aragorn stays untapped.
    const helm = helmOnChar(after, ARAGORN)!;
    expect(helm.status).toBe(CardStatus.Tapped);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Untapped);
    expect(after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === DRAGON_HELM)).toBeUndefined();
  });

  test('cancel-attack is offered even when the bearer is tapped (cost taps the item only)', () => {
    const base = combatVs(DAELOMIN, Race.Dragon);
    const state = setCharStatus(base, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('cancel-attack is NOT offered when the Helm is already tapped', () => {
    const base = combatVs(DAELOMIN, Race.Dragon);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const char = base.players[RESOURCE_PLAYER].characters[aragornId];
    const tapped: GameState = {
      ...base,
      players: base.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [aragornId as string]: {
            ...char,
            items: char.items.map(it => it.definitionId === DRAGON_HELM ? { ...it, status: CardStatus.Tapped } : it),
          },
        },
      }) as unknown as GameState['players'],
    };
    expect(viableActions(tapped, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });
});
