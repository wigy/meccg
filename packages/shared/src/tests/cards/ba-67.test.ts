/**
 * @module ba-67.test
 *
 * Card test: Memories of Old Torture (ba-67)
 * Type: minion-resource-event (permanent), Balrog alignment, 1 ally MP.
 *
 * Card text: "Balrog specific. Playable on a Man, Drake, Orc, Troll, or Giant
 * hazard creature attack with one strike for each of its attacks. All attacks
 * of the creature are canceled. The creature becomes an ally under the control
 * of any character in the company. The character need not tap. The ally has a
 * mind of 1, body of 7, and prowess equal to its normal prowess minus 7. It
 * gives 1 ally marshalling point. Discard this card and the ally if the company
 * moves through a Free-domain [{f}] or Dark-domain [{d}]."
 *
 * Effects:
 *  - convert-creature-to-ally — races [man/men/drake/drakes/orc/orcs/troll/
 *    trolls/giant/giants], maxStrikes 1, controllerTaps FALSE ("need not tap"),
 *    ally { mind 1, body 7, prowessModifier -7 }.
 *  - on-event bearer-company-moves self-discard, gated on the traversed site
 *    path containing a Free-domain or Dark-domain region
 *    (`sitePath.regionTypes` $includes free/dark). Because the rule lives on
 *    the event card (not on the converted creature's own hazard definition),
 *    the movement-discard sweep (mh-hazard-play.ts step 8a-2) scans each moving
 *    ally for an attached convert-creature-to-ally event whose discard fires;
 *    the orphaned event then follows via discardOrphanedConvertedAllyEvents.
 *
 * This differs from Ready to His Will (le-220) in two ways exercised below:
 *  1. controllerTaps false — a tapped character may take control, and the
 *     controller does NOT tap on conversion.
 *  2. body 7 (not 8), and the Man/Drake races are added to the eligible list.
 *
 * "Balrog specific" is a deck-construction keyword with no play-time gate
 * (ba-45/ba-46 precedent), so the availability/conversion tests reuse the
 * Ringwraith creature-combat builder; the move-discard tests use a Balrog
 * company at Under-deeps sites.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildRingwraithCreatureCombat, buildTestState,
  attachAllyToChar, addCardInPlay, getCharacter,
  makeMHState,
  viableActions, findAction, dispatch,
  charIdAt,
  Alignment, Phase,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';
import { RegionType } from '../../types/common.js';
import { endCompanyMH } from '../../engine/mh-hazard-play.js';
import { discardOrphanedConvertedAllyEvents } from '../../engine/reducer-utils.js';
import type { CardDefinitionId, ConvertCreatureToAllyAction } from '../../index.js';

const MEMORIES = 'ba-67' as CardDefinitionId;

// Eligible 1-strike creatures (printed prowess → ally prowess = prowess − 7).
const GIANT = 'tw-39' as CardDefinitionId;        // giant, 1 strike, prowess 13 → 6
const MAN_ABDUCTOR = 'tw-1' as CardDefinitionId;  // men, 1 strike, prowess 10 → 3
const LAND_DRAKE = 'le-80' as CardDefinitionId;   // drake, 1 strike, prowess 8 → 1

// Ineligible creatures.
const ORC_PATROL = 'tw-074' as CardDefinitionId;   // orc, 3 strikes (too many)
const BARROW_WIGHT = 'tw-015' as CardDefinitionId; // undead, 1 strike (wrong race)

// Minion controllers.
const ORC_BRAWLER = 'le-30' as CardDefinitionId;
const MUZGASH = 'le-25' as CardDefinitionId;

// Under-deeps sites for the move-discard fixtures (Balrog side).
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;
const UNDER_COURTS = 'ba-98' as CardDefinitionId;
const SULFUR_DEEPS = 'ba-97' as CardDefinitionId;

describe('Memories of Old Torture (ba-67)', () => {
  beforeEach(() => resetMint());

  // ── Availability & eligible races ───────────────────────────────────

  test.each([
    { race: 'giant', defId: GIANT, prowess: 6 },
    { race: 'men', defId: MAN_ABDUCTOR, prowess: 3 },
    { race: 'drake', defId: LAND_DRAKE, prowess: 1 },
  ])('offered against an eligible 1-strike $race creature; ally prowess = printed − 7', ({ race, defId, prowess }) => {
    const { state, creatureInstanceId } = buildRingwraithCreatureCombat({
      creatureDefId: defId, creatureRace: race, characters: [ORC_BRAWLER], hand: [MEMORIES],
    });
    const action = findAction<ConvertCreatureToAllyAction>(state, PLAYER_1, 'convert-creature-to-ally');
    expect(action).toBeDefined();

    const after = dispatch(state, action!);
    const ally = after.players[RESOURCE_PLAYER].characters[charIdAt(state, RESOURCE_PLAYER)].allies[0];
    expect(ally.instanceId).toBe(creatureInstanceId);
    // mind 1, body 7, prowess = printed prowess − 7.
    expect(ally.statOverride).toEqual({ mind: 1, prowess, body: 7 });
  });

  test('NOT offered against a creature with more than one strike', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: ORC_PATROL, creatureRace: 'orc', characters: [ORC_BRAWLER], hand: [MEMORIES],
    });
    expect(viableActions(state, PLAYER_1, 'convert-creature-to-ally')).toHaveLength(0);
  });

  test('NOT offered against an ineligible race (undead)', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: BARROW_WIGHT, creatureRace: 'undead', characters: [ORC_BRAWLER], hand: [MEMORIES],
    });
    expect(viableActions(state, PLAYER_1, 'convert-creature-to-ally')).toHaveLength(0);
  });

  test('NOT offered to the attacking (hazard) player', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: 'giant', characters: [ORC_BRAWLER], hand: [MEMORIES],
    });
    expect(viableActions(state, PLAYER_2, 'convert-creature-to-ally')).toHaveLength(0);
  });

  // ── "The character need not tap" (controllerTaps: false) ────────────

  test('one action per company character, including a tapped one (need not tap)', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: 'giant', characters: [ORC_BRAWLER, MUZGASH], hand: [MEMORIES],
    });
    // Both untapped → two controller choices.
    expect(viableActions(state, PLAYER_1, 'convert-creature-to-ally')).toHaveLength(2);

    // Tap the first character — unlike le-220, it remains an eligible
    // controller because ba-67's controller need not tap.
    const firstCharId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const tapped = {
      ...state,
      players: state.players.map((p, i) => i === RESOURCE_PLAYER
        ? { ...p, characters: { ...p.characters, [firstCharId]: { ...p.characters[firstCharId], status: CardStatus.Tapped } } }
        : p) as unknown as typeof state.players,
    };
    const remaining = viableActions(tapped, PLAYER_1, 'convert-creature-to-ally');
    expect(remaining).toHaveLength(2);
    expect(remaining.map(a => (a.action as ConvertCreatureToAllyAction).controllingCharacterId))
      .toContain(firstCharId);
  });

  test('conversion does NOT tap the controlling character and ends combat', () => {
    const { state, creatureInstanceId } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: 'giant', characters: [ORC_BRAWLER], hand: [MEMORIES],
    });
    const controllerId = charIdAt(state, RESOURCE_PLAYER);
    const action = findAction<ConvertCreatureToAllyAction>(
      state, PLAYER_1, 'convert-creature-to-ally', a => a.controllingCharacterId === controllerId,
    );
    const after = dispatch(state, action!);

    // Combat ends (all attacks canceled) and the creature left the attacker.
    expect(after.combat).toBeNull();
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === creatureInstanceId)).toBe(false);

    // The controller keeps the ally but stays UNTAPPED (need not tap).
    const controller = after.players[RESOURCE_PLAYER].characters[controllerId];
    expect(controller.status).toBe(CardStatus.Untapped);
    expect(controller.allies).toHaveLength(1);
    expect(controller.allies[0].instanceId).toBe(creatureInstanceId);
    expect(controller.allies[0].status).toBe(CardStatus.Untapped);
  });

  test('places the event card with the creature and scores 1 ally marshalling point', () => {
    const { state, creatureInstanceId } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: 'giant', characters: [ORC_BRAWLER], hand: [MEMORIES],
    });
    const action = findAction<ConvertCreatureToAllyAction>(state, PLAYER_1, 'convert-creature-to-ally');
    const after = dispatch(state, action!);

    const p = after.players[RESOURCE_PLAYER];
    expect(p.hand.some(c => c.definitionId === MEMORIES)).toBe(false);
    const eventInPlay = p.cardsInPlay.find(c => c.definitionId === MEMORIES);
    expect(eventInPlay).toBeDefined();
    expect(eventInPlay!.attachedTo).toBe(creatureInstanceId);
    expect(p.marshallingPoints.ally).toBe(1);
  });

  // ── Discard on movement through a Free-domain / Dark-domain ─────────

  test.each([
    { label: 'a Free-domain', path: [RegionType.Free], discarded: true },
    { label: 'a Dark-domain', path: [RegionType.Dark], discarded: true },
    { label: 'only a Wilderness', path: [RegionType.Wilderness], discarded: false },
  ])('company moving through $label — ally & event discarded: $discarded', ({ path, discarded }) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: UNDER_GALLERIES, characters: [ORC_BRAWLER], destinationSite: SULFUR_DEEPS }],
          hand: [], siteDeck: [], playDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_COURTS, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    // The converted creature is an ally; ba-67 sits in cards-in-play "with" it.
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ORC_BRAWLER, GIANT);
    const allyInst = getCharacter(withAlly, RESOURCE_PLAYER, ORC_BRAWLER).allies[0].instanceId;
    const withEvent = addCardInPlay(withAlly, RESOURCE_PLAYER, MEMORIES);
    const cip = withEvent.players[RESOURCE_PLAYER].cardsInPlay;
    const eventInst = cip[cip.length - 1].instanceId;
    const state = {
      ...withEvent,
      players: withEvent.players.map((p, i) => i === RESOURCE_PLAYER
        ? { ...p, cardsInPlay: p.cardsInPlay.map(c => c.instanceId === eventInst ? { ...c, attachedTo: allyInst } : c) }
        : p) as unknown as typeof withEvent.players,
    };

    const result = endCompanyMH(state, makeMHState({ resolvedSitePath: [...path], activeCompanyIndex: 0 }));
    // The orphaned-event sweep is a postReduce step; run it explicitly here
    // since endCompanyMH is invoked directly (not via reduce()).
    const swept = discardOrphanedConvertedAllyEvents(result.state);

    const allies = getCharacter(swept, RESOURCE_PLAYER, ORC_BRAWLER).allies;
    const discardPile = swept.players[RESOURCE_PLAYER].discardPile;
    const eventStillInPlay = swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === eventInst);

    if (discarded) {
      expect(allies.some(a => a.instanceId === allyInst)).toBe(false);
      expect(discardPile.some(c => c.instanceId === allyInst)).toBe(true);
      expect(discardPile.some(c => c.instanceId === eventInst)).toBe(true);
      expect(eventStillInPlay).toBe(false);
    } else {
      expect(allies.some(a => a.instanceId === allyInst)).toBe(true);
      expect(discardPile.some(c => c.instanceId === allyInst)).toBe(false);
      expect(eventStillInPlay).toBe(true);
    }
  });
});
