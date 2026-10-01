/**
 * @module as-57.test
 *
 * Card test: Tower Raided (as-57)
 * Type: hero-resource-event (permanent), alignment wizard, non-unique.
 * Marshalling points: 6 miscellaneous (while kept in play).
 *
 * Text:
 *   "Playable during the site phase on an untapped Shadow-hold [{S}] if your
 *    company there: bears an item worth at least 2 marshalling points,
 *    contains an untapped scout, and discards for no effect a Stolen Knowledge
 *    card it controls. Tap the site and discard the item. Company faces an
 *    attack: Orcs — 4 strikes with 8 prowess. By the end of the site phase,
 *    tap a scout in the company or discard this card. If this card is not
 *    discarded, all versions of this site are now Ruins & Lairs [{R}], and no
 *    factions are playable there. Discard this card when the site is
 *    discarded or returned to your location deck."
 *
 * Effects & engine support:
 * | # | Rule                                                  | Mechanism                                                                  |
 * |---|-------------------------------------------------------|----------------------------------------------------------------------------|
 * | 1 | during the site phase on a Shadow-hold                | play-target site `effectiveSiteType: shadow-hold` (site.ts)                |
 * | 2 | … an untapped Shadow-hold; tap the site               | play-flag untapped-site-required + tap-site-on-play                        |
 * | 3 | company contains an untapped scout; tap a scout       | play-target character (scout, untapped) — gates play and the keep          |
 * | 4 | bears an item worth ≥ 2 MP; discard the item          | play-condition discard-company-item (`item.marshallingPoints $gte 2`) →    |
 * |   |                                                       | `discardItemInstanceId`, discarded from its bearer on play                 |
 * | 5 | discards for no effect a Stolen Knowledge card        | play-condition discard-keyword-card `stolen-knowledge` →                   |
 * |   |                                                       | `discardCardInstanceId`                                                    |
 * | 6 | Company faces an attack: Orcs 4/8                     | trigger-attack-on-play, afterAttack move-to-mp-pile                        |
 * | 7 | tap a scout or discard this card                      | select-card-bearer keep restricted to untapped scouts; pass → discard      |
 * | 8 | all versions → Ruins & Lairs, no factions playable    | site-instance-transform (both roles R&L, noFactions, allVersions)          |
 * | 9 | discard when the site is discarded / returned         | transform `discardWithSite` → site-attached orphan sweep                   |
 *
 * The keep is offered immediately after the attack, which satisfies "by the
 * end of the site phase": the scout that taps must already be untapped then.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus,
  buildSitePhaseState, buildMinionSitePhaseState,
  resetMint, mint,
  viableActions, dispatch,
  playPermanentEventAndResolve, runCardTriggeredAttackCombat,
  findCharInstanceId, findItemInstanceId, addP1CardsInPlay,
  ARAGORN, BILBO, GIMLI, LEGOLAS, FARAMIR,
  GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, MORIA, LORIEN,
} from '../test-helpers.js';
import { Alignment, Phase, SiteType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, SiteCard,
  PlayPermanentEventAction, SelectCardBearerAction, PendingResolution, ResolutionId,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import { getEffectiveSiteType } from '../../engine/effective.js';

const TOWER_RAIDED = 'as-57' as CardDefinitionId;
const DARK_NUMBERS = 'dm-123' as CardDefinitionId;   // Stolen Knowledge, attached to a character
const BOOK_OF_MAZARBUL = 'tw-201' as CardDefinitionId; // 1 MP item — too cheap

const BANDIT_LAIR = 'tw-373' as CardDefinitionId;    // ruins-and-lairs — wrong site type
const MINION_MORIA = 'le-392' as CardDefinitionId;   // minion version of Moria (shadow-hold)
const HERO_GOBLIN_GATE = 'tw-398' as CardDefinitionId;
const MINION_GOBLIN_GATE = 'le-378' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // minion faction playable at Goblin-gate
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

/** A raid-ready company: Aragorn (scout) bears Glamdring (2 MP) and Dark Numbers (Stolen Knowledge). */
const RAIDERS = [{ defId: ARAGORN, items: [GLAMDRING, DARK_NUMBERS] }, GIMLI];

describe('Tower Raided (as-57)', () => {
  beforeEach(() => resetMint());

  // ── Effects 1–5: playability ──

  test('playable at an untapped Shadow-hold — one action naming the Stolen Knowledge card and the item', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: RAIDERS, hand: [TOWER_RAIDED] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event').map(ea => ea.action as PlayPermanentEventAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetSiteDefinitionId).toBe(MORIA);
    expect(actions[0].discardCardInstanceId).toBe(findItemInstanceId(state, RESOURCE_PLAYER, DARK_NUMBERS));
    expect(actions[0].discardItemInstanceId).toBe(findItemInstanceId(state, RESOURCE_PLAYER, GLAMDRING));
    // The keeping scout is chosen after the attack, not at play.
    expect(actions[0].targetCharacterId).toBeUndefined();
  });

  test('offers one action per item worth at least 2 MP; cheaper items are not offered', () => {
    const state = buildSitePhaseState({ site: MORIA, hand: [TOWER_RAIDED], characters: [
        { defId: ARAGORN, items: [GLAMDRING, DARK_NUMBERS] },
        { defId: GIMLI, items: [THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, BOOK_OF_MAZARBUL] },
      ] });
    const offeredItems = viableActions(state, PLAYER_1, 'play-permanent-event').map(ea => ea.action as PlayPermanentEventAction).map(a => a.discardItemInstanceId);
    expect(offeredItems).toHaveLength(2);
    expect(offeredItems).toContain(findItemInstanceId(state, RESOURCE_PLAYER, GLAMDRING));
    expect(offeredItems).toContain(findItemInstanceId(state, RESOURCE_PLAYER, THE_MITHRIL_COAT));
    expect(offeredItems).not.toContain(findItemInstanceId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE));
    expect(offeredItems).not.toContain(findItemInstanceId(state, RESOURCE_PLAYER, BOOK_OF_MAZARBUL));
  });

  test('NOT playable when the company bears no item worth at least 2 MP', () => {
    const state = buildSitePhaseState({ site: MORIA, hand: [TOWER_RAIDED], characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE, BOOK_OF_MAZARBUL, DARK_NUMBERS] }, GIMLI] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable when the company controls no Stolen Knowledge card', () => {
    const state = buildSitePhaseState({ site: MORIA, hand: [TOWER_RAIDED], characters: [{ defId: ARAGORN, items: [GLAMDRING] }, GIMLI] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable when the company contains no untapped scout', () => {
    const noScout = buildSitePhaseState({ site: MORIA, hand: [TOWER_RAIDED], characters: [{ defId: GIMLI, items: [GLAMDRING, DARK_NUMBERS] }, LEGOLAS] });
    expect(viableActions(noScout, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
    const tappedScout = buildSitePhaseState({ site: MORIA, hand: [TOWER_RAIDED], characters: [{ defId: ARAGORN, items: [GLAMDRING, DARK_NUMBERS], status: CardStatus.Tapped }, GIMLI] });
    expect(viableActions(tappedScout, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable at a tapped Shadow-hold', () => {
    expect(viableActions(buildSitePhaseState({ site: MORIA, characters: RAIDERS, hand: [TOWER_RAIDED], siteStatus: CardStatus.Tapped }), PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable at a non-Shadow-hold (Ruins & Lairs)', () => {
    expect(viableActions(buildSitePhaseState({ characters: RAIDERS, hand: [TOWER_RAIDED], site: BANDIT_LAIR }), PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Effects 2, 4, 5, 6: playing it ──

  test('playing discards the Stolen Knowledge card and the item, taps the site, and triggers Orcs 4/8', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: RAIDERS, hand: [TOWER_RAIDED] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event').map(ea => ea.action as PlayPermanentEventAction)[0];
    const cardId = action.cardInstanceId;
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, {
      targetSiteDefinitionId: action.targetSiteDefinitionId,
      discardCardInstanceId: action.discardCardInstanceId,
      discardItemInstanceId: action.discardItemInstanceId,
    });
    const p1 = after.players[RESOURCE_PLAYER];

    // Both discards left their bearer for the discard pile.
    expect(Object.values(p1.characters).flatMap(ch => ch.items.map(i => i.definitionId))).not.toContain(GLAMDRING);
    expect(Object.values(p1.characters).flatMap(ch => ch.items.map(i => i.definitionId))).not.toContain(DARK_NUMBERS);
    expect(p1.discardPile.some(c => c.instanceId === action.discardItemInstanceId)).toBe(true);
    expect(p1.discardPile.some(c => c.instanceId === action.discardCardInstanceId)).toBe(true);

    // "Tap the site."
    expect(p1.companies[0].currentSite!.status).toBe(CardStatus.Tapped);

    // The card is in play bound to the site, awaiting the attack's outcome.
    const inPlay = p1.cardsInPlay.find(c => c.instanceId === cardId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(MORIA);

    // "Company faces an attack: Orcs — 4 strikes with 8 prowess."
    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource.type).toBe('card-triggered-attack');
    expect(after.combat!.creatureRace).toBe('orc');
    expect(after.combat!.strikesTotal).toBe(4);
    expect(after.combat!.strikeProwess).toBe(8);
  });

  // ── Effect 7: tap a scout or discard this card ──

  test('after the attack only an untapped scout may tap to keep the card; keeping scores 6 MP', () => {
    const state = buildSitePhaseState({ site: MORIA, hand: [TOWER_RAIDED], characters: [
        { defId: ARAGORN, items: [GLAMDRING, DARK_NUMBERS] },
        GIMLI, LEGOLAS, FARAMIR, BILBO, 'tw-126' as CardDefinitionId, // Beorn — untapped non-scout
      ] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event').map(ea => ea.action as PlayPermanentEventAction)[0];
    const cardId = action.cardInstanceId;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, {
      targetSiteDefinitionId: action.targetSiteDefinitionId,
      discardCardInstanceId: action.discardCardInstanceId,
      discardItemInstanceId: action.discardItemInstanceId,
    });
    const afterCombat = runCardTriggeredAttackCombat(afterPlay, [
      { characterDefId: ARAGORN, roll: 12 },
      { characterDefId: GIMLI, roll: 12 },
      { characterDefId: LEGOLAS, roll: 12 },
      { characterDefId: FARAMIR, roll: 12 },
    ]);
    expect(afterCombat.combat).toBeNull();

    const bilboId = findCharInstanceId(afterCombat, RESOURCE_PLAYER, BILBO);
    const offered = viableActions(afterCombat, PLAYER_1, 'select-card-bearer')
      .map(ea => (ea.action as SelectCardBearerAction).characterId);
    // Bilbo is the only untapped scout: Aragorn tapped facing a strike, Beorn is no scout.
    expect(offered).toEqual([bilboId]);

    const afterKeep = recomputeDerived(dispatch(afterCombat, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId: cardId, characterId: bilboId,
    }));
    const p1 = afterKeep.players[RESOURCE_PLAYER];
    expect(p1.characters[bilboId].status).toBe(CardStatus.Tapped);
    const kept = p1.cardsInPlay.find(c => c.instanceId === cardId);
    expect(kept).toBeDefined();
    expect(kept!.pendingTriggerAttack).toBeUndefined();
    expect(kept!.attachedToSite).toBe(MORIA);
    // 6 misc MP gained; Dark Numbers' 1 misc MP went with the discard.
    expect(p1.marshallingPoints.misc).toBe(state.players[RESOURCE_PLAYER].marshallingPoints.misc - 1 + 6);
  });

  test('declining to tap a scout discards the card', () => {
    const base = buildSitePhaseState({ site: MORIA, characters: [BILBO], hand: [] });
    const cardInstanceId = mint();
    const seeded: GameState = recomputeDerived({
      ...addP1CardsInPlay(base, [
        { instanceId: cardInstanceId, definitionId: TOWER_RAIDED, status: CardStatus.Untapped, attachedToSite: MORIA, pendingTriggerAttack: true },
      ]),
      pendingResolutions: [
        {
          id: 'tr-keep' as ResolutionId,
          source: cardInstanceId,
          actor: PLAYER_1,
          scope: { kind: 'phase', phase: Phase.Site },
          kind: {
            type: 'select-card-bearer',
            cardInstanceId,
            companyId: base.players[RESOURCE_PLAYER].companies[0].id,
            mode: 'move-to-mp-pile',
          },
        } satisfies PendingResolution,
      ],
    });
    const afterPass = dispatch(seeded, { type: 'pass', player: PLAYER_1 });
    const p1 = afterPass.players[RESOURCE_PLAYER];
    expect(p1.cardsInPlay.some(c => c.instanceId === cardInstanceId)).toBe(false);
    expect(p1.discardPile.some(c => c.instanceId === cardInstanceId)).toBe(true);
  });

  // ── Effect 8: all versions of the site become Ruins & Lairs ──

  test('once kept, every version of the site is a Ruins & Lairs', () => {
    const keptBase = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [] });
    const cardInstanceId = mint(); // the kept Tower Raided
    const state = recomputeDerived(addP1CardsInPlay(keptBase, [
      { instanceId: cardInstanceId, definitionId: TOWER_RAIDED, status: CardStatus.Untapped, attachedToSite: MORIA },
    ]));
    const heroMoria = state.cardPool[MORIA] as SiteCard;
    const minionMoria = state.cardPool[MINION_MORIA] as SiteCard;
    const associated = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    expect(getEffectiveSiteType(state, MORIA, heroMoria.siteType, associated)).toBe(SiteType.RuinsAndLairs);
    // Another copy of the same printing.
    expect(getEffectiveSiteType(state, MORIA, heroMoria.siteType, mint())).toBe(SiteType.RuinsAndLairs);
    // The minion printing of Moria — a different definition sharing the name.
    expect(getEffectiveSiteType(state, MINION_MORIA, minionMoria.siteType, mint())).toBe(SiteType.RuinsAndLairs);
    // An unrelated Shadow-hold is untouched.
    const goblinGate = state.cardPool[HERO_GOBLIN_GATE] as SiteCard;
    expect(getEffectiveSiteType(state, HERO_GOBLIN_GATE, goblinGate.siteType, mint())).toBe(SiteType.ShadowHold);
  });

  test('the site is unchanged while the card still awaits its attack (not yet kept)', () => {
    const base = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [] });
    const state = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: TOWER_RAIDED, status: CardStatus.Untapped, attachedToSite: MORIA, pendingTriggerAttack: true },
    ]));
    const heroMoria = state.cardPool[MORIA] as SiteCard;
    const associated = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    expect(getEffectiveSiteType(state, MORIA, heroMoria.siteType, associated)).toBe(SiteType.ShadowHold);
  });

  test('a raided site is no longer a Shadow-hold, so another copy cannot be played there', () => {
    const base = buildSitePhaseState({ site: MORIA, characters: RAIDERS, hand: [TOWER_RAIDED] });
    expect(viableActions(base, PLAYER_1, 'play-permanent-event').map(ea => ea.action as PlayPermanentEventAction)).toHaveLength(1);
    const raided = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: TOWER_RAIDED, status: CardStatus.Untapped, attachedToSite: MORIA },
    ]));
    expect(viableActions(raided, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Effect 8: no factions are playable at any version of the site ──

  test('no faction is playable at any version of the raided site', () => {
    // Control: a minion player can play Goblins of Goblin-gate at the minion Goblin-gate.
    const control = buildMinionSitePhaseState({
      site: MINION_GOBLIN_GATE, characters: [GORBAG, SHAGRAT], hand: [GOBLINS_OF_GOBLIN_GATE],
      opponent: { alignment: Alignment.Wizard, site: LORIEN, characters: [ARAGORN] },
    });
    expect(viableActions(control, PLAYER_1, 'influence-attempt').length).toBeGreaterThan(0);

    // The hero opponent's Tower Raided kept on the hero Goblin-gate bars it.
    const raided: GameState = recomputeDerived({
      ...control,
      players: [
        control.players[RESOURCE_PLAYER],
        {
          ...control.players[HAZARD_PLAYER],
          cardsInPlay: [
            ...control.players[HAZARD_PLAYER].cardsInPlay,
            { instanceId: `${PLAYER_2 as string}-900` as CardInstanceId, definitionId: TOWER_RAIDED, status: CardStatus.Untapped, attachedToSite: HERO_GOBLIN_GATE },
          ],
        },
      ] as typeof control.players,
    });
    expect(viableActions(raided, PLAYER_1, 'influence-attempt')).toHaveLength(0);
  });

  // ── Effect 9: discarded with its site ──

  test('discarded once its site is discarded or returned to the location deck', () => {
    const keptBase = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [] });
    const cardInstanceId = mint();
    const state = recomputeDerived(addP1CardsInPlay(keptBase, [
      { instanceId: cardInstanceId, definitionId: TOWER_RAIDED, status: CardStatus.Untapped, attachedToSite: MORIA },
    ]));
    const vacated: GameState = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], companies: [] },
        state.players[HAZARD_PLAYER],
      ] as typeof state.players,
    };
    const swept = discardOrphanedSiteAttachedEvents(vacated);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardInstanceId)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstanceId)).toBe(true);
  });
});
