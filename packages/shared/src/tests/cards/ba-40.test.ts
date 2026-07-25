/**
 * @module ba-40.test
 *
 * Card test: Long Grievous Siege (ba-40)
 * Type: minion-resource-event (permanent, non-unique, 1 misc MP)
 *
 * "Playable on a unique non-Dragon faction. Place a Border-hold [{B}] from
 *  your location deck 'off to the side' with this card. The Border-hold must
 *  be in the same region or adjacent thereto as a site where the target
 *  faction is playable. Return any faction playable at the Border-hold to its
 *  owner's hand. -5 to any attempt to play a faction at any version of the
 *  Border-hold. All versions of the Border-hold gain an additional
 *  automatic-attack: same type as your target faction — 5 strikes with 9
 *  prowess (detainment against your companies). Cannot be duplicated on your
 *  faction."
 *
 * CRF: "There must be an eligible borderhold for this card to be played."
 *
 * Engine Support:
 * | # | Feature                                            | Status      | Notes                                            |
 * |---|----------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | play-target faction (unique, non-Dragon, own)      | IMPLEMENTED | faction branch in organization-events.ts          |
 * | 2 | Border-hold from location deck, same/adjacent regn | IMPLEMENTED | factionSiegeEligibleSites (reducer-utils.ts)      |
 * | 3 | Site set aside with the card on resolution         | IMPLEMENTED | chain-reducer.ts + placeCardSetAside              |
 * | 4 | Return factions playable at the Border-hold        | IMPLEMENTED | chain-reducer.ts, isCardPlayableAtSiteDef         |
 * | 5 | -5 faction attempts at any version (by site name)  | IMPLEMENTED | siteFactionInfluenceModifier (need + roll)        |
 * | 6 | Extra auto-attack, type = target faction's race    | IMPLEMENTED | collectPermanentEventAttacks (manifestations.ts)  |
 * | 7 | Detainment against controller's companies only     | IMPLEMENTED | AutomaticAttack.detainmentAgainstPlayer           |
 * | 8 | Cannot be duplicated on your faction               | IMPLEMENTED | duplication-limit scope "faction"                 |
 * | 9 | Cleanup when target faction leaves play            | IMPLEMENTED | discardOrphanedFactionAttachedEvents; site card   |
 * |   |                                                    |             | returns to location deck via sweepSetAside        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  makeSitePhase, setupAutoAttackStep, siteDeckInstId,
  firstFactionInfluenceAttempt, viableActions, dispatch, resolveChain,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, PlayPermanentEventAction,
} from '../../index.js';

const LONG_GRIEVOUS_SIEGE = 'ba-40' as CardDefinitionId;

// Minion factions
const EASTERLINGS = 'le-264' as CardDefinitionId;      // man, unique, @ Easterling Camp (Horse Plains)
const BALCHOTH = 'le-260' as CardDefinitionId;         // man, unique, @ Raider-hold (Horse Plains)
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId; // man, unique, @ Shrel-Kain (Dorwinion)
const HILLMEN = 'le-269' as CardDefinitionId;          // man, unique, @ Cameth Brin (Rhudaur)
const SCATHA_ROUSED = 'le-283' as CardDefinitionId;    // DRAGON faction — excluded target
const SNAGA_HAI = 'le-286' as CardDefinitionId;        // non-unique — excluded target

// Hero faction
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId; // @ Bree (hero version)

// Minion sites
const RAIDER_HOLD = 'le-399' as CardDefinitionId;      // border-hold, Horse Plains
const DALE = 'le-363' as CardDefinitionId;             // border-hold, Northern Rhovanion (adj. Dorwinion)
const BREE_MINION = 'le-356' as CardDefinitionId;      // border-hold, Arthedain
const DOL_GULDUR = 'le-367' as CardDefinitionId;       // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // minion haven

// Hero site
const BREE_HERO = 'tw-378' as CardDefinitionId;        // border-hold, Arthedain (hero version of Bree)
const RIVENDELL = 'tw-421' as CardDefinitionId;

// Characters
const CIRYAHER = 'le-6' as CardDefinitionId;           // minion dúnadan, DI 2
const LAGDUF = 'le-18' as CardDefinitionId;            // minion orc warrior
const GORBAG = 'le-11' as CardDefinitionId;            // minion orc
const ARAGORN = 'tw-120' as CardDefinitionId;          // hero dúnadan, DI 3

/** In-play faction entry owned by the given test player prefix. */
function factionInPlay(instanceId: string, defId: CardDefinitionId): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

/**
 * The three cards-in-play entries of an already-resolved Long Grievous Siege:
 * the target faction, the siege host (attached to faction + site), and the
 * set-aside Border-hold site card.
 */
function siegeInPlay(prefix: string, factionDefId: CardDefinitionId, siteDefId: CardDefinitionId): CardInPlay[] {
  const factionId = `${prefix}-901` as CardInstanceId;
  const siegeId = `${prefix}-902` as CardInstanceId;
  const siteChildId = `${prefix}-903` as CardInstanceId;
  return [
    { instanceId: factionId, definitionId: factionDefId, status: CardStatus.Untapped },
    {
      instanceId: siegeId, definitionId: LONG_GRIEVOUS_SIEGE, status: CardStatus.Untapped,
      attachedTo: factionId, attachedToSite: siteDefId, setAside: [siteChildId],
    },
    { instanceId: siteChildId, definitionId: siteDefId, status: CardStatus.Untapped, setAsideHost: siegeId },
  ];
}

/** Organization-phase minion state for playing the siege from hand. */
function buildOrgState(opts: {
  p1CardsInPlay?: CardInPlay[];
  p1SiteDeck: CardDefinitionId[];
  p2CardsInPlay?: CardInPlay[];
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
        hand: [LONG_GRIEVOUS_SIEGE],
        siteDeck: opts.p1SiteDeck,
        cardsInPlay: opts.p1CardsInPlay ?? [],
      },
      {
        id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
        hand: [], siteDeck: [MINAS_MORGUL],
        cardsInPlay: opts.p2CardsInPlay ?? [],
      },
    ],
  });
}

describe('Long Grievous Siege (ba-40)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1+2: play-target + eligible Border-hold ──────────────────────────

  test('playable on own unique non-Dragon faction with a Border-hold in the same region', () => {
    // Easterlings are playable at Easterling Camp (Horse Plains); Raider-hold
    // is a Border-hold in Horse Plains → eligible. Bree (Arthedain) is not.
    const state = buildOrgState({
      p1CardsInPlay: [factionInPlay('p1-901', EASTERLINGS)],
      p1SiteDeck: [RAIDER_HOLD, BREE_MINION, DOL_GULDUR],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetFactionInstanceId).toBe('p1-901');
    expect(actions[0].besiegedSiteInstanceId).toBe(siteDeckInstId(state, 0, RAIDER_HOLD));
  });

  test('a Border-hold in a region ADJACENT to the faction\'s playable site qualifies', () => {
    // Men of Dorwinion are playable at Shrel-Kain (Dorwinion); Dale is a
    // Border-hold in Northern Rhovanion, adjacent to Dorwinion.
    const state = buildOrgState({
      p1CardsInPlay: [factionInPlay('p1-901', MEN_OF_DORWINION)],
      p1SiteDeck: [DALE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].besiegedSiteInstanceId).toBe(siteDeckInstId(state, 0, DALE));
  });

  test('NOT playable when no eligible Border-hold is in the location deck (CRF)', () => {
    // Bree (Arthedain) is neither in nor adjacent to Horse Plains.
    const state = buildOrgState({
      p1CardsInPlay: [factionInPlay('p1-901', EASTERLINGS)],
      p1SiteDeck: [BREE_MINION, DOL_GULDUR],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a Dragon faction', () => {
    const state = buildOrgState({
      p1CardsInPlay: [factionInPlay('p1-901', SCATHA_ROUSED)],
      p1SiteDeck: [RAIDER_HOLD, DALE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a non-unique faction', () => {
    const state = buildOrgState({
      p1CardsInPlay: [factionInPlay('p1-901', SNAGA_HAI)],
      p1SiteDeck: [RAIDER_HOLD, DALE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Rule 8: cannot be duplicated on your faction ──────────────────────────

  test('a second copy cannot be played on a faction already under siege', () => {
    // Easterling Camp (Horse Plains) is itself an eligible Border-hold, so
    // only the duplication limit blocks the second copy.
    const state = buildOrgState({
      p1CardsInPlay: siegeInPlay('p1', EASTERLINGS, RAIDER_HOLD),
      p1SiteDeck: ['le-371' as CardDefinitionId], // Easterling Camp, border-hold, Horse Plains
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ─── Rules 3+4: resolution — set-aside + faction bounce ────────────────────

  test('resolution binds faction + site, sets the Border-hold aside, and bounces factions playable there', () => {
    const state = buildOrgState({
      p1CardsInPlay: [factionInPlay('p1-901', EASTERLINGS)],
      p1SiteDeck: [RAIDER_HOLD, DOL_GULDUR],
      // Balchoth (playable at Raider-hold) is in the OPPONENT's play area.
      p2CardsInPlay: [factionInPlay('p2-950', BALCHOTH)],
    });
    const raiderHoldInstId = siteDeckInstId(state, 0, RAIDER_HOLD);
    const lgsHandId = state.players[0].hand[0].instanceId;
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const resolved = resolveChain(dispatch(state, action));

    // The siege is in play, attached to the faction and bound to the site.
    const host = resolved.players[0].cardsInPlay.find(c => c.instanceId === lgsHandId);
    expect(host).toBeDefined();
    expect(host!.attachedTo).toBe('p1-901');
    expect(host!.attachedToSite).toBe(RAIDER_HOLD);
    expect(host!.setAside).toEqual([raiderHoldInstId]);

    // The Border-hold card left the location deck and is off to the side.
    expect(resolved.players[0].siteDeck.some(s => s.instanceId === raiderHoldInstId)).toBe(false);
    const child = resolved.players[0].cardsInPlay.find(c => c.instanceId === raiderHoldInstId);
    expect(child).toBeDefined();
    expect(child!.setAsideHost).toBe(lgsHandId);

    // Balchoth (playable at Raider-hold) returned to its owner's hand;
    // the target Easterlings (not playable there) stay in play.
    expect(resolved.players[1].cardsInPlay.some(c => c.instanceId === ('p2-950' as CardInstanceId))).toBe(false);
    expect(resolved.players[1].hand.some(c => c.instanceId === ('p2-950' as CardInstanceId))).toBe(true);
    expect(resolved.players[0].cardsInPlay.some(c => c.instanceId === ('p1-901' as CardInstanceId))).toBe(true);
  });

  // ─── Rule 5: -5 to faction attempts at any version of the Border-hold ─────

  test('-5 to a faction influence attempt at the besieged Border-hold', () => {
    // Opponent (PLAYER_2) besieges Raider-hold; PLAYER_1's Ciryaher (DI 2)
    // attempts Balchoth (influence # 9) at Raider-hold.
    // Baseline need = 9 - 2 = 7; under siege need = 9 - (2 - 5) = 12.
    const build = (withSiege: boolean) => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          {
            id: PLAYER_1, alignment: Alignment.Ringwraith,
            companies: [{ site: RAIDER_HOLD, characters: [CIRYAHER] }],
            hand: [BALCHOTH], siteDeck: [DOL_GULDUR],
          },
          {
            id: PLAYER_2, alignment: Alignment.Ringwraith,
            companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
            hand: [], siteDeck: [MINAS_MORGUL],
            cardsInPlay: withSiege ? siegeInPlay('p2', EASTERLINGS, RAIDER_HOLD) : [],
          },
        ],
      });
      return { ...base, phaseState: makeSitePhase() };
    };

    const baseline = build(false);
    const baselineAttempt = firstFactionInfluenceAttempt(baseline, baseline.players[0].hand[0].instanceId);
    expect(baselineAttempt).toBeDefined();
    expect(baselineAttempt!.need).toBe(7);

    const sieged = build(true);
    const siegedAttempt = firstFactionInfluenceAttempt(sieged, sieged.players[0].hand[0].instanceId);
    expect(siegedAttempt).toBeDefined();
    expect(siegedAttempt!.need).toBe(12);
  });

  test('-5 applies at ANOTHER VERSION of the Border-hold (hero Bree vs besieged minion Bree)', () => {
    // PLAYER_2 (minion) besieges the minion version of Bree (le-356) with
    // Hillmen (playable at Cameth Brin, Rhudaur — adjacent to Arthedain).
    // PLAYER_1 (hero) attempts Rangers of the North at the HERO version of
    // Bree (tw-378, a different definition id). The -5 must still apply.
    const build = (withSiege: boolean) => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          {
            id: PLAYER_1, alignment: Alignment.Wizard,
            companies: [{ site: BREE_HERO, characters: [ARAGORN] }],
            hand: [RANGERS_OF_THE_NORTH], siteDeck: [RIVENDELL],
          },
          {
            id: PLAYER_2, alignment: Alignment.Ringwraith,
            companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
            hand: [], siteDeck: [MINAS_MORGUL],
            cardsInPlay: withSiege ? siegeInPlay('p2', HILLMEN, BREE_MINION) : [],
          },
        ],
      });
      return { ...base, phaseState: makeSitePhase() };
    };

    const baseline = build(false);
    const baselineAttempt = firstFactionInfluenceAttempt(baseline, baseline.players[0].hand[0].instanceId);
    expect(baselineAttempt).toBeDefined();

    const sieged = build(true);
    const siegedAttempt = firstFactionInfluenceAttempt(sieged, sieged.players[0].hand[0].instanceId);
    expect(siegedAttempt).toBeDefined();
    expect(siegedAttempt!.need - baselineAttempt!.need).toBe(5);
  });

  // ─── Rules 6+7: additional automatic-attack ────────────────────────────────

  /** Site-phase state with a P1 minion company at Raider-hold, siege owned by `siegeOwner`. */
  function buildAutoAttackState(siegeOwner: 'p1' | 'p2') {
    const siege = siegeInPlay(siegeOwner, EASTERLINGS, RAIDER_HOLD);
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: RAIDER_HOLD, characters: [GORBAG] }],
          hand: [], siteDeck: [DOL_GULDUR],
          cardsInPlay: siegeOwner === 'p1' ? siege : [],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
          hand: [], siteDeck: [MINAS_MORGUL],
          cardsInPlay: siegeOwner === 'p2' ? siege : [],
        },
      ],
    });
    return setupAutoAttackStep({ ...base, phaseState: makeSitePhase() });
  }

  test('every version of the Border-hold gains a 5-strike/9-prowess attack of the faction\'s type', () => {
    // The opponent's siege augments PLAYER_1's own Raider-hold instance.
    const ready = buildAutoAttackState('p2');

    // First pass initiates Raider-hold's printed Men attack.
    const afterFirst = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(afterFirst.combat).toBeDefined();
    expect(afterFirst.combat!.creatureRace).toBe('man');
    expect(afterFirst.combat!.strikeProwess).toBe(7);

    // Second attack is the siege augmentation: Men (Easterlings are a Man
    // faction), 5 strikes, 9 prowess — a NORMAL attack against the company
    // of the siege controller's opponent.
    const betweenAttacks = { ...afterFirst, combat: null };
    const afterSecond = dispatch(betweenAttacks, { type: 'pass', player: PLAYER_1 });
    expect(afterSecond.combat).toBeDefined();
    expect(afterSecond.combat!.attackSource.type).toBe('automatic-attack');
    expect(afterSecond.combat!.creatureRace).toBe('man');
    expect(afterSecond.combat!.strikesTotal).toBe(5);
    expect(afterSecond.combat!.strikeProwess).toBe(9);
    expect(afterSecond.combat!.detainment).toBe(false);
  });

  test('the siege attack is DETAINMENT against the controller\'s own companies', () => {
    // PLAYER_1 owns the siege and enters the besieged Border-hold.
    const ready = buildAutoAttackState('p1');

    const afterFirst = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    const betweenAttacks = { ...afterFirst, combat: null };
    const afterSecond = dispatch(betweenAttacks, { type: 'pass', player: PLAYER_1 });
    expect(afterSecond.combat).toBeDefined();
    expect(afterSecond.combat!.strikesTotal).toBe(5);
    expect(afterSecond.combat!.strikeProwess).toBe(9);
    expect(afterSecond.combat!.detainment).toBe(true);
  });

  // ─── Rule 9: cleanup when the target faction leaves play ──────────────────

  test('siege is discarded and the Border-hold returns to the location deck when the faction is gone', () => {
    // The siege's target faction instance is absent from play (already
    // returned to hand / discarded). Any reduced action triggers the sweep.
    const siege = siegeInPlay('p1', EASTERLINGS, RAIDER_HOLD)
      .filter(c => c.definitionId !== EASTERLINGS); // faction gone
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
          hand: [], siteDeck: [MINAS_MORGUL],
          cardsInPlay: siege,
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
          hand: [], siteDeck: [MINAS_MORGUL],
        },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Host discarded to its owner; no siege cards remain in play.
    expect(after.players[0].cardsInPlay.some(c => c.definitionId === LONG_GRIEVOUS_SIEGE)).toBe(false);
    expect(after.players[0].discardPile.some(c => c.instanceId === ('p1-902' as CardInstanceId))).toBe(true);
    // The set-aside Border-hold card went back to the owner's location deck.
    expect(after.players[0].cardsInPlay.some(c => c.instanceId === ('p1-903' as CardInstanceId))).toBe(false);
    expect(after.players[0].siteDeck.some(s => s.instanceId === ('p1-903' as CardInstanceId))).toBe(true);
    expect(after.players[0].discardPile.some(c => c.instanceId === ('p1-903' as CardInstanceId))).toBe(false);
  });
});
