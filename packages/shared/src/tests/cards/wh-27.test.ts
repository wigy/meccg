/**
 * @module wh-27.test
 *
 * Card test: Nature's Revenge (wh-27)
 * Type: hazard-event (permanent), non-unique, Neutral
 *
 * Card text:
 *   "Playable on a site in a Wilderness [{w}] that normally is a Border-hold
 *    [{B}] or a Shadow-hold [{S}], or on a non-protected Wizardhaven [{H}] in a
 *    Wilderness [{w}]. All versions of the site become Ruins & Lairs [{R}] and
 *    each gains an additional automatic-attack: Animals — each character faces
 *    1 strike with 7 prowess. Discard this card when the site is discarded or
 *    returned to its location deck."
 *
 * Effects (data):
 *   - `play-target` site, filter `regionType: wilderness` AND (printed
 *     `siteType` in {border-hold, shadow-hold} OR (`isWizardhaven` AND NOT
 *     `isProtected`)). The three derived facts come from the shared site
 *     play-target context (`buildSiteFilterContext`, engine/effective.ts): the
 *     region type lives on a separate region card, and "Wizardhaven" /
 *     "protected" are game state, not printed fields.
 *   - `on-event self-enters-play → add-constraint site-type-override`
 *     (`overrideType: ruins-and-lairs`, `allVersions: true`, `until-cleared`) —
 *     `allVersions` scopes the constraint filter by printed *name*, so the hero
 *     and minion printings of the location (distinct definitions sharing one
 *     name) are both retyped, matching "All versions of the site".
 *   - `permanent-event-auto-attack` (`boundSite: true`, Animals 1 strike /
 *     7 prowess, `each-character`) — appended by `getActiveAutoAttacks` to
 *     every version of the site the card is bound to (`attachedToSite`).
 *
 * "Discard this card when the site is discarded or returned to its location
 * deck" is the existing site-attached orphan sweep
 * (`discardOrphanedSiteAttachedEvents`), which also clears the card's
 * constraints — so both the retyping and the extra attack end with the card.
 *
 * | # | Rule                                                            | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | playable on a Border-hold in a Wilderness                        | OK     |
 * | 2 | playable on a Shadow-hold in a Wilderness                        | OK     |
 * | 3 | NOT playable on a Border-hold outside a Wilderness               | OK     |
 * | 4 | NOT playable on a site that normally is not a B/S-hold           | OK     |
 * | 5 | NOT playable on a Haven that is not a Wizardhaven                | OK     |
 * | 6 | playable on a non-protected Wizardhaven in a Wilderness          | OK     |
 * | 7 | NOT playable on that Wizardhaven once it is protected            | OK     |
 * | 8 | playing binds the card to the site (attachedToSite)              | OK     |
 * | 9 | ALL versions of the site become Ruins & Lairs                    | OK     |
 * |10 | each version gains the Animals automatic-attack (1 strike, 7)    | OK     |
 * |11 | the company at the site faces that attack — each character       | OK     |
 * |12 | discarded (with its constraint) when the site leaves play        | OK     |
 *
 * Player-index convention: the moving (resource) company is P1 /
 * RESOURCE_PLAYER; the Neutral hazard permanent-event sits in the hazard
 * player's (P2 / HAZARD_PLAYER) hand.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  resetMint, mint, buildHazardMovingState, buildSitePhaseState, setupAutoAttackStep,
  addP2CardsInPlay, viableActions, dispatch, resolveChain,
} from '../test-helpers.js';
import { SiteType, CardStatus, Alignment } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { discardOrphanedSiteAttachedEvents, defById } from '../../engine/reducer-utils.js';
import { isSiteCard } from '../../types/cards.js';
import type { CardDefinitionId, CardInstanceId, GameState, SiteCard } from '../../index.js';

const NATURES_REVENGE = 'wh-27' as CardDefinitionId;

// Old Forest — a Border-hold in Cardolan (a Wilderness). Both printings exist:
// the hero version (no printed automatic-attacks) and the minion version
// (Maia — 2 strikes, 15 prowess), which is what "all versions" is about.
const OLD_FOREST_HERO = 'tw-417' as CardDefinitionId;
const OLD_FOREST_MINION = 'as-156' as CardDefinitionId;
// Goblin-gate — a Shadow-hold in the High Pass (a Wilderness), Orcs 3/6.
const GOBLIN_GATE = 'tw-398' as CardDefinitionId;
// Shrel-Kain — a Border-hold in Dorwinion, a Border-land (not a Wilderness).
const SHREL_KAIN = 'tw-425' as CardDefinitionId;
// Dimrill Dale — Ruins & Lairs in the Redhorn Gate (a Wilderness).
const DIMRILL_DALE = 'tw-385' as CardDefinitionId;
// Rivendell — a METW Haven in Rhudaur (a Wilderness), but not a Wizardhaven.
const RIVENDELL_SITE = 'tw-421' as CardDefinitionId;
// The White Towers (wh-58) — a Fallen-wizard Wizardhaven in Arthedain (a
// Wilderness); Isengard (wh-56) is the Fallen-wizard company's origin.
const WHITE_TOWERS_FW = 'wh-58' as CardDefinitionId;
const ISENGARD = 'wh-56' as CardDefinitionId;

describe("Nature's Revenge (wh-27)", () => {
  beforeEach(() => resetMint());

  // ── Rules 1–5: play gating on the target site ──────────────────────────────

  test('playable on a Border-hold in a Wilderness', () => {
    const state = buildHazardMovingState(OLD_FOREST_HERO, 'Old Forest', [NATURES_REVENGE]);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId)
      .toBe(OLD_FOREST_HERO);
  });

  test('playable on a Shadow-hold in a Wilderness', () => {
    const state = buildHazardMovingState(GOBLIN_GATE, 'Goblin-gate', [NATURES_REVENGE]);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId)
      .toBe(GOBLIN_GATE);
  });

  test('NOT playable on a Border-hold that is not in a Wilderness', () => {
    const state = buildHazardMovingState(SHREL_KAIN, 'Shrel-Kain', [NATURES_REVENGE]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable on a site in a Wilderness that normally is Ruins & Lairs', () => {
    const state = buildHazardMovingState(DIMRILL_DALE, 'Dimrill Dale', [NATURES_REVENGE]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable on a Haven in a Wilderness that is not a Wizardhaven', () => {
    const state = buildHazardMovingState(RIVENDELL_SITE, 'Rivendell', [NATURES_REVENGE]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ── Rules 6–7: the Wizardhaven clause ──────────────────────────────────────

  test('playable on a non-protected Wizardhaven in a Wilderness', () => {
    const state = buildHazardMovingState(
      WHITE_TOWERS_FW, 'The White Towers', [NATURES_REVENGE], [ARAGORN],
      { resourceAlignment: Alignment.FallenWizard, origin: ISENGARD },
    );
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId)
      .toBe(WHITE_TOWERS_FW);
  });

  test('NOT playable on a Wizardhaven that is protected', () => {
    const base = buildHazardMovingState(
      WHITE_TOWERS_FW, 'The White Towers', [NATURES_REVENGE], [ARAGORN],
      { resourceAlignment: Alignment.FallenWizard, origin: ISENGARD },
    );
    // The Fortress of the Towers (wh-69) / Guarded Haven (wh-74) protect the
    // site for its Fallen-wizard with a `site-protected` site flag.
    const protectedState = addConstraint(base, {
      source: 'wh69-src' as CardInstanceId,
      sourceDefinitionId: 'wh-69' as CardDefinitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'site-flag', flag: 'site-protected', siteDefinitionId: WHITE_TOWERS_FW },
    });
    expect(viableActions(protectedState, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ── Rules 8–9: binding and the "all versions" retyping ─────────────────────

  test('playing it binds the card to the site and retypes ALL versions to Ruins & Lairs', () => {
    const state = buildHazardMovingState(OLD_FOREST_HERO, 'Old Forest', [NATURES_REVENGE]);
    const play = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const after = resolveChain(dispatch(state, play));

    const inPlay = after.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === NATURES_REVENGE);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(OLD_FOREST_HERO);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);

    // The bound (hero) printing and the minion printing of Old Forest — a
    // different definition with the same name — both read as Ruins & Lairs.
    expect(getEffectiveSiteType(after, OLD_FOREST_HERO, SiteType.BorderHold)).toBe(SiteType.RuinsAndLairs);
    expect(getEffectiveSiteType(after, OLD_FOREST_MINION, SiteType.BorderHold)).toBe(SiteType.RuinsAndLairs);

    // A same-typed site with a different name is untouched.
    expect(getEffectiveSiteType(after, SHREL_KAIN, SiteType.BorderHold)).toBe(SiteType.BorderHold);

    // The override is a name-scoped until-cleared constraint sourced from the card.
    const override = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type'
        && c.source === inPlay!.instanceId,
    );
    expect(override).toBeDefined();
    expect(override!.scope.kind).toBe('until-cleared');
    expect((override!.kind as { filter?: Record<string, string> }).filter)
      .toEqual({ 'site.name': 'Old Forest' });
  });

  // ── Rule 10: the added automatic-attack, on every version ──────────────────

  test('every version of the site gains the Animals automatic-attack, keeping its printed ones', () => {
    const state = buildHazardMovingState(OLD_FOREST_HERO, 'Old Forest', [NATURES_REVENGE]);
    const play = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const after = resolveChain(dispatch(state, play));

    const heroDef = defById(after, OLD_FOREST_HERO) as SiteCard;
    const minionDef = defById(after, OLD_FOREST_MINION) as SiteCard;
    expect(isSiteCard(heroDef) && isSiteCard(minionDef)).toBe(true);

    // Hero Old Forest has no printed automatic-attacks: only the added one.
    const heroAttacks = getActiveAutoAttacks(after, heroDef);
    expect(heroAttacks).toHaveLength(1);
    expect(heroAttacks[0].creatureType).toBe('Animals');
    expect(heroAttacks[0].strikes).toBe(1);
    expect(heroAttacks[0].prowess).toBe(7);
    expect(heroAttacks[0].combatRules).toContain('each-character');

    // The minion printing keeps its printed Maia attack and gains the Animals one.
    const minionAttacks = getActiveAutoAttacks(after, minionDef);
    expect(minionAttacks.map(a => a.creatureType)).toEqual(['Maia', 'Animals']);

    // An unrelated site gains nothing.
    const shrelKain = defById(after, SHREL_KAIN) as SiteCard;
    expect(getActiveAutoAttacks(after, shrelKain)).toHaveLength(0);
  });

  test('a site of the same type elsewhere is unaffected while the card is bound to Old Forest', () => {
    const state = buildHazardMovingState(OLD_FOREST_HERO, 'Old Forest', [NATURES_REVENGE]);
    const play = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const after = resolveChain(dispatch(state, play));

    const goblinGate = defById(after, GOBLIN_GATE) as SiteCard;
    expect(getActiveAutoAttacks(after, goblinGate).map(a => a.creatureType)).toEqual(['Orcs']);
    expect(getEffectiveSiteType(after, GOBLIN_GATE, SiteType.ShadowHold)).toBe(SiteType.ShadowHold);
  });

  // ── Rule 11: the company actually faces the attack, each character ─────────

  test('the company at the site faces the Animals attack — one strike per character', () => {
    const base = buildSitePhaseState({ site: OLD_FOREST_HERO, characters: [ARAGORN, LEGOLAS] });
    // Without the card, hero Old Forest has no automatic-attacks at all.
    const noCard = dispatch(setupAutoAttackStep(base), { type: 'pass', player: PLAYER_1 });
    expect(noCard.combat).toBeNull();

    const withCard = addP2CardsInPlay(base, [{
      instanceId: mint(),
      definitionId: NATURES_REVENGE,
      status: CardStatus.Untapped,
      attachedToSite: OLD_FOREST_HERO,
    }]);
    const inCombat = dispatch(setupAutoAttackStep(withCard), { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.creatureRace).toBe('animal');
    expect(inCombat.combat!.strikeProwess).toBe(7);
    // each-character: one strike per character in the company, not a single strike.
    expect(inCombat.combat!.strikesTotal).toBe(2);
  });

  // ── Rule 12: discarded when the site leaves play ───────────────────────────

  test('the card and its constraint are discarded once the site leaves play', () => {
    const state = buildHazardMovingState(OLD_FOREST_HERO, 'Old Forest', [NATURES_REVENGE]);
    const play = viableActions(state, PLAYER_2, 'play-hazard')[0].action;
    const after = resolveChain(dispatch(state, play));
    const sourceId = after.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === NATURES_REVENGE)!.instanceId;

    // While the company is at Old Forest the card stays (the sweep already ran
    // during play resolution).
    const p1Company = after.players[RESOURCE_PLAYER].companies[0];
    const atSite: GameState = {
      ...after,
      players: [
        {
          ...after.players[RESOURCE_PLAYER],
          companies: [{
            ...p1Company,
            currentSite: { ...p1Company.destinationSite!, status: CardStatus.Untapped },
            destinationSite: null,
          }],
        },
        after.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };
    const stillThere = discardOrphanedSiteAttachedEvents(atSite);
    expect(stillThere.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === sourceId)).toBe(true);
    expect(stillThere.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(1);

    // The company moves on — Old Forest goes back to its location deck.
    const movedCompany = {
      ...atSite.players[RESOURCE_PLAYER].companies[0],
      currentSite: {
        ...atSite.players[RESOURCE_PLAYER].companies[0].currentSite!,
        definitionId: RIVENDELL_SITE,
      },
    };
    const moved: GameState = {
      ...atSite,
      players: [
        { ...atSite.players[RESOURCE_PLAYER], companies: [movedCompany] },
        atSite.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };
    const swept = discardOrphanedSiteAttachedEvents(moved);

    expect(swept.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === sourceId)).toBe(false);
    expect(swept.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === sourceId)).toBe(true);
    expect(swept.activeConstraints.filter(c => c.source === sourceId)).toHaveLength(0);

    // Both the retyping and the extra automatic-attack end with the card.
    expect(getEffectiveSiteType(swept, OLD_FOREST_HERO, SiteType.BorderHold)).toBe(SiteType.BorderHold);
    expect(getEffectiveSiteType(swept, OLD_FOREST_MINION, SiteType.BorderHold)).toBe(SiteType.BorderHold);
    expect(getActiveAutoAttacks(swept, defById(swept, OLD_FOREST_HERO) as SiteCard)).toHaveLength(0);
  });
});
