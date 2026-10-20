/**
 * @module le-197.test
 *
 * Card test: In the Name of Mordor (le-197)
 * Type: minion-resource-event (short), non-unique.
 *
 * Card text: "Playable on an untapped character whose company is facing a
 * detainment attack keyed to (by name or type) a Dark-hold [{D}], Dark-domain
 * [{d}], Shadow-hold [{S}], or Shadow-land [{s}]. Tap the character and cancel
 * the attack. Alternatively, this card cancels and discards one Nazgûl hazard
 * event."
 *
 * Effects:
 *   1. cancel-attack, cost `{ tap: "character" }`, `when` = `attack.detainment`
 *      AND keyed to {s}/{d}/{S}/{D} — by type (`attack.keying`,
 *      `attack.siteKeyingTypes`) or by name (`attack.nameKeyedRegionTypes`,
 *      `attack.nameKeyedSiteTypes`).
 *   2. move select:target in-play → discard, filter `keywords $includes Nazgûl`
 *      (a Nazgûl permanent-event in play — Praise to Elbereth tw-305 precedent).
 *
 * | # | Rule                                                        | Test                                         |
 * |---|-------------------------------------------------------------|----------------------------------------------|
 * | 1 | detainment attack keyed by type to Shadow-land → cancel     | Neeker-breekers keyed {s}                    |
 * | 2 | detainment keyed by type to a Shadow-hold → cancel          | Orc-lieutenant keyed {S}                     |
 * | 3 | detainment keyed elsewhere ({w}) → not playable             | Neeker-breekers keyed {w}                    |
 * | 4 | non-detainment attack → not playable                        | Land-drake (normal vs minion)                |
 * | 5 | keyed by name to a Shadow-land region → cancel              | Gondorian Rangers keyed to Dagorlad (covert) |
 * | 6 | keyed by name to a non-dark region → not playable           | Gondorian Rangers keyed to Ithilien          |
 * | 7 | keyed by name to a Shadow-hold site → cancel                | Watcher in the Water keyed to Moria          |
 * | 8 | untapped character only; it taps and attack is canceled     | resolve chain → combat null, char tapped     |
 * | 9 | alternatively discards one Nazgûl hazard (permanent) event  | Witch-king of Angmar in play → discarded     |
 * |10 | non-Nazgûl hazard events are not targetable                 | Foolish Words only → no play                 |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus, Phase,
  buildTestState, resetMint, mint, makeMHState,
  dispatch, resolveChain, viableActions,
  handCardId, companyIdAt, findCharInstanceId, playCreatureHazardAndResolve,
  attachHazardToChar, expectInDiscardPile,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  FOOLISH_WORDS,
} from '../test-helpers.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, CancelAttackAction, PlayShortEventAction } from '../../index.js';

const IN_THE_NAME_OF_MORDOR = 'le-197' as CardDefinitionId;

const NEEKER_BREEKERS = 'tw-493' as CardDefinitionId;   // always detainment; keyed {b}{w}{s}{d}/{R}
const ORC_LIEUTENANT = 'tw-073' as CardDefinitionId;    // Orc keyed {w}{s}{d}/{R}{S}{D}
const LAND_DRAKE = 'le-80' as CardDefinitionId;         // keyed {w}/{R} only — normal vs minion
const GONDORIAN_RANGERS = 'le-76' as CardDefinitionId;  // detainment vs covert; keyed by name to Dagorlad/Ithilien/...
const WATCHER_IN_THE_WATER = 'le-99' as CardDefinitionId; // keyed by name to Moria
const WITCH_KING = 'tw-113' as CardDefinitionId;        // Nazgûl (permanent-event mode)

const ORC_CAPTAIN = 'le-31' as CardDefinitionId;        // minion orc (overt company)
const LUITPRAND = 'le-23' as CardDefinitionId;          // minion man (covert company)
const MORIA_MINION = 'le-392' as CardDefinitionId;      // minion shadow-hold [{S}]; non-Nazgûl attack normally
const MOUNT_GRAM = 'le-394' as CardDefinitionId;        // minion shadow-hold [{S}], no detainment override
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // minion Darkhaven

describe('In the Name of Mordor (le-197)', () => {
  beforeEach(() => resetMint());

  test('detainment attack keyed by type to a Shadow-land: untapped character may tap to cancel', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [ORC_CAPTAIN, LUITPRAND] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [NEEKER_BREEKERS], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Shadow], resolvedSitePathNames: ['Gorgoroth'], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Mount Gram' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-type', value: 'shadow' },
    );
    expect(combatState.combat).not.toBeNull();
    expect(combatState.combat!.detainment).toBe(true);

    // One option per untapped character in the company.
    const cancels = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancels).toHaveLength(2);

    const captainId = findCharInstanceId(combatState, RESOURCE_PLAYER, ORC_CAPTAIN);
    const viaCaptain = cancels.find(a => (a.action as CancelAttackAction).scoutInstanceId === captainId)!;
    expect(viaCaptain).toBeDefined();

    const after = resolveChain(dispatch(combatState, viaCaptain.action));
    expect(after.combat).toBeNull();
    expect(after.players[RESOURCE_PLAYER].characters[captainId].status).toBe(CardStatus.Tapped);
    const luitprandId = findCharInstanceId(after, RESOURCE_PLAYER, LUITPRAND);
    expect(after.players[RESOURCE_PLAYER].characters[luitprandId].status).toBe(CardStatus.Untapped);
    expectInDiscardPile(after, RESOURCE_PLAYER, IN_THE_NAME_OF_MORDOR);
  });

  test('a tapped character cannot be the one to play it', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [{ defId: ORC_CAPTAIN, status: CardStatus.Tapped }] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [NEEKER_BREEKERS], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Shadow], resolvedSitePathNames: ['Gorgoroth'], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Mount Gram' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-type', value: 'shadow' },
    );
    expect(combatState.combat!.detainment).toBe(true);
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('detainment attack keyed by type to a Shadow-hold may be canceled', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [ORC_CAPTAIN] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [ORC_LIEUTENANT], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [], resolvedSitePathNames: [], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Mount Gram' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'site-type', value: 'shadow-hold' },
    );
    expect(combatState.combat!.detainment).toBe(true);
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('a detainment attack keyed to a Wilderness is not cancelable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [ORC_CAPTAIN] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [NEEKER_BREEKERS], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Hithaeglir'], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Mount Gram' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat!.detainment).toBe(true);
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('a normal (non-detainment) attack is not cancelable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [ORC_CAPTAIN] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [LAND_DRAKE], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Hithaeglir'], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Mount Gram' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-type', value: 'wilderness' },
    );
    expect(combatState.combat).not.toBeNull();
    expect(combatState.combat!.detainment).toBe(false);
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('detainment attack keyed by name to a Shadow-land region (Dagorlad) may be canceled', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [GONDORIAN_RANGERS], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Shadow], resolvedSitePathNames: ['Dagorlad'], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Mount Gram' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-name', value: 'Dagorlad' },
    );
    expect(combatState.combat!.detainment).toBe(true);
    const cancels = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancels).toHaveLength(1);
    const after = resolveChain(dispatch(combatState, cancels[0].action));
    expect(after.combat).toBeNull();
  });

  test('detainment attack keyed by name to a Wilderness region (Ithilien) is not cancelable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [GONDORIAN_RANGERS], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Ithilien'], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Mount Gram' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'region-name', value: 'Ithilien' },
    );
    expect(combatState.combat!.detainment).toBe(true);
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('detainment attack keyed by name to a Shadow-hold site (Moria) may be canceled', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [ORC_CAPTAIN] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [WATCHER_IN_THE_WATER], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ resolvedSitePath: [], resolvedSitePathNames: [], destinationSiteType: SiteType.ShadowHold, destinationSiteName: 'Moria' }) };
    const combatState = playCreatureHazardAndResolve(
      state, PLAYER_2, handCardId(state, HAZARD_PLAYER), companyIdAt(state, RESOURCE_PLAYER),
      { method: 'site-name', value: 'Moria' },
    );
    expect(combatState.combat).not.toBeNull();
    expect(combatState.combat!.attackNameKeyedSiteTypes).toEqual([SiteType.ShadowHold]);
    // The Watcher is a normal attack here, so the card is not playable…
    expect(combatState.combat!.detainment).toBe(false);
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
    // …but the same name-keyed attack made detainment (by any other effect)
    // satisfies "keyed by name to a Shadow-hold".
    const detained = { ...combatState, combat: { ...combatState.combat!, detainment: true } };
    expect(viableActions(detained, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('alternatively cancels and discards one Nazgûl hazard event in play', () => {
    const witchKing: CardInPlay = {
      instanceId: mint() as unknown as CardInstanceId,
      definitionId: WITCH_KING,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [], cardsInPlay: [witchKing] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as PlayShortEventAction;
    expect(action.discardTargetInstanceId).toBe(witchKing.instanceId);

    const after = resolveChain(dispatch(state, action));
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === witchKing.instanceId)).toBe(false);
    expectInDiscardPile(after, HAZARD_PLAYER, WITCH_KING);
    expectInDiscardPile(after, RESOURCE_PLAYER, IN_THE_NAME_OF_MORDOR);
  });

  test('a non-Nazgûl hazard event cannot be targeted', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [IN_THE_NAME_OF_MORDOR], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, ORC_CAPTAIN, FOOLISH_WORDS, HAZARD_PLAYER);
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });
});
