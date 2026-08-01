/**
 * @module wh-31.test
 *
 * Card test: Whole Villages Roused (wh-31)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Card text:
 *   "Playable on a hero Border-hold [{B}] or Free-hold [{F}]. The site has the
 *    automatic-attacks indicated on the corresponding minion site card
 *    (detainment against hero companies) but with +2 prowess. Alternatively,
 *    playable on a minion Shadow-hold [{S}] or Dark-hold [{D}]. The site has
 *    the automatic-attacks indicated on the corresponding hero site card
 *    (detainment against overt companies) but with +2 prowess."
 *
 * Effects (data):
 *   - play-condition requires:site-path — playable only against a company
 *       genuinely moving to a hero Border-hold/Free-hold OR a minion
 *       Shadow-hold/Dark-hold. Gates on the new `destinationSiteCardType` +
 *       `destinationSiteType` context keys (`checkSitePathCondition`):
 *       `cardType` is required because the same `siteType` string occurs on
 *       both alignments (e.g. Raider-hold: as-141 hero / le-399 minion, both
 *       border-hold; Moria: tw-413 hero / le-392 minion, both shadow-hold).
 *   - on-event company-arrives-at-site → add-constraint
 *       `mirror-automatic-attacks` (value 2, scope turn): installed on
 *       resolution, bound to the destination site *instance*.
 *       `constraint-kind.ts` resolves the same-named opposite-alignment site
 *       definition and bakes in the detainment mode — hero-site mode stores
 *       `detainmentAgainstPlayer` (the hero-aligned player's id); minion-site
 *       mode stores `detainmentAgainstOvert: true`. `manifestations.ts`
 *       `getActiveAutoAttacks` returns the mirror site's automatic-attacks,
 *       each +2 prowess, in place of the printed list — for this one
 *       company's one visit only (matched by site instance, not definition).
 *
 * Engine support:
 * | # | Rule                                                              | Status |
 * |---|--------------------------------------------------------------------|--------|
 * | 1 | Playable moving to a hero Border-hold                              | OK     |
 * | 2 | Playable moving to a minion Shadow-hold                            | OK     |
 * | 3 | NOT playable moving to hero Moria (shadow-hold, wrong cardType)     | OK     |
 * | 4 | NOT playable moving to minion Raider-hold (border-hold, wrong type) | OK     |
 * | 5 | NOT playable moving to a non-hold site (Rivendell haven)            | OK     |
 * | 6 | NOT playable for a stationary company                              | OK     |
 * | 7 | Resolution installs mirror-automatic-attacks (hero mode)            | OK     |
 * | 8 | Resolution installs mirror-automatic-attacks (minion mode)          | OK     |
 * | 9 | Site phase: hero site gets minion's attack, +2 prowess              | OK     |
 * |10 | Site phase: minion site gets hero's attack, +2 prowess              | OK     |
 * |11 | Detainment against the hero-aligned player (hero mode)              | OK     |
 * |12 | NOT detainment against a different player (hero mode isolation)    | OK     |
 * |13 | Detainment against a racially overt company (minion mode)          | OK     |
 * |14 | NOT detainment against a covert company (minion mode isolation)    | OK     |
 *
 * Player-index convention: PLAYER_1 is the moving (resource) company;
 * PLAYER_2 holds the Neutral hazard short-event in hand.
 *
 * Playable: YES. Certified: 2026-08-01.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL, MORIA,
  buildHazardMovingState, buildSitePhaseState, setupAutoAttackStep,
  viableActions, playHazardAndResolve, dispatch, makeMHState,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import type { CardDefinitionId, GameState, CardInstanceId, PlayerId } from '../../index.js';

const WHOLE_VILLAGES_ROUSED = 'wh-31' as CardDefinitionId;

// Dale: hero (empty printed attacks) / minion (Men, each-character, 1/5) — border-hold pair.
const DALE_HERO = 'td-174' as CardDefinitionId;
const DALE_MINION = 'le-363' as CardDefinitionId;

// Mount Gundabad: minion (Orcs, each-character, 1/7) / hero (Orcs, 2/8, no each-character) — shadow-hold pair.
const GUNDABAD_MINION = 'le-395' as CardDefinitionId;
const GUNDABAD_HERO = 'tw-416' as CardDefinitionId;

// Raider-hold: hero (as-141, border-hold) / minion (le-399, ALSO border-hold) — disambiguation fixture.
const RAIDER_HOLD_HERO = 'as-141' as CardDefinitionId;
const RAIDER_HOLD_MINION = 'le-399' as CardDefinitionId;

// Minion Orc — makes a company racially overt (le-31, precedent: le-391 test).
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;

/** The Whole Villages Roused play-hazard actions in the hazard player's hand. */
function wvrActions(state: GameState, hazardPlayer: PlayerId) {
  return viableActions(state, hazardPlayer, 'play-hazard').filter(a => {
    const hand = state.players.find(p => p.id === hazardPlayer)!.hand;
    const card = hand.find(h => h.instanceId === (a.action as { cardInstanceId?: unknown }).cardInstanceId);
    return card?.definitionId === WHOLE_VILLAGES_ROUSED;
  });
}

/** Install the mirror-automatic-attacks constraint exactly as M/H resolution does. */
function withMirror(
  state: GameState,
  opts: {
    mirrorSiteDefinitionId: CardDefinitionId;
    detainmentAgainstPlayer?: PlayerId;
    detainmentAgainstOvert?: boolean;
  },
): GameState {
  const company = state.players[0].companies[0];
  return addConstraint(state, {
    source: 'wh31-src' as CardInstanceId,
    sourceDefinitionId: WHOLE_VILLAGES_ROUSED,
    scope: { kind: 'turn' },
    target: { kind: 'company', companyId: company.id },
    kind: {
      type: 'mirror-automatic-attacks',
      siteInstanceId: company.currentSite!.instanceId,
      mirrorSiteDefinitionId: opts.mirrorSiteDefinitionId,
      prowessBoost: 2,
      ...(opts.detainmentAgainstPlayer !== undefined ? { detainmentAgainstPlayer: opts.detainmentAgainstPlayer } : {}),
      ...(opts.detainmentAgainstOvert ? { detainmentAgainstOvert: true } : {}),
    },
  });
}

describe('Whole Villages Roused (wh-31)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate ───────────────────────────────────────────────────

  test('offered against a company moving to a hero Border-hold (Dale)', () => {
    const state = buildHazardMovingState(DALE_HERO, 'Dale', [WHOLE_VILLAGES_ROUSED]);
    expect(wvrActions(state, PLAYER_2).length).toBeGreaterThan(0);
  });

  test('offered against a company moving to a minion Shadow-hold (Mount Gundabad)', () => {
    const state = buildHazardMovingState(
      GUNDABAD_MINION, 'Mount Gundabad', [WHOLE_VILLAGES_ROUSED], [ORC_CAPTAIN],
      { resourceAlignment: Alignment.Ringwraith },
    );
    expect(wvrActions(state, PLAYER_2).length).toBeGreaterThan(0);
  });

  test('NOT offered moving to hero Moria (shadow-hold — wrong cardType for minion mode, wrong siteType for hero mode)', () => {
    const state = buildHazardMovingState(MORIA, 'Moria', [WHOLE_VILLAGES_ROUSED]);
    expect(wvrActions(state, PLAYER_2)).toHaveLength(0);
  });

  test('NOT offered moving to minion Raider-hold (border-hold — wrong cardType for hero mode, wrong siteType for minion mode)', () => {
    const state = buildHazardMovingState(
      RAIDER_HOLD_MINION, 'Raider-hold', [WHOLE_VILLAGES_ROUSED], [ORC_CAPTAIN],
      { resourceAlignment: Alignment.Ringwraith },
    );
    expect(wvrActions(state, PLAYER_2)).toHaveLength(0);
  });

  test('NOT offered moving to a non-hold site (Rivendell, a Haven)', () => {
    const state = buildHazardMovingState(RIVENDELL, 'Rivendell', [WHOLE_VILLAGES_ROUSED]);
    expect(wvrActions(state, PLAYER_2)).toHaveLength(0);
  });

  test('NOT offered for a stationary company at a hero Border-hold', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          // No destinationSite → not moving.
          { id: PLAYER_1, companies: [{ site: DALE_HERO, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [WHOLE_VILLAGES_ROUSED], siteDeck: [DALE_HERO] },
        ],
      }),
      phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4, destinationSiteName: 'Dale' }),
    };
    expect(wvrActions(state, PLAYER_2)).toHaveLength(0);
  });

  // ─── Resolution installs the mirror constraint ─────────────────────────

  test('hero mode: playing it installs a turn-scoped mirror-automatic-attacks constraint keyed to the minion sibling', () => {
    const state = buildHazardMovingState(DALE_HERO, 'Dale', [WHOLE_VILLAGES_ROUSED]);
    const card = state.players[1].hand.find(c => c.definitionId === WHOLE_VILLAGES_ROUSED)!;
    const company = state.players[0].companies[0];
    const heroPlayerId = state.players[0].id;
    const after = playHazardAndResolve(state, PLAYER_2, card.instanceId, company.id);

    const mirror = after.activeConstraints.find(c => c.kind.type === 'mirror-automatic-attacks');
    expect(mirror).toBeDefined();
    if (mirror?.kind.type !== 'mirror-automatic-attacks') throw new Error('unreachable');
    expect(mirror.kind.mirrorSiteDefinitionId).toBe(DALE_MINION);
    expect(mirror.kind.prowessBoost).toBe(2);
    expect(mirror.kind.detainmentAgainstPlayer).toBe(heroPlayerId);
    expect(mirror.kind.detainmentAgainstOvert).toBeUndefined();
    expect(mirror.scope.kind).toBe('turn');
    expect(after.players[1].discardPile.some(c => c.definitionId === WHOLE_VILLAGES_ROUSED)).toBe(true);
  });

  test('minion mode: playing it installs a turn-scoped mirror-automatic-attacks constraint keyed to the hero sibling', () => {
    const state = buildHazardMovingState(
      GUNDABAD_MINION, 'Mount Gundabad', [WHOLE_VILLAGES_ROUSED], [ORC_CAPTAIN],
      { resourceAlignment: Alignment.Ringwraith },
    );
    const card = state.players[1].hand.find(c => c.definitionId === WHOLE_VILLAGES_ROUSED)!;
    const company = state.players[0].companies[0];
    const after = playHazardAndResolve(state, PLAYER_2, card.instanceId, company.id);

    const mirror = after.activeConstraints.find(c => c.kind.type === 'mirror-automatic-attacks');
    expect(mirror).toBeDefined();
    if (mirror?.kind.type !== 'mirror-automatic-attacks') throw new Error('unreachable');
    expect(mirror.kind.mirrorSiteDefinitionId).toBe(GUNDABAD_HERO);
    expect(mirror.kind.prowessBoost).toBe(2);
    expect(mirror.kind.detainmentAgainstOvert).toBe(true);
    expect(mirror.kind.detainmentAgainstPlayer).toBeUndefined();
  });

  // ─── Site phase: the borrowed automatic-attack (hero mode) ─────────────

  test('baseline: hero Dale has no automatic-attacks (control)', () => {
    const base = dispatch(setupAutoAttackStep(buildSitePhaseState({ site: DALE_HERO })), { type: 'pass', player: PLAYER_1 });
    expect(base.combat).toBeNull();
  });

  test("hero mode: Dale's automatic-attack becomes the minion sibling's Men attack, +2 prowess", () => {
    const boosted = dispatch(
      setupAutoAttackStep(withMirror(buildSitePhaseState({ site: DALE_HERO }), {
        mirrorSiteDefinitionId: DALE_MINION,
        detainmentAgainstPlayer: PLAYER_1,
      })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat).not.toBeNull();
    expect(boosted.combat!.creatureRace).toBe('man');
    expect(boosted.combat!.strikeProwess).toBe(7); // 5 + 2
    expect(boosted.combat!.eachCharacterFacesOneStrike).toBe(true);
  });

  test('hero mode: the borrowed attack is detainment against the hero-aligned defending player', () => {
    const boosted = dispatch(
      setupAutoAttackStep(withMirror(buildSitePhaseState({ site: DALE_HERO }), {
        mirrorSiteDefinitionId: DALE_MINION,
        detainmentAgainstPlayer: PLAYER_1,
      })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat!.detainment).toBe(true);
  });

  test('hero mode isolation: NOT detainment when detainmentAgainstPlayer names a different player', () => {
    const boosted = dispatch(
      setupAutoAttackStep(withMirror(buildSitePhaseState({ site: DALE_HERO }), {
        mirrorSiteDefinitionId: DALE_MINION,
        detainmentAgainstPlayer: PLAYER_2,
      })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat!.detainment).toBe(false);
  });

  // ─── Site phase: the borrowed automatic-attack (minion mode) ───────────

  test("baseline: minion Mount Gundabad's own printed attack is Orcs, each-character, 1/7 (control)", () => {
    const base = dispatch(
      setupAutoAttackStep(buildSitePhaseState({ site: GUNDABAD_MINION, characters: [ORC_CAPTAIN] })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(base.combat).not.toBeNull();
    expect(base.combat!.strikeProwess).toBe(7);
    expect(base.combat!.eachCharacterFacesOneStrike).toBe(true);
  });

  test("minion mode: Mount Gundabad's automatic-attack becomes the hero sibling's Orcs attack, +2 prowess, no each-character", () => {
    const boosted = dispatch(
      setupAutoAttackStep(withMirror(buildSitePhaseState({ site: GUNDABAD_MINION, characters: [ORC_CAPTAIN] }), {
        mirrorSiteDefinitionId: GUNDABAD_HERO,
        detainmentAgainstOvert: true,
      })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat).not.toBeNull();
    expect(boosted.combat!.creatureRace).toBe('orc');
    expect(boosted.combat!.strikesTotal).toBe(2);
    expect(boosted.combat!.strikeProwess).toBe(10); // 8 + 2
    expect(boosted.combat!.eachCharacterFacesOneStrike ?? false).toBe(false);
  });

  test('minion mode: the borrowed attack is detainment against a racially overt (Orc) defending company', () => {
    const boosted = dispatch(
      setupAutoAttackStep(withMirror(buildSitePhaseState({ site: GUNDABAD_MINION, characters: [ORC_CAPTAIN] }), {
        mirrorSiteDefinitionId: GUNDABAD_HERO,
        detainmentAgainstOvert: true,
      })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat!.detainment).toBe(true);
  });

  test('minion mode isolation: NOT detainment against a covert (non-Orc, hero-aligned) defending company', () => {
    const boosted = dispatch(
      setupAutoAttackStep(withMirror(buildSitePhaseState({ site: GUNDABAD_MINION, characters: [ARAGORN] }), {
        mirrorSiteDefinitionId: GUNDABAD_HERO,
        detainmentAgainstOvert: true,
      })),
      { type: 'pass', player: PLAYER_1 },
    );
    expect(boosted.combat!.detainment).toBe(false);
  });
});
