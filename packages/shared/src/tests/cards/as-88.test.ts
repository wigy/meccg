/**
 * @module as-88.test
 *
 * Card test: Hold Rebuilt and Repaired (as-88)
 * Type: minion-resource-event (permanent) · alignment: ringwraith
 * Marshalling points: 0
 *
 * Card text:
 *   "Playable during the site phase on a non-Dragon's lair, non-Under-deeps
 *    Ruins & Lairs [{R}]. The site becomes a Shadow-hold [{S}] and all
 *    automatic-attacks become detainment. Discard this card when the site is
 *    discarded or returned to its location deck."
 *
 * Modelled as a permanent event bound to the targeted site (`play-target`
 * target `site`, filtered to Ruins & Lairs that are neither a Dragon's lair —
 * `lairOf` present — nor an Under-deeps site — `adjacentSites` present). On
 * entering play it adds two `until-cleared` constraints filtered by the site's
 * definition id:
 *   - a `site.type` override → Shadow-hold (honored by detainment keying,
 *     movement keying, faction/ally playability, and the haven/untap checks);
 *   - an `auto-attack.detainment` override → every automatic-attack at the
 *     site is detainment, for any defending alignment (consulted via
 *     `siteAutoAttacksForcedDetainment`).
 * The post-action sweep `discardOrphanedSiteAttachedEvents` discards the card
 * and clears its constraints once no company occupies the bound site.
 *
 * | # | Rule                                                  | Status |
 * |---|-------------------------------------------------------|--------|
 * | 1 | playable on a non-lair, non-Under-deeps Ruins & Lairs | OK     |
 * | 2 | the site becomes a Shadow-hold                        | OK     |
 * | 3 | all automatic-attacks become detainment               | OK     |
 * | 4 | discarded when the site leaves play                    | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildMinionSitePhaseState, buildSitePhaseState, setupAutoAttackStep,
  playPermanentEventAndResolve, dispatch, buildTestState, makeMHState,
  playCreatureHazardAndResolve, companyIdAt, handCardId,
} from '../test-helpers.js';
import { computeLegalActions, SiteType, Phase, Alignment } from '../../index.js';
import { getEffectiveSiteType, siteAutoAttacksForcedDetainment } from '../../engine/effective.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type { CardDefinitionId, CardInstanceId, GameState, ActiveConstraint } from '../../index.js';

const HOLD_REBUILT = 'as-88' as CardDefinitionId;

// Sites
const DIMRILL_DALE = 'le-365' as CardDefinitionId;      // Ruins & Lairs, Orcs auto-attack (1 strike, prowess 6)
const ISLE_OF_ULOND = 'td-178' as CardDefinitionId;     // Ruins & Lairs Dragon's lair (lairOf present)
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;     // Under-deeps Ruins & Lairs (adjacentSites present)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;      // shadow-hold (not Ruins & Lairs)

// Minion characters (orcs)
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

// A faction playable only at Shadow-holds — becomes playable once the site is
// transformed.
const SNAGA_HAI = 'le-286' as CardDefinitionId;

// A hazard creature keyed only to Shadow-hold/Dark-hold sites (or Shadow/Dark
// regions) — used to prove the site-type override reaches creature keying.
const ORC_GUARD = 'tw-072' as CardDefinitionId;

// A Balrog-specific character, for the mismatched-alignment keying test below.
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;

function as88InstanceId(state: GameState): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === HOLD_REBUILT)!.instanceId;
}

describe('Hold Rebuilt and Repaired (as-88)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playability gating ──────────────────────────────────────────────

  test('playable on a non-lair, non-Under-deeps Ruins & Lairs during the site phase', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, characters: [GORBAG], hand: [HOLD_REBUILT] });
    const id = as88InstanceId(state);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
    // The play binds the card to the site it transforms.
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(DIMRILL_DALE);
  });

  test('NOT playable on a Dragon\'s lair Ruins & Lairs', () => {
    const state = buildMinionSitePhaseState({ site: ISLE_OF_ULOND, characters: [GORBAG], hand: [HOLD_REBUILT] });
    const id = as88InstanceId(state);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(0);
  });

  test('NOT playable on an Under-deeps Ruins & Lairs', () => {
    const state = buildMinionSitePhaseState({ site: DROWNING_DEEPS, characters: [GORBAG], hand: [HOLD_REBUILT] });
    const id = as88InstanceId(state);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(0);
  });

  test('NOT playable on a site that is not Ruins & Lairs', () => {
    const state = buildMinionSitePhaseState({ site: MINAS_MORGUL, characters: [GORBAG], hand: [HOLD_REBUILT] });
    const id = as88InstanceId(state);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(0);
  });

  // ── Rule 2: the site becomes a Shadow-hold ──────────────────────────────────

  test('playing it binds the card to the site and overrides the effective type to Shadow-hold', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, characters: [GORBAG], hand: [HOLD_REBUILT] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, as88InstanceId(state), undefined, { targetSiteDefinitionId: DIMRILL_DALE },
    );

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === HOLD_REBUILT);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(DIMRILL_DALE);

    // Printed type is Ruins & Lairs; effective type is now Shadow-hold.
    expect(getEffectiveSiteType(after, DIMRILL_DALE, SiteType.RuinsAndLairs)).toBe(SiteType.ShadowHold);

    // The two until-cleared constraints exist, filtered by the site definition.
    const typeOverride = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type'
        && (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'] === DIMRILL_DALE,
    );
    const detainmentFlag = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'auto-attack.detainment'
        && (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'] === DIMRILL_DALE,
    );
    expect(typeOverride?.scope.kind).toBe('until-cleared');
    expect(detainmentFlag?.scope.kind).toBe('until-cleared');
  });

  test('the override reaches creature keying for a mover whose alignment differs from the site card\'s own', () => {
    // Dimrill Dale (le-365) is printed as a Ringwraith-aligned minion site.
    // A Balrog company can still be stationed there — Balrog and Ringwraith
    // share the shadow side's siteDeck — but its own alignment is not
    // "ringwraith", which is exactly the mismatch that let the site-type
    // override silently drop out of creature-keying validation (the offering
    // side resolves the site by the company's own instance and never hits
    // the mismatch; the validating side used to fall back to a by-name
    // lookup restricted to the mover's alignment, found nothing, and
    // resolved to the site's *printed* type instead of its overridden one).
    //
    // The company is stationary (no `destinationSite`) so its M/H phase state
    // carries an empty `resolvedSitePath` — exactly the game situation this
    // was reported from, where region-type keying cannot apply at all and
    // only the site-type branch is left to decide it.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: DIMRILL_DALE, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [ORC_GUARD], siteDeck: [] },
      ],
    });
    const typeOverride: ActiveConstraint = {
      id: 'as88-type-2' as ActiveConstraint['id'],
      source: 'as88-src-2' as CardInstanceId,
      sourceDefinitionId: HOLD_REBUILT,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: {
        type: 'attribute-modifier',
        attribute: 'site.type',
        op: 'override',
        value: SiteType.ShadowHold,
        filter: { 'site.definitionId': DIMRILL_DALE as string },
      },
    };
    const state: GameState = {
      ...base,
      activeConstraints: [typeOverride],
      phaseState: makeMHState({
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Dimrill Dale',
        hazardLimitAtReveal: 4,
      }),
    };

    // Offered as legal, keyed by the overridden Shadow-hold type.
    const offered = computeLegalActions(state, PLAYER_2).find(
      a => a.viable && a.action.type === 'play-hazard'
        && (a.action as { keyedBy?: { method?: string; value?: string } }).keyedBy?.method === 'site-type',
    );
    expect(offered).toBeDefined();

    // And actually playable: the reducer's own validation must agree with
    // what it just offered, not fall back to the printed Ruins & Lairs type.
    const cardId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, cardId, companyId, { method: 'site-type', value: SiteType.ShadowHold },
    );
    expect(after.combat).not.toBeNull();
  });

  test('a Shadow-hold-only faction (Snaga-hai) becomes playable once the site is transformed', () => {
    const before = buildMinionSitePhaseState({
      site: DIMRILL_DALE, characters: [GORBAG], hand: [HOLD_REBUILT, SNAGA_HAI],
    });
    const snagaId = before.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SNAGA_HAI)!.instanceId;

    // Before transformation: Dimrill Dale is Ruins & Lairs, so Snaga-hai
    // (Shadow-hold only) is not playable.
    const playableBefore = computeLegalActions(before, PLAYER_1).some(
      a => a.viable && a.action.type === 'influence-attempt'
        && (a.action as { factionInstanceId?: CardInstanceId }).factionInstanceId === snagaId,
    );
    expect(playableBefore).toBe(false);

    // After transformation the site reads as a Shadow-hold and Snaga-hai is playable.
    const after = playPermanentEventAndResolve(
      before, PLAYER_1, as88InstanceId(before), undefined, { targetSiteDefinitionId: DIMRILL_DALE },
    );
    const playableAfter = computeLegalActions(after, PLAYER_1).some(
      a => a.viable && a.action.type === 'influence-attempt'
        && (a.action as { factionInstanceId?: CardInstanceId }).factionInstanceId === snagaId,
    );
    expect(playableAfter).toBe(true);
  });

  // ── Rule 3: all automatic-attacks become detainment ─────────────────────────

  test('without the card, the Ruins & Lairs auto-attack is NOT detainment', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, characters: [GORBAG] });
    const inCombat = dispatch(setupAutoAttackStep(state), { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.creatureRace).toBe('orc');
    expect(inCombat.combat!.detainment).toBe(false);
  });

  test('after the card is played, the site auto-attack is detainment', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, characters: [GORBAG], hand: [HOLD_REBUILT] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, as88InstanceId(state), undefined, { targetSiteDefinitionId: DIMRILL_DALE },
    );
    expect(siteAutoAttacksForcedDetainment(after, DIMRILL_DALE)).toBe(true);

    const inCombat = dispatch(setupAutoAttackStep(after), { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.creatureRace).toBe('orc');
    expect(inCombat.combat!.detainment).toBe(true);
  });

  test('the detainment is unconditional — it applies even to a hero (non-Ringwraith) company', () => {
    // A wizard company never receives detainment from the keying rules
    // (§3.II.2 applies only to Ringwraith/Balrog companies), so detainment
    // here can only come from the card\'s explicit "all automatic-attacks
    // become detainment" clause.
    const base = buildSitePhaseState({ site: DIMRILL_DALE, characters: [GORBAG] });
    const constraint: ActiveConstraint = {
      id: 'as88-det-1' as ActiveConstraint['id'],
      source: 'as88-src-1' as CardInstanceId,
      sourceDefinitionId: HOLD_REBUILT,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: {
        type: 'attribute-modifier',
        attribute: 'auto-attack.detainment',
        op: 'override',
        value: 1,
        filter: { 'site.definitionId': DIMRILL_DALE as string },
      },
    };
    const withConstraint = { ...base, activeConstraints: [constraint] };
    const inCombat = dispatch(setupAutoAttackStep(withConstraint), { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.detainment).toBe(true);

    // Control: without the constraint, the wizard company\'s auto-attack is not detainment.
    const noConstraint = dispatch(setupAutoAttackStep(base), { type: 'pass', player: PLAYER_1 });
    expect(noConstraint.combat!.detainment).toBe(false);
  });

  // ── Rule 4: discarded when the site leaves play ─────────────────────────────

  test('the card persists while a company occupies the bound site', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, characters: [GORBAG, SHAGRAT], hand: [HOLD_REBUILT] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, as88InstanceId(state), undefined, { targetSiteDefinitionId: DIMRILL_DALE },
    );
    // The post-action sweep already ran during play resolution; the card stays
    // because the company is still at Dimrill Dale.
    const swept = discardOrphanedSiteAttachedEvents(after);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HOLD_REBUILT)).toBe(true);
  });

  test('the card and its constraints are discarded once the site leaves play', () => {
    const state = buildMinionSitePhaseState({ site: DIMRILL_DALE, characters: [GORBAG], hand: [HOLD_REBUILT] });
    const after = playPermanentEventAndResolve(
      state, PLAYER_1, as88InstanceId(state), undefined, { targetSiteDefinitionId: DIMRILL_DALE },
    );
    const sourceId = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === HOLD_REBUILT)!.instanceId;
    expect(after.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(2);

    // The company moves on — its current site is no longer Dimrill Dale, so the
    // Ruins & Lairs was returned to the location deck.
    const movedCompany = {
      ...after.players[RESOURCE_PLAYER].companies[0],
      currentSite: { ...after.players[RESOURCE_PLAYER].companies[0].currentSite!, definitionId: MINAS_MORGUL },
    };
    const moved: GameState = {
      ...after,
      players: [
        { ...after.players[RESOURCE_PLAYER], companies: [movedCompany] },
        after.players[1],
      ] as GameState['players'],
    };

    const swept = discardOrphanedSiteAttachedEvents(moved);
    expect(swept.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === HOLD_REBUILT)).toBe(false);
    expect(swept.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === HOLD_REBUILT)).toBe(true);
    // Both constraints sourced from the card are gone.
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);
  });
});
