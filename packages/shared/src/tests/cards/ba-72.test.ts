/**
 * @module ba-72.test
 *
 * Card test: People Diminished (ba-72)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase on an untapped Free-hold
 *    [{F}] or Border-hold [{B}]. Tap the site. The company faces 3 attacks (Men
 *    — 4 strikes with 8 prowess, 3 strikes with 10 prowess, 2 strikes with 12
 *    prowess). Following the attacks, tap a character or discard this card. If
 *    this card is not discarded, discard all unique factions playable at the
 *    site. -5 to each attempt against any faction at any version of this site.
 *    This site is never discarded and never untaps for you. Cannot be
 *    duplicated on a given site."
 *
 * Effects:
 *   1. play-target site { siteType in [free-hold, border-hold] }        — site.ts filter
 *   2. play-flag untapped-site-required                                 — site.ts
 *   3. play-flag tap-site-on-play                                       — chain-reducer.ts
 *   4. duplication-limit scope site                                     — site.ts
 *   5. trigger-attack-on-play [Men 4/8, 3/10, 2/12] move-to-mp-pile,
 *      discardUniqueFactionsAtSite                                      — chain/combat-finalize/pending
 *   6. site-lock (factionInfluenceModifier -5)                          — the three ongoing rules:
 *        a. permanence ("never discarded")            — cardKeepsBoundSitePermanent
 *        b. never untaps for the owner (re-placed tapped) — mh-hazard-play.ts step 8
 *        c. -5 to every faction-influence attempt at the site — site.ts influence path
 *
 * The card is non-unique, worth 2 misc MP (kept in the marshalling-point pile),
 * and — unlike Invade Their Domain (ba-64) — is permanent, so it is NOT swept
 * with its site.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, Phase,
  buildMinionSitePhaseState, buildTestState, makeMHState,
  resetMint, mint,
  viableActions, dispatch,
  playPermanentEventAndResolve,
  findCharInstanceId, findHandCardId, companyIdAt,
  addP1CardsInPlay,
} from '../test-helpers.js';
import { computeLegalActions, Alignment, RegionType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayerId,
  PlayPermanentEventAction, SelectCardBearerAction, InfluenceAttemptAction,
  PendingResolution, ResolutionId, CardInPlay,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';

const PEOPLE_DIMINISHED = 'ba-72' as CardDefinitionId;

// Sites (minion / LE pool).
const RAIDER_HOLD = 'le-399' as CardDefinitionId;      // border-hold; Balchoth playable here
const EDORAS = 'le-372' as CardDefinitionId;           // free-hold
const SARN = 'le-401' as CardDefinitionId;             // shadow-hold — wrong site type
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // haven — wrong site type
const ETTENMOORS = 'le-373' as CardDefinitionId;       // ruins-and-lairs — movement origin

// Non-Balrog minion characters.
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;

// A unique minion faction playable at Raider-hold (influence # 9).
const BALCHOTH = 'le-260' as CardDefinitionId;
// A unique minion faction playable at a DIFFERENT hold (Southron Oasis).
const SOUTHRONS = 'le-287' as CardDefinitionId;

/**
 * Seed a select-card-bearer pending resolution for People Diminished right after
 * its Man attacks: the card sits in the Balrog player's cardsInPlay flagged
 * `pendingTriggerAttack`, the members untapped, and the pending carries
 * `move-to-mp-pile` + `discardUniqueFactionsAtSite`. `factions` are seeded into
 * the named owner's cardsInPlay so the keep branch can act on them.
 */
function seedKeep(
  site: CardDefinitionId,
  factions: Array<{ defId: CardDefinitionId; owner: PlayerId; instanceId: CardInstanceId }> = [],
): { state: GameState; cardInstanceId: CardInstanceId } {
  const base = buildMinionSitePhaseState({ site, characters: [GORBAG, SHAGRAT], hand: [] });
  const companyId = companyIdAt(base, RESOURCE_PLAYER);
  const cardInstanceId = mint();
  const p1Factions: CardInPlay[] = factions
    .filter(f => f.owner === PLAYER_1)
    .map(f => ({ instanceId: f.instanceId, definitionId: f.defId, status: CardStatus.Untapped }));
  const p2Factions: CardInPlay[] = factions
    .filter(f => f.owner !== PLAYER_1)
    .map(f => ({ instanceId: f.instanceId, definitionId: f.defId, status: CardStatus.Untapped }));
  const withCard: GameState = {
    ...base,
    players: [
      {
        ...base.players[RESOURCE_PLAYER],
        cardsInPlay: [
          ...base.players[RESOURCE_PLAYER].cardsInPlay,
          { instanceId: cardInstanceId, definitionId: PEOPLE_DIMINISHED, status: CardStatus.Untapped, attachedToSite: site, pendingTriggerAttack: true },
          ...p1Factions,
        ],
      },
      {
        ...base.players[HAZARD_PLAYER],
        cardsInPlay: [...base.players[HAZARD_PLAYER].cardsInPlay, ...p2Factions],
      },
    ] as typeof base.players,
    pendingResolutions: [
      {
        id: 'pd-bearer' as ResolutionId,
        source: cardInstanceId,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: {
          type: 'select-card-bearer',
          cardInstanceId,
          companyId,
          mode: 'move-to-mp-pile',
          discardUniqueFactionsAtSite: true,
        },
      } satisfies PendingResolution,
    ],
  };
  return { state: recomputeDerived(withCard), cardInstanceId };
}

describe('People Diminished (ba-72)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1/2/3: playability keying ──

  test('playable at an untapped Border-hold', () => {
    const state = buildMinionSitePhaseState({ site: RAIDER_HOLD, characters: [GORBAG], hand: [PEOPLE_DIMINISHED] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    // Bearer (the keep) chosen post-attack → no targetCharacterId embedded at play.
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBeUndefined();
    expect((actions[0].action as PlayPermanentEventAction).targetSiteDefinitionId).toBe(RAIDER_HOLD);
  });

  test('playable at an untapped Free-hold', () => {
    const state = buildMinionSitePhaseState({ site: EDORAS, characters: [GORBAG], hand: [PEOPLE_DIMINISHED] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  test('NOT playable when the site is already tapped (untapped-site-required)', () => {
    const state = buildMinionSitePhaseState({
      site: RAIDER_HOLD, characters: [GORBAG], hand: [PEOPLE_DIMINISHED], siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a Shadow-hold', () => {
    const state = buildMinionSitePhaseState({ site: SARN, characters: [GORBAG], hand: [PEOPLE_DIMINISHED] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a haven', () => {
    const state = buildMinionSitePhaseState({ site: MINAS_MORGUL, characters: [GORBAG], hand: [PEOPLE_DIMINISHED] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 3 (cost) + Effect 5: tap the site, attach to the site, trigger attacks ──

  test('playing it taps the site, binds the card to the site, and triggers the first Man attack (4 strikes @ 8)', () => {
    const state = buildMinionSitePhaseState({ site: RAIDER_HOLD, characters: [GORBAG, SHAGRAT], hand: [PEOPLE_DIMINISHED] });
    const cardId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, { targetSiteDefinitionId: RAIDER_HOLD });

    // The site is tapped ("Tap the site").
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    // The card is in play, bound to the site definition.
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === PEOPLE_DIMINISHED);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(RAIDER_HOLD);
    // The first of three Man attacks is live; two more are queued.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.attackSource.type).toBe('card-triggered-attack');
    if (after.combat!.attackSource.type === 'card-triggered-attack') {
      expect(after.combat!.attackSource.remainingAttacks?.length).toBe(2);
    }
  });

  // ── Effect 5: "tap a character or discard this card" — the keep/discard choice ──

  test('select-card-bearer offers any untapped company character as the keep target', () => {
    const { state } = seedKeep(RAIDER_HOLD);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const shagratId = findCharInstanceId(state, RESOURCE_PLAYER, SHAGRAT);
    const offered = viableActions(state, PLAYER_1, 'select-card-bearer')
      .map(ea => (ea.action as SelectCardBearerAction).characterId);
    expect(offered).toContain(gorbagId);
    expect(offered).toContain(shagratId);
  });

  test('keeping taps the chosen character and leaves the card bound to the site (move-to-mp-pile)', () => {
    const { state, cardInstanceId } = seedKeep(RAIDER_HOLD);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const afterKeep = recomputeDerived(dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: gorbagId,
    }));
    expect(afterKeep.players[RESOURCE_PLAYER].characters[gorbagId].status).toBe(CardStatus.Tapped);
    const kept = afterKeep.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cardInstanceId);
    expect(kept).toBeDefined();
    expect(kept!.pendingTriggerAttack).toBeUndefined();
    expect(kept!.attachedToSite).toBe(RAIDER_HOLD);
  });

  test('passing (declining the keep) discards the card', () => {
    const { state, cardInstanceId } = seedKeep(RAIDER_HOLD);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardInstanceId)).toBe(false);
    expect(afterPass.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstanceId)).toBe(true);
  });

  // ── Effect 5: discard all unique factions playable at the site on keep ──

  test('keeping discards a unique faction (either player) playable at the site', () => {
    const factionId = 'p2-260' as CardInstanceId; // opponent's Balchoth
    const { state, cardInstanceId } = seedKeep(RAIDER_HOLD, [
      { defId: BALCHOTH, owner: PLAYER_2, instanceId: factionId },
    ]);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const afterKeep = dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: gorbagId,
    });
    expect(afterKeep.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(afterKeep.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === factionId)).toBe(true);
  });

  test('a unique faction playable at a DIFFERENT site is NOT discarded', () => {
    const factionId = `${PLAYER_1}-287` as CardInstanceId; // Southrons — playable at Southron Oasis, not Raider-hold
    const { state, cardInstanceId } = seedKeep(RAIDER_HOLD, [
      { defId: SOUTHRONS, owner: PLAYER_1, instanceId: factionId },
    ]);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const afterKeep = dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: gorbagId,
    });
    expect(afterKeep.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(true);
  });

  test('declining the keep does NOT discard factions', () => {
    const factionId = 'p2-260' as CardInstanceId;
    const { state } = seedKeep(RAIDER_HOLD, [
      { defId: BALCHOTH, owner: PLAYER_2, instanceId: factionId },
    ]);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(true);
  });

  // ── Effect 6c: -5 to each faction-influence attempt at the site ──

  test('a bound copy raises every faction-influence need at the site by 5', () => {
    const base = buildMinionSitePhaseState({
      site: RAIDER_HOLD, characters: [ORC_CAPTAIN], hand: [BALCHOTH],
    });
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
    const factionId = findHandCardId(base, RESOURCE_PLAYER, BALCHOTH);

    const needBefore = (computeLegalActions(base, PLAYER_1)
      .map(a => a.action)
      .find((a): a is InfluenceAttemptAction =>
        a.type === 'influence-attempt'
        && a.influencingCharacterId === orcId
        && a.factionInstanceId === factionId))?.need;
    expect(needBefore).toBeDefined();

    // Bind a kept People Diminished to the site; the -5 raises the required roll.
    const withLock = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: PEOPLE_DIMINISHED, status: CardStatus.Untapped, attachedToSite: RAIDER_HOLD },
    ]));
    const needAfter = (computeLegalActions(withLock, PLAYER_1)
      .map(a => a.action)
      .find((a): a is InfluenceAttemptAction =>
        a.type === 'influence-attempt'
        && a.influencingCharacterId === orcId
        && a.factionInstanceId === factionId))?.need;
    expect(needAfter).toBeDefined();
    expect(needAfter).toBe(needBefore! + 5);
  });

  test('a copy bound to a DIFFERENT site does not affect influence at this site', () => {
    const base = buildMinionSitePhaseState({
      site: RAIDER_HOLD, characters: [ORC_CAPTAIN], hand: [BALCHOTH],
    });
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);

    const needBefore = (computeLegalActions(base, PLAYER_1)
      .map(a => a.action)
      .find((a): a is InfluenceAttemptAction =>
        a.type === 'influence-attempt' && a.influencingCharacterId === orcId))?.need;

    const withLock = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: PEOPLE_DIMINISHED, status: CardStatus.Untapped, attachedToSite: EDORAS },
    ]));
    const needAfter = (computeLegalActions(withLock, PLAYER_1)
      .map(a => a.action)
      .find((a): a is InfluenceAttemptAction =>
        a.type === 'influence-attempt' && a.influencingCharacterId === orcId))?.need;
    expect(needAfter).toBe(needBefore);
  });

  test('the penalty is suppressed while the card is still resolving its attacks (pendingTriggerAttack)', () => {
    const base = buildMinionSitePhaseState({
      site: RAIDER_HOLD, characters: [ORC_CAPTAIN], hand: [BALCHOTH],
    });
    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_CAPTAIN);
    const needBefore = (computeLegalActions(base, PLAYER_1)
      .map(a => a.action)
      .find((a): a is InfluenceAttemptAction =>
        a.type === 'influence-attempt' && a.influencingCharacterId === orcId))?.need;

    const pending = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: PEOPLE_DIMINISHED, status: CardStatus.Untapped, attachedToSite: RAIDER_HOLD, pendingTriggerAttack: true },
    ]));
    const needAfter = (computeLegalActions(pending, PLAYER_1)
      .map(a => a.action)
      .find((a): a is InfluenceAttemptAction =>
        a.type === 'influence-attempt' && a.influencingCharacterId === orcId))?.need;
    expect(needAfter).toBe(needBefore);
  });

  // ── Effect 6a: permanence — "This site is never discarded" ──

  test('the bound card is exempt from the site-attached orphan sweep while the site is unoccupied', () => {
    const base = buildMinionSitePhaseState({ site: RAIDER_HOLD, characters: [GORBAG], hand: [] });
    const withCard = addP1CardsInPlay({
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], companies: [{ ...base.players[RESOURCE_PLAYER].companies[0], currentSite: null }] },
        base.players[1],
      ] as typeof base.players,
    }, [{ instanceId: mint(), definitionId: PEOPLE_DIMINISHED, status: CardStatus.Untapped, attachedToSite: RAIDER_HOLD }]);

    const swept = discardOrphanedSiteAttachedEvents(withCard);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PEOPLE_DIMINISHED)).toBe(true);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === PEOPLE_DIMINISHED)).toBe(false);
  });

  // ── Effect 6b: never untaps for the owner — re-entering the site arrives tapped ──

  test('when the owner re-enters the bound site definition, it arrives tapped (never untaps for you)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ETTENMOORS, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const destInstance = mint();
    const moving: GameState = {
      ...base,
      phaseState: makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Border] }),
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{
            ...base.players[RESOURCE_PLAYER].companies[0],
            siteCardOwned: true,
            destinationSite: { instanceId: destInstance, definitionId: RAIDER_HOLD, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
    };

    // Baseline: no site-lock — the destination arrives untapped.
    const baseArrived = dispatch(dispatch(moving, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const baseSite = baseArrived.players[RESOURCE_PLAYER].companies[0].currentSite!;
    expect(baseSite.definitionId).toBe(RAIDER_HOLD);
    expect(baseSite.status).toBe(CardStatus.Untapped);

    // With the owner's site-lock bound to Raider-hold — the destination arrives tapped.
    const withLock = addP1CardsInPlay(moving, [
      { instanceId: mint(), definitionId: PEOPLE_DIMINISHED, status: CardStatus.Untapped, attachedToSite: RAIDER_HOLD },
    ]);
    const lockedArrived = dispatch(dispatch(withLock, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const lockedSite = lockedArrived.players[RESOURCE_PLAYER].companies[0].currentSite!;
    expect(lockedSite.definitionId).toBe(RAIDER_HOLD);
    expect(lockedSite.status).toBe(CardStatus.Tapped);
  });

  // ── duplication: one copy per site ──

  test('a second copy is NOT playable at a site that already carries one', () => {
    const base = buildMinionSitePhaseState({ site: RAIDER_HOLD, characters: [GORBAG], hand: [PEOPLE_DIMINISHED] });
    const withCopy = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: PEOPLE_DIMINISHED, status: CardStatus.Untapped, attachedToSite: RAIDER_HOLD },
    ]));
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });
});
