/**
 * @module dm-173.test
 *
 * Card test: Mithril (dm-173)
 * Type: hero-resource-item (special), unique. 3 CP, 3 MP (7 when stored).
 *
 * Text:
 *   "Unique. Playable with a Sage or Dwarf only during the site phase at The
 *    Under-gates if you have a stored Vein of Arda. Sage or Dwarf may not
 *    untap until Mithril is stored at a Haven [{H}]. Mithril is worth 7
 *    marshalling points when stored. During any organization phase in which
 *    you store Mithril, you may immediately tap a character in the same
 *    company and play with him a non-unique, non-special weapon, armor,
 *    shield, or helmet from your hand or discard pile. When Mithril is
 *    stored, each Dwarf in play must immediately make a corruption check
 *    modified by -3."
 *
 * Rule coverage:
 *
 * | # | Rule                                         | Mechanism                                                                 |
 * |---|----------------------------------------------|---------------------------------------------------------------------------|
 * | 1 | Only at The Under-gates (site phase)         | `item-play-site` `sites: ["The Under-gates"]`                             |
 * | 2 | With a Sage or Dwarf only                    | item bearer `play-target` filter (sage skill OR dwarf race)               |
 * | 3 | Only if you have a stored Vein of Arda       | `play-condition: player-state` on `player.storedCardNames`                |
 * | 4 | Bearer may not untap until stored            | `play-flag: bearer-cannot-untap-until-stored` (item attach path)          |
 * | 5 | 7 MP when stored                             | `storable-at` Haven, `marshallingPoints: 7`                               |
 * | 6 | Org-phase store: tap a company mate, play a non-unique non-special weapon/armor/shield/helmet from hand or discard | `on-event: self-stored` (`when phase = organization`) → company-scoped `item-placement-offer` |
 * | 7 | On store, each Dwarf in play: CC at -3       | `on-event: self-stored` → `enqueue-corruption-check-all-in-play` (dwarf)  |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, Phase,
  resetMint, addStoredCard, setCharStatus,
  buildSitePhaseState, buildHavenStoreScenario,
  findCharInstanceId, findHandCardId,
  viableActions, dispatch, executeAction,
  GALADRIEL, GIMLI, ARAGORN, BALIN, LEGOLAS, RIVENDELL,
  DAGGER_OF_WESTERNESSE, GLAMDRING, HORN_OF_ANOR, HAUBERK_OF_BRIGHT_MAIL,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHeroResourceAction, PlayItemPlacementOfferAction } from '../../index.js';

const MITHRIL = 'dm-173' as CardDefinitionId;
const VEIN_OF_ARDA = 'dm-162' as CardDefinitionId;
const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;
const THE_UNDER_VAULTS = 'dm-41' as CardDefinitionId; // a different Under-deeps site
const AIGLOS = 'dm-166' as CardDefinitionId; // unique special weapon — never offered

/**
 * Storage fixture (via `buildHavenStoreScenario`): P1 at Rivendell — Gimli
 * (Dwarf) bears Mithril, Galadriel (Elf sage) stands by. Hand: Dagger of
 * Westernesse (non-unique weapon), Glamdring (unique weapon), Horn of Anor
 * (no weapon/armor/shield/helmet keyword), Aiglos (special weapon). Discard
 * pile: Hauberk of Bright Mail (non-unique armor). P2 at Lórien — Balin
 * (Dwarf) and Legolas (Elf).
 */
const STORE_FIXTURE = {
  p1Characters: [{ defId: GIMLI, items: [MITHRIL] }, GALADRIEL],
  p2Characters: [BALIN, LEGOLAS],
  hand: [DAGGER_OF_WESTERNESSE, GLAMDRING, HORN_OF_ANOR, AIGLOS],
  discardPile: [HAUBERK_OF_BRIGHT_MAIL],
};

describe('Mithril (dm-173)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–3: where, with whom, and the stored-Vein gate ──────────────

  test('playable with a Sage at The Under-gates when Vein of Arda is stored', () => {
    const { state } = addStoredCard(
      buildSitePhaseState({ characters: [GALADRIEL], site: THE_UNDER_GATES, hand: [MITHRIL] }),
      RESOURCE_PLAYER, VEIN_OF_ARDA, RIVENDELL);
    const targets = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as PlayHeroResourceAction).attachToCharacterId);
    expect(targets).toEqual([findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL)]);
  });

  test('playable with a Dwarf; a character who is neither Sage nor Dwarf is not a legal bearer', () => {
    const { state } = addStoredCard(
      buildSitePhaseState({ characters: [GIMLI, ARAGORN], site: THE_UNDER_GATES, hand: [MITHRIL] }),
      RESOURCE_PLAYER, VEIN_OF_ARDA, RIVENDELL);
    const targets = viableActions(state, PLAYER_1, 'play-hero-resource')
      .map(a => (a.action as PlayHeroResourceAction).attachToCharacterId);
    expect(targets).toContain(findCharInstanceId(state, RESOURCE_PLAYER, GIMLI));
    expect(targets).not.toContain(findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN));
  });

  test('NOT playable without a stored Vein of Arda', () => {
    const state = buildSitePhaseState({ characters: [GALADRIEL], site: THE_UNDER_GATES, hand: [MITHRIL] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('a Vein of Arda merely borne (not stored) does not satisfy the gate', () => {
    const state = buildSitePhaseState({
      characters: [{ defId: GALADRIEL, items: [VEIN_OF_ARDA] }, GIMLI],
      site: THE_UNDER_GATES,
      hand: [MITHRIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('NOT playable at another Under-deeps site, even with a stored Vein of Arda', () => {
    const { state } = addStoredCard(
      buildSitePhaseState({ characters: [GALADRIEL], site: THE_UNDER_VAULTS, hand: [MITHRIL] }),
      RESOURCE_PLAYER, VEIN_OF_ARDA, RIVENDELL);
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Rule 4: bearer may not untap until Mithril is stored ───────────────

  test('playing it attaches Mithril, taps the bearer, and locks him tapped through the untap phase', () => {
    const { state } = addStoredCard(
      buildSitePhaseState({ characters: [GIMLI], site: THE_UNDER_GATES, hand: [MITHRIL] }),
      RESOURCE_PLAYER, VEIN_OF_ARDA, RIVENDELL);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const after = dispatch(state, viableActions(state, PLAYER_1, 'play-hero-resource')[0].action);

    const gimli = after.players[RESOURCE_PLAYER].characters[gimliId];
    expect(gimli.items.some(i => i.definitionId === MITHRIL)).toBe(true);
    expect(gimli.status).toBe(CardStatus.Tapped);
    expect(after.activeConstraints.some(c => c.kind.type === 'bearer-cannot-untap'
      && c.target.kind === 'character' && c.target.characterId === gimliId)).toBe(true);

    const inUntap = {
      ...after,
      pendingResolutions: [],
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      } as typeof after.phaseState,
    };
    const afterUntap = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });
    expect(afterUntap.players[RESOURCE_PLAYER].characters[gimliId].status).toBe(CardStatus.Tapped);
  });

  test('storing clears the bearer untap lock', () => {
    const state = buildHavenStoreScenario(STORE_FIXTURE);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const mithrilId = state.players[RESOURCE_PLAYER].characters[gimliId].items[0].instanceId;
    const locked: GameState = {
      ...state,
      activeConstraints: [...state.activeConstraints, {
        id: 'c-mithril' as GameState['activeConstraints'][number]['id'],
        source: mithrilId,
        sourceDefinitionId: MITHRIL,
        scope: { kind: 'until-cleared' },
        target: { kind: 'character', characterId: gimliId },
        kind: { type: 'bearer-cannot-untap', cardInstanceId: mithrilId },
      }],
    };
    const after = dispatch(locked, viableActions(locked, PLAYER_1, 'store-item')[0].action);
    expect(after.activeConstraints.some(c => c.kind.type === 'bearer-cannot-untap')).toBe(false);
  });

  // ── Rule 5: 3 MP borne, 7 MP stored ───────────────────────────────────

  test('worth 3 item MP while borne and 7 once stored at a Haven', () => {
    const state = buildHavenStoreScenario(STORE_FIXTURE);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(3);
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const stored = executeAction(dispatch(state, storeActions[0].action), PLAYER_1, 'corruption-check', 12);
    const after = recomputeDerived(stored);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === MITHRIL)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(7);
  });

  // ── Rule 7: each Dwarf in play makes a corruption check at -3 ─────────

  test('storing enqueues a -3 corruption check for every Dwarf in play (both players), and none for non-Dwarves', () => {
    const state = buildHavenStoreScenario(STORE_FIXTURE);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const balinId = findCharInstanceId(state, HAZARD_PLAYER, BALIN);
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);

    const after = dispatch(state, viableActions(state, PLAYER_1, 'store-item')[0].action);
    const mithrilChecks = after.pendingResolutions.filter(r =>
      r.kind.type === 'corruption-check' && r.kind.reason === 'Mithril');
    const checked = mithrilChecks.map(r => r.kind.type === 'corruption-check' ? r.kind.characterId : null);
    expect(checked).toContain(gimliId);
    expect(checked).toContain(balinId);
    expect(checked).not.toContain(galadrielId);
    expect(checked).not.toContain(legolasId);
    for (const r of mithrilChecks) {
      if (r.kind.type === 'corruption-check') expect(r.kind.modifier).toBe(-3);
    }
    const balinCheck = mithrilChecks.find(r => r.kind.type === 'corruption-check' && r.kind.characterId === balinId)!;
    expect(balinCheck.actor).toBe(PLAYER_2);
  });

  test("the opponent's Dwarf check resolves with the -3 modifier and a failure takes effect", () => {
    const base = buildHavenStoreScenario(STORE_FIXTURE);
    const balinId = findCharInstanceId(base, HAZARD_PLAYER, BALIN);
    let state = executeAction(dispatch(base, viableActions(base, PLAYER_1, 'store-item')[0].action), PLAYER_1, 'corruption-check', 12);
    // Decline the item offer, then pass Gimli's -3 check (roll 12).
    state = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    state = executeAction(state, PLAYER_1, 'corruption-check', 12);
    // Balin has 0 CP: a roll of 3, modified by -3, is 0 — not above 0, so he fails.
    expect(state.pendingResolutions.find(r => r.kind.type === 'corruption-check')?.actor).toBe(PLAYER_2);
    const after = executeAction(state, PLAYER_2, 'corruption-check', 3);
    expect(after.players[HAZARD_PLAYER].characters[balinId]).toBeUndefined();
  });

  // ── Rule 6: organization-phase item offer ──────────────────────────────

  test('offers each qualifying hand/discard item with each untapped company character, plus a decline', () => {
    const base = buildHavenStoreScenario(STORE_FIXTURE);
    const state = executeAction(dispatch(base, viableActions(base, PLAYER_1, 'store-item')[0].action), PLAYER_1, 'corruption-check', 12);
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const hauberkId = state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === HAUBERK_OF_BRIGHT_MAIL)!.instanceId;

    const offers = viableActions(state, PLAYER_1, 'play-item-placement-offer').map(a => a.action as PlayItemPlacementOfferAction);
    const items = offers.map(o => o.cardInstanceId);
    expect(items).toContain(findHandCardId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)); // non-unique weapon, hand
    expect(items).toContain(hauberkId); // non-unique armor, discard pile
    expect(items).not.toContain(findHandCardId(state, RESOURCE_PLAYER, GLAMDRING)); // unique
    expect(items).not.toContain(findHandCardId(state, RESOURCE_PLAYER, HORN_OF_ANOR)); // not weapon/armor/shield/helmet
    expect(items).not.toContain(findHandCardId(state, RESOURCE_PLAYER, AIGLOS)); // special
    // Gimli (untapped after storing) and Galadriel may each be the one who taps.
    expect(new Set(offers.map(o => o.characterId))).toEqual(new Set([gimliId, galadrielId]));
    expect(viableActions(state, PLAYER_1, 'pass').length).toBeGreaterThan(0);
  });

  test('accepting taps the chosen character and plays the item from the discard pile with him', () => {
    const base = buildHavenStoreScenario(STORE_FIXTURE);
    const state = executeAction(dispatch(base, viableActions(base, PLAYER_1, 'store-item')[0].action), PLAYER_1, 'corruption-check', 12);
    const galadrielId = findCharInstanceId(state, RESOURCE_PLAYER, GALADRIEL);
    const hauberkId = state.players[RESOURCE_PLAYER].discardPile
      .find(c => c.definitionId === HAUBERK_OF_BRIGHT_MAIL)!.instanceId;
    const action = viableActions(state, PLAYER_1, 'play-item-placement-offer')
      .map(a => a.action as PlayItemPlacementOfferAction)
      .find(x => x.cardInstanceId === hauberkId && x.characterId === galadrielId)!;
    const after = dispatch(state, action);

    const p1 = after.players[RESOURCE_PLAYER];
    expect(p1.characters[galadrielId].status).toBe(CardStatus.Tapped);
    expect(p1.characters[galadrielId].items.some(i => i.instanceId === hauberkId)).toBe(true);
    expect(p1.discardPile.some(c => c.instanceId === hauberkId)).toBe(false);
    // Mithril stays stored — nothing is paid from it.
    expect(p1.killPile.some(c => c.definitionId === MITHRIL)).toBe(true);
    expect(after.pendingResolutions.some(r => r.kind.type === 'item-placement-offer')).toBe(false);
  });

  test('accepting with a hand item removes it from hand and taps the recipient', () => {
    const base = buildHavenStoreScenario(STORE_FIXTURE);
    const state = executeAction(dispatch(base, viableActions(base, PLAYER_1, 'store-item')[0].action), PLAYER_1, 'corruption-check', 12);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const daggerId: CardInstanceId = findHandCardId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const action = viableActions(state, PLAYER_1, 'play-item-placement-offer')
      .map(a => a.action as PlayItemPlacementOfferAction)
      .find(x => x.cardInstanceId === daggerId && x.characterId === gimliId)!;
    const after = dispatch(state, action);
    const p1 = after.players[RESOURCE_PLAYER];
    expect(p1.characters[gimliId].items.some(i => i.instanceId === daggerId)).toBe(true);
    expect(p1.characters[gimliId].status).toBe(CardStatus.Tapped);
    expect(p1.hand.some(c => c.instanceId === daggerId)).toBe(false);
  });

  test('a tapped company character is not offered as the recipient', () => {
    const base = setCharStatus(buildHavenStoreScenario(STORE_FIXTURE), RESOURCE_PLAYER, GALADRIEL, CardStatus.Tapped);
    const galadrielId = findCharInstanceId(base, RESOURCE_PLAYER, GALADRIEL);
    const state = executeAction(dispatch(base, viableActions(base, PLAYER_1, 'store-item')[0].action), PLAYER_1, 'corruption-check', 12);
    const recipients = new Set(viableActions(state, PLAYER_1, 'play-item-placement-offer')
      .map(a => (a.action as PlayItemPlacementOfferAction).characterId));
    expect(recipients.has(galadrielId)).toBe(false);
    expect(recipients.size).toBe(1);
  });

  test('the item offer is organization-phase only: storing at end of turn opens no offer but still checks Dwarves', () => {
    const state = buildHavenStoreScenario({ ...STORE_FIXTURE, phase: Phase.EndOfTurn });
    const balinId = findCharInstanceId(state, HAZARD_PLAYER, BALIN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const mithrilId = state.players[RESOURCE_PLAYER].characters[gimliId].items[0].instanceId;
    // End-of-turn storage is only *offered* under an allow-store-eot card
    // (Safe from the Shadow); the store-item reducer accepts it in this phase.
    const after = dispatch(state, { type: 'store-item', player: PLAYER_1, characterId: gimliId, itemInstanceId: mithrilId });
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === MITHRIL)).toBe(true);
    expect(after.pendingResolutions.some(r => r.kind.type === 'item-placement-offer')).toBe(false);
    expect(after.pendingResolutions.some(r =>
      r.kind.type === 'corruption-check' && r.kind.reason === 'Mithril' && r.kind.characterId === balinId)).toBe(true);
  });
});
