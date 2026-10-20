/**
 * @module le-314.test
 *
 * Card test: The Iron Crown (le-314)
 * Type: minion-resource-item (greater), unique. MP 3 (5 stored), CP 5.
 *
 * "Unique. +1 to body to a maximum of 10. +4 to direct influence. Bearer may
 *  tap The Iron Crown to cancel an attack by Orcs, Trolls, or Men against his
 *  company. At the end of his untap phase, if the bearer is not a Ringwraith,
 *  he must make a corruption check. May be stored at Barad-dûr for 5
 *  marshalling points."
 *
 * Effects:
 * 1. `stat-modifier` body +1, max 10.
 * 2. `stat-modifier` direct-influence +4.
 * 3. `cancel-attack` cost `{ tap: "self" }`, when `enemy.race $in [orc, troll, man]`.
 * 4. `on-event: untap-phase-end` → `force-check: corruption` on the bearer,
 *    when `bearer.race $ne ringwraith`.
 * 5. `storable-at` Barad-dûr for 5 MP.
 *
 * | # | Rule                                                       | Status      |
 * |---|------------------------------------------------------------|-------------|
 * | 1 | +1 body to a maximum of 10                                  | IMPLEMENTED |
 * | 2 | +4 direct influence                                         | IMPLEMENTED |
 * | 3 | Tap to cancel an Orc, Troll or Man attack (not others)      | IMPLEMENTED |
 * | 4 | Non-Ringwraith bearer: corruption check at end of untap     | IMPLEMENTED |
 * | 5 | Ringwraith bearer: no untap corruption check (and, per rule  | IMPLEMENTED |
 * |   | 9.20, no use of the Crown's bonuses at all)                 |             |
 * | 6 | Storable at Barad-dûr only, worth 5 MP stored               | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, dispatch, viableActions, attachItemToChar, setItemStatus,
  findCharInstanceId, getCharacter, recomputeDerived, makeCancelWindowCombat,
} from '../test-helpers.js';
import { BARAD_DUR_MINION, Race } from '../../index.js';
import type { CardDefinitionId, CancelAttackAction, CorruptionCheckAction } from '../../index.js';

const IRON_CROWN = 'le-314' as CardDefinitionId;

// Minion fixtures — declared locally per card-ids.ts constants policy.
const GORBAG = 'le-11' as CardDefinitionId;              // orc, body 9, DI 0
const GRISHNAKH = 'le-12' as CardDefinitionId;           // orc, body 8
const SHAGRAT = 'le-39' as CardDefinitionId;             // orc
const ADUNAPHEL = 'le-50' as CardDefinitionId;           // ringwraith, body 10, DI 4
const MITHRIL_COAT = 'le-325' as CardDefinitionId;       // +3 body (max 10)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;       // minion darkhaven
const MORIA_MINION = 'le-392' as CardDefinitionId;       // minion shadow-hold
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId;  // minion ruins-and-lairs

// Creature fixtures (only the race matters for the cancel window).
const ORC_PATROL = 'tw-074' as CardDefinitionId;     // orc
const BERT = 'tw-016' as CardDefinitionId;           // troll
const ASSASSIN = 'tw-8' as CardDefinitionId;         // man
const WARGS = 'tw-109' as CardDefinitionId;          // wolf
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;     // dragon

describe('The Iron Crown (le-314)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1–2: +1 body (max 10), +4 direct influence ─────────────────────

  test('+1 body to a maximum of 10 and +4 direct influence', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GORBAG, GRISHNAKH, ADUNAPHEL] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const withGorbag = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, IRON_CROWN));
    const gorbag = getCharacter(withGorbag, RESOURCE_PLAYER, GORBAG).effectiveStats;
    expect(gorbag.body).toBe(10);              // 9 + 1
    expect(gorbag.directInfluence).toBe(4);    // 0 + 4

    const withGrishnakh = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GRISHNAKH, IRON_CROWN));
    expect(getCharacter(withGrishnakh, RESOURCE_PLAYER, GRISHNAKH).effectiveStats.body).toBe(9); // 8 + 1

    // With The Mithril-coat already raising Grishnákh to 10, the Crown's +1 is capped.
    const withCoat = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GRISHNAKH, MITHRIL_COAT));
    expect(getCharacter(withCoat, RESOURCE_PLAYER, GRISHNAKH).effectiveStats.body).toBe(10);
    const withCoatAndCrown = recomputeDerived(attachItemToChar(withCoat, RESOURCE_PLAYER, GRISHNAKH, IRON_CROWN));
    expect(getCharacter(withCoatAndCrown, RESOURCE_PLAYER, GRISHNAKH).effectiveStats.body).toBe(10);

    // Rule 9.20: a Ringwraith may bear the Crown but cannot use it.
    const withAdunaphel = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ADUNAPHEL, IRON_CROWN));
    const adunaphel = getCharacter(withAdunaphel, RESOURCE_PLAYER, ADUNAPHEL).effectiveStats;
    expect(adunaphel.body).toBe(10);
    expect(adunaphel.directInfluence).toBe(4);
  });

  // ─── Rule 3: tap to cancel an Orc, Troll or Man attack ────────────────────

  test('bearer may tap the Crown to cancel Orc, Troll and Man attacks only', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const withCrown = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, IRON_CROWN);
    const gorbagId = findCharInstanceId(withCrown, RESOURCE_PLAYER, GORBAG);
    const crownId = withCrown.players[RESOURCE_PLAYER].characters[gorbagId].items
      .find(i => i.definitionId === IRON_CROWN)!.instanceId;

    for (const [creatureDefId, creatureRace] of [[ORC_PATROL, Race.Orc], [BERT, Race.Troll], [ASSASSIN, Race.Man]] as const) {
      const combat = makeCancelWindowCombat(withCrown, { creatureDefId, creatureRace, strikesTotal: 1 });
      const actions = viableActions(combat, PLAYER_1, 'cancel-attack');
      expect(actions).toHaveLength(1);
      expect((actions[0].action as CancelAttackAction).cardInstanceId).toBe(crownId);
    }
    for (const [creatureDefId, creatureRace] of [[WARGS, Race.Wolf], [CAVE_DRAKE, Race.Dragon]] as const) {
      const combat = makeCancelWindowCombat(withCrown, { creatureDefId, creatureRace, strikesTotal: 1 });
      expect(viableActions(combat, PLAYER_1, 'cancel-attack')).toHaveLength(0);
    }

    // Activating cancels the attack and taps the Crown, not the bearer.
    const orcCombat = makeCancelWindowCombat(withCrown, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, strikesTotal: 1 });
    const [cancel] = viableActions(orcCombat, PLAYER_1, 'cancel-attack');
    const after = dispatch(orcCombat, cancel.action);
    expect(after.combat).toBeNull();
    const gorbagAfter = after.players[RESOURCE_PLAYER].characters[gorbagId];
    expect(gorbagAfter.items.find(i => i.instanceId === crownId)!.status).toBe(CardStatus.Tapped);
    expect(gorbagAfter.status).toBe(CardStatus.Untapped);

    // An already-tapped Crown cannot cancel.
    const tapped = setItemStatus(orcCombat, RESOURCE_PLAYER, GORBAG, IRON_CROWN, CardStatus.Tapped);
    expect(viableActions(tapped, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ─── Rules 4–5: untap-phase-end corruption check unless a Ringwraith ──────

  test('non-Ringwraith bearer makes a corruption check at the end of his untap phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ETTENMOORS_MINION, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const withCrown = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, IRON_CROWN));
    const gorbagId = findCharInstanceId(withCrown, RESOURCE_PLAYER, GORBAG);

    const after = dispatch(dispatch(withCrown, { type: 'untap', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.phaseState.phase).toBe(Phase.Organization);
    const pending = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    expect(pending[0].actor).toBe(PLAYER_1);
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(gorbagId);
    expect(pending[0].kind.reason).toBe('The Iron Crown');

    // The check counts the Crown's 5 corruption points.
    const checks = viableActions(after, PLAYER_1, 'corruption-check');
    expect(checks).toHaveLength(1);
    expect((checks[0].action as CorruptionCheckAction).corruptionPoints).toBe(5);
  });

  test('the check also applies at a Darkhaven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const withCrown = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, IRON_CROWN);
    const after = dispatch(dispatch(withCrown, { type: 'untap', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(1);
  });

  test('a Ringwraith bearer makes no untap-phase corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ADUNAPHEL] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const withCrown = attachItemToChar(base, RESOURCE_PLAYER, ADUNAPHEL, IRON_CROWN);
    const after = dispatch(dispatch(withCrown, { type: 'untap', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.phaseState.phase).toBe(Phase.Organization);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('no check during the opponent\'s untap phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const withCrown = attachItemToChar(base, HAZARD_PLAYER, SHAGRAT, IRON_CROWN);
    const after = dispatch(dispatch(withCrown, { type: 'untap', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── Rule 6: storable at Barad-dûr for 5 MP ───────────────────────────────

  test('storable at Barad-dûr only; stored it is worth 5 MP instead of 3', () => {
    const elsewhere = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const notStorable = attachItemToChar(elsewhere, RESOURCE_PLAYER, GORBAG, IRON_CROWN);
    expect(viableActions(notStorable, PLAYER_1, 'store-item')).toHaveLength(0);

    const base = recomputeDerived(attachItemToChar(
      buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GORBAG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    }), RESOURCE_PLAYER, GORBAG, IRON_CROWN,
    ));
    expect(base.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(3);

    const stores = viableActions(base, PLAYER_1, 'store-item');
    expect(stores).toHaveLength(1);
    const after = dispatch(base, stores[0].action);
    expect(getCharacter(after, RESOURCE_PLAYER, GORBAG).items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].killPile.map(c => c.definitionId)).toContain(IRON_CROWN);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(5);
  });
});
