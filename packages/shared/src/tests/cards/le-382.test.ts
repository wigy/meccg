/**
 * @module le-382.test
 *
 * Card test: Hermit's Hill (le-382)
 * Type: minion-site (ruins-and-lairs) · alignment: ringwraith · region: Wold & Foothills
 *
 * Card text:
 *   Nearest Darkhaven: Dol Guldur
 *   Playable: Items (minor)
 *   Automatic-attacks: Men — 3 strikes with 6 prowess
 *   Special: During the site phase, a covert company may discard two minor
 *   items they bear to make any one gold ring item (regardless of its text
 *   restrictions) playable at this untapped site this turn.
 *
 * CRF 22 (Hermit's Hill): to play the unlocked item here, the site must be
 * untapped.
 *
 * The minion sibling of the hero Hermit's Hill (dm-32). Data encoding (filled
 * this pass — the imported data shipped with an empty `playableResources`
 * despite the printed "Items (minor)", the recurring LE-site data bug;
 * verified against `data/cards.json` LE-382 `attributes.playable`):
 *   - `playableResources: [minor]`
 *   - `effects: [grant-action "discard-minors-for-gold-ring"]`
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                  |
 * | 2 | sitePath          | OK     | [dark, shadow, wilderness] ({d}{s}{w})           |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion Darkhaven (le-367)   |
 * | 4 | region            | OK     | "Wold & Foothills"                               |
 * | 5 | playableResources | OK     | [minor] — filled this pass                       |
 * | 6 | automaticAttacks  | OK     | Men, 3 strikes / 6 prowess                       |
 * | 7 | resourceDraws     | OK     | 1                                                |
 * | 8 | hazardDraws       | OK     | 1                                                |
 * | 9 | effects           | OK     | grant-action "discard-minors-for-gold-ring"      |
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                             |
 * |---|----------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Site phase flow                        | IMPLEMENTED | select-company, enter-or-skip, play-resources     |
 * | 2 | Automatic attack (Men 3x6)             | IMPLEMENTED | passes through as data                            |
 * | 3 | Minor item playability                 | IMPLEMENTED | playableResources gate                            |
 * | 4 | Gold ring NOT playable by default      | IMPLEMENTED | not in playableResources / item-play-site fails   |
 * | 5 | discard-minors-for-gold-ring           | IMPLEMENTED | sitePhaseGrantActions (covert gate) + reducer     |
 * | 6 | gold-ring-item-unlocked constraint     | IMPLEMENTED | bypasses site gate AND ring text restrictions     |
 * | 7 | One-ring limit (site taps on play)     | IMPLEMENTED | ring play taps site; tapped site blocks the grant |
 * | 8 | Haven-path movement (Dol Guldur ↔ site)| IMPLEMENTED | movement-map.ts                                   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  resetMint, pool,
  buildMinionSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
  attachItemToChar,
} from '../test-helpers.js';
import { isSiteCard, buildMovementMap, getReachableSites, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, SiteCard, ActivateGrantedAction } from '../../index.js';

const HERMITS_HILL = 'le-382' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // nearest Darkhaven (minion haven)

// Minion company: Belegorn (Dúnadan → covert), Gorbag (Orc → overt)
const BELEGORN = 'le-2' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;

// Minion items
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor
// Bright Gold Ring: "May only be played at a Free-hold [{F}] where gold rings
// are playable" — a text restriction Hermit's Hill (a Ruins & Lairs with no
// gold-ring playability) fails on both counts, so it exercises the
// "regardless of its text restrictions" clause of the unlock.
const BRIGHT_GOLD_RING = 'le-303' as CardDefinitionId;

describe("Hermit's Hill (le-382)", () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men — 3 strikes with 6 prowess ───────────────────────

  test('automatic attack is Men — 3 strikes with 6 prowess', () => {
    const state = buildMinionSitePhaseState({ site: HERMITS_HILL, characters: [BELEGORN] });
    const inCombat = dispatch(setupAutoAttackStep(state), { type: 'pass', player: PLAYER_1 });

    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.strikesTotal).toBe(3);
    expect(inCombat.combat!.strikeProwess).toBe(6);
    expect(inCombat.combat!.creatureRace).toBe('man');
    expect(inCombat.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability by printed list ────────────────────────────────────────

  test('minor item (Strange Rations) is playable', () => {
    const state = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN],
      hand: [STRANGE_RATIONS],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold ring (Bright Gold Ring) is NOT playable without the special ability', () => {
    const state = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN],
      hand: [BRIGHT_GOLD_RING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── discard-minors-for-gold-ring grant-action ───────────────────────────────

  test('discard-minors-for-gold-ring offered when covert company bears 2 minor items', () => {
    let state: GameState = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grant = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-gold-ring',
    );
    expect(grant).toBeDefined();
  });

  test('NOT offered for an overt company (Orc member)', () => {
    let state: GameState = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN, GORBAG],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grant = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-gold-ring',
    );
    expect(grant).toBeUndefined();
  });

  test('NOT offered when the company bears only 1 minor item', () => {
    let state: GameState = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grant = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-gold-ring',
    );
    expect(grant).toBeUndefined();
  });

  test('NOT offered when the site is already tapped', () => {
    let state: GameState = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN],
      siteStatus: CardStatus.Tapped,
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grant = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-gold-ring',
    );
    expect(grant).toBeUndefined();
  });

  test('activating discards both minor items to the discard pile', () => {
    let state: GameState = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grant = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-gold-ring',
    );
    expect(grant).toBeDefined();

    const after = dispatch(state, grant!.action as ActivateGrantedAction);

    const itemsLeft = Object.values(after.players[0].characters)
      .reduce((sum, ch) => sum + ch.items.length, 0);
    expect(itemsLeft).toBe(0);
    expect(after.players[0].discardPile.length).toBe(2);
  });

  test('after discarding 2 minors, a restricted gold ring becomes playable and its play taps the site', () => {
    let state: GameState = buildMinionSitePhaseState({
      site: HERMITS_HILL,
      characters: [BELEGORN],
      hand: [BRIGHT_GOLD_RING],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);
    state = attachItemToChar(state, RESOURCE_PLAYER, BELEGORN, STRANGE_RATIONS);

    const grantActions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grant = grantActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-gold-ring',
    );
    expect(grant).toBeDefined();
    const unlocked = dispatch(state, grant!.action as ActivateGrantedAction);

    // Bright Gold Ring's own text restriction (Free-hold where gold rings are
    // playable) does not match Hermit's Hill — the unlock bypasses it.
    const playActions = viableActions(unlocked, PLAYER_1, 'play-hero-resource');
    const ringInstanceId = unlocked.players[0].hand.find(c => {
      const def = unlocked.cardPool[c.definitionId];
      return def?.name === 'Bright Gold Ring';
    })?.instanceId;
    expect(ringInstanceId).toBeDefined();
    const ringPlay = playActions.find(
      ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (ringInstanceId as string),
    );
    expect(ringPlay).toBeDefined();

    // "playable at this untapped site" — the ring's play taps the site,
    // naturally limiting the unlock to one gold ring.
    const played = dispatch(unlocked, ringPlay!.action);
    expect(played.players[0].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    const belegorn = Object.values(played.players[0].characters)
      .find(ch => played.cardPool[ch.definitionId]?.name === 'Belegorn');
    expect(belegorn).toBeDefined();
    expect(belegorn!.items.some(i => played.cardPool[i.definitionId]?.name === 'Bright Gold Ring')).toBe(true);
  });

  // ─── Movement: Dol Guldur ↔ Hermit's Hill ────────────────────────────────────

  test("starter movement from Dol Guldur reaches Hermit's Hill", () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (HERMITS_HILL as string),
    );
    expect(starter).toBeDefined();
  });
});
