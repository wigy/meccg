/**
 * @module ba-74.test
 *
 * Card test: Roots of the Earth (ba-74)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase on an Under-deeps site
 *    normally a Ruins & Lairs [{R}] if The Balrog is there. The Balrog's company
 *    faces an attack (Drake — 2 strikes with 13 prowess). Following the attack,
 *    tap The Balrog or discard this card. The associated site is a Darkhaven
 *    [{H}] and loses all automatic-attacks. All other versions of the site become
 *    a Shadow-hold [{S}] and gain an additional automatic-attack: Orcs — 5
 *    strikes with 9 prowess. If Breach the Hold is on the same site, this card
 *    gives 3 marshalling points. This site is never discarded or returned to its
 *    location deck. Cannot be duplicated on a given site."
 *
 * Effects:
 *   1. play-target site  { under-deeps AND ruins-and-lairs }          — site.ts filter
 *   2. play-target character { name: The Balrog }                     — site.ts / keep gate
 *   3. duplication-limit scope site                                   — site.ts
 *   4. trigger-attack-on-play [{ Drake 2/13 }] move-to-mp-pile        — chain/combat-finalize/pending
 *   5. site-instance-transform (associated → Darkhaven, no attacks;
 *      others → Shadow-hold + Orcs 5/9)                               — effective.ts / manifestations.ts
 *   6. conditional-mp (+2 when Breach the Hold on the same site)      — recompute-derived.ts
 *
 * The card is non-unique, worth 1 misc MP (3 with Breach the Hold), permanent
 * (its bound Under-deeps site is never discarded/returned), and limited to one
 * copy per site.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  PLAYER_2,
  RESOURCE_PLAYER,
  HAZARD_PLAYER,
  Alignment,
  CardStatus,
  Phase,
  buildTestState,
  buildMinionSitePhaseState,
  resetMint, mint,
  viableActions,
  playPermanentEventAndResolve,
  dispatch, runActions, companyIdAt, findCharInstanceId, addP1CardsInPlay,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayPermanentEventAction, SelectCardBearerAction,
  PendingResolution, ResolutionId, SiteCard,
} from '../../index.js';
import { SiteType } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';

const ROOTS = 'ba-74' as CardDefinitionId;
const BREACH_THE_HOLD = 'ba-50' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;          // balrog avatar
const LIEUTENANT = 'le-21' as CardDefinitionId;         // Lieutenant of Dol Guldur — troll leader (non-Balrog)

const UNDER_GROTTOS = 'ba-101' as CardDefinitionId;     // Under-deeps, Ruins & Lairs — the target
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;      // plain (non-Under-deeps) Ruins & Lairs
const UNDER_LEAS = 'as-167' as CardDefinitionId;        // Under-deeps Shadow-hold — wrong printed type
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // haven, for permanence relocation

/**
 * Build a site-phase state with Roots of the Earth kept in play (the
 * `move-to-mp-pile` post-attack state): the card sits in the resource player's
 * cardsInPlay bound to the current Under-deeps site (`attachedToSite`), with the
 * pending flag already cleared so its site transformation is active.
 */
function buildKept(opts: { site?: CardDefinitionId; withBreach?: boolean } = {}): {
  state: GameState;
  rootsInstanceId: CardInstanceId;
} {
  const site = opts.site ?? UNDER_GROTTOS;
  const base = buildMinionSitePhaseState({ site, characters: [THE_BALROG], hand: [] });
  const rootsInstanceId = mint();
  const extra = [
    { instanceId: rootsInstanceId, definitionId: ROOTS, status: CardStatus.Untapped, attachedToSite: site },
    ...(opts.withBreach
      ? [{ instanceId: mint(), definitionId: BREACH_THE_HOLD, status: CardStatus.Untapped, attachedToSite: site }]
      : []),
  ];
  return { state: recomputeDerived(addP1CardsInPlay(base, extra)), rootsInstanceId };
}

/**
 * Seed a select-card-bearer pending resolution for a kept Roots of the Earth,
 * with the card still flagged `pendingTriggerAttack` (mid-flow, right after its
 * Drake attack). Both company members are untapped so the Balrog-only keep
 * restriction is observable.
 */
function seedKeep(): { state: GameState; rootsInstanceId: CardInstanceId } {
  const base = buildMinionSitePhaseState({
    site: UNDER_GROTTOS, characters: [THE_BALROG, LIEUTENANT], hand: [],
  });
  const companyId = companyIdAt(base, RESOURCE_PLAYER);
  const rootsInstanceId = mint();
  const withCard: GameState = {
    ...base,
    players: [
      {
        ...base.players[RESOURCE_PLAYER],
        cardsInPlay: [
          ...base.players[RESOURCE_PLAYER].cardsInPlay,
          { instanceId: rootsInstanceId, definitionId: ROOTS, status: CardStatus.Untapped, attachedToSite: UNDER_GROTTOS, pendingTriggerAttack: true },
        ],
      },
      base.players[1],
    ] as typeof base.players,
    pendingResolutions: [
      {
        id: 'roots-bearer' as ResolutionId,
        source: rootsInstanceId,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: { type: 'select-card-bearer', cardInstanceId: rootsInstanceId, companyId, mode: 'move-to-mp-pile' },
      } satisfies PendingResolution,
    ],
  };
  return { state: recomputeDerived(withCard), rootsInstanceId };
}

describe('Roots of the Earth (ba-74)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1/2: playability keying ──

  test('playable at an Under-deeps Ruins & Lairs with The Balrog present', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GROTTOS, characters: [THE_BALROG], hand: [ROOTS] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    // Bearer (the keep) chosen post-attack → no targetCharacterId embedded at play.
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBeUndefined();
    expect((actions[0].action as PlayPermanentEventAction).targetSiteDefinitionId).toBe(UNDER_GROTTOS);
  });

  test('NOT playable at a plain (non-Under-deeps) Ruins & Lairs', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, characters: [THE_BALROG], hand: [ROOTS] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at an Under-deeps site that is not normally a Ruins & Lairs', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_LEAS, characters: [THE_BALROG], hand: [ROOTS] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when The Balrog is not in the company', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GROTTOS, characters: [LIEUTENANT], hand: [ROOTS] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 4: the triggered Drake attack ──

  test('playing it triggers a Drake attack (2 strikes @ 13 prowess) on the company', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GROTTOS, characters: [THE_BALROG], hand: [ROOTS] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId, undefined, {
      targetSiteDefinitionId: UNDER_GROTTOS,
    });
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.creatureRace).toBe('drake');
    expect(afterPlay.combat!.strikesTotal).toBe(2);
    expect(afterPlay.combat!.strikeProwess).toBe(13);
  });

  // ── Effect 2/4: the keep is restricted to The Balrog ──

  test('select-card-bearer offers ONLY The Balrog, never a company follower', () => {
    const { state } = seedKeep();
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);
    const offered = viableActions(state, PLAYER_1, 'select-card-bearer')
      .map(ea => (ea.action as SelectCardBearerAction).characterId);
    expect(offered).toContain(balrogId);
    expect(offered).not.toContain(lieutenantId);
    expect(viableActions(state, PLAYER_1, 'pass').length).toBeGreaterThan(0);
  });

  test('keeping taps The Balrog, leaves the card bound to the site, and clears the pending flag', () => {
    const { state, rootsInstanceId } = seedKeep();
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = recomputeDerived(dispatch(state, {
      type: 'select-card-bearer', player: PLAYER_1, cardInstanceId: rootsInstanceId, characterId: balrogId,
    }));

    expect(afterKeep.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);
    const kept = afterKeep.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === rootsInstanceId);
    expect(kept).toBeDefined();
    expect(kept!.pendingTriggerAttack).toBeUndefined();
    expect(kept!.attachedToSite).toBe(UNDER_GROTTOS);
  });

  test('passing (declining the keep) discards the card', () => {
    const { state, rootsInstanceId } = seedKeep();
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === rootsInstanceId)).toBe(false);
    expect(afterPass.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === rootsInstanceId)).toBe(true);
  });

  // ── Effect 5: the associated site becomes a Darkhaven and loses all attacks ──

  test('the associated site reads as a Darkhaven and has no automatic-attacks', () => {
    const { state } = buildKept();
    const siteDef = state.cardPool[UNDER_GROTTOS] as SiteCard;
    const associatedInstanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    expect(getEffectiveSiteType(state, UNDER_GROTTOS, siteDef.siteType, associatedInstanceId)).toBe(SiteType.Haven);
    expect(getActiveAutoAttacks(state, siteDef, associatedInstanceId)).toHaveLength(0);
  });

  // ── Effect 5: all other versions become a Shadow-hold with an Orcs 5/9 attack ──

  test('another version of the site reads as a Shadow-hold and gains an Orcs 5/9 attack', () => {
    const { state } = buildKept();
    const siteDef = state.cardPool[UNDER_GROTTOS] as SiteCard;
    const otherInstanceId = mint(); // an instance that is NOT the controller's current site

    expect(getEffectiveSiteType(state, UNDER_GROTTOS, siteDef.siteType, otherInstanceId)).toBe(SiteType.ShadowHold);
    const attacks = getActiveAutoAttacks(state, siteDef, otherInstanceId);
    const orc = attacks.find(a => a.creatureType === 'Orcs');
    expect(orc).toBeDefined();
    expect(orc!.strikes).toBe(5);
    expect(orc!.prowess).toBe(9);
  });

  test('the transformation is dormant while the card is still pendingTriggerAttack', () => {
    const { state } = seedKeep(); // card is pendingTriggerAttack, not yet kept
    const siteDef = state.cardPool[UNDER_GROTTOS] as SiteCard;
    const associatedInstanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    // Printed type still applies; the Darkhaven conversion has not activated.
    expect(getEffectiveSiteType(state, UNDER_GROTTOS, siteDef.siteType, associatedInstanceId)).toBe(SiteType.RuinsAndLairs);
  });

  // ── Effect 5: the Darkhaven heals a wounded Balrog during the untap phase ──

  test('a wounded Balrog at the associated Darkhaven heals during untap', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GROTTOS, characters: [THE_BALROG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const balrogId = findCharInstanceId(base, RESOURCE_PLAYER, THE_BALROG);
    // Wound the Balrog (inverted) and keep Roots bound to his site.
    const wounded: GameState = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          characters: {
            ...base.players[RESOURCE_PLAYER].characters,
            [balrogId]: { ...base.players[RESOURCE_PLAYER].characters[balrogId], status: CardStatus.Inverted },
          },
        },
        base.players[1],
      ] as typeof base.players,
    };
    const withRoots = recomputeDerived(addP1CardsInPlay(wounded, [
      { instanceId: mint(), definitionId: ROOTS, status: CardStatus.Untapped, attachedToSite: UNDER_GROTTOS },
    ]));

    const afterUntap = runActions(withRoots, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);
    // Wounded (inverted) → healed one step to tapped at the Darkhaven.
    expect(afterUntap.players[RESOURCE_PLAYER].characters[balrogId].status).toBe(CardStatus.Tapped);
  });

  // ── Effect 6: conditional marshalling points ──

  test('the kept card gives 1 misc MP normally', () => {
    const { state } = buildKept();
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  test('the kept card gives 3 misc MP when Breach the Hold is on the same site', () => {
    const { state } = buildKept({ withBreach: true });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });

  // ── permanence: the bound site is never swept ──

  test('the kept card is exempt from the orphan sweep while its site is unoccupied', () => {
    const { state, rootsInstanceId } = buildKept();
    // Vacate the Under-deeps site: no company occupies it any longer.
    const vacated: GameState = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], companies: [] },
        state.players[HAZARD_PLAYER],
      ] as typeof state.players,
    };
    const swept = discardOrphanedSiteAttachedEvents(vacated);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === rootsInstanceId)).toBe(true);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === rootsInstanceId)).toBe(false);
  });

  // ── duplication: one copy per site ──

  test('a second copy is NOT playable at a site that already carries one', () => {
    const base = buildMinionSitePhaseState({ site: UNDER_GROTTOS, characters: [THE_BALROG], hand: [ROOTS] });
    const withCopy = recomputeDerived(addP1CardsInPlay(base, [
      { instanceId: mint(), definitionId: ROOTS, status: CardStatus.Untapped, attachedToSite: UNDER_GROTTOS },
    ]));
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });
});
