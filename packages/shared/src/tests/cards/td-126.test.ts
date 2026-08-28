/**
 * @module td-126.test
 *
 * Card test: King under the Mountain (td-126)
 * Type: hero-resource-event (permanent), unique, wizard
 *
 * Text:
 *   "Unique. Playable on Balin, Dáin II, Thorin II, or Thráin II if his
 *    company has defeated an at home Dragon manifestation attack other than
 *    Eärcaraxë at Home. The target Dwarf receives +5 direct influence
 *    against Dwarves and Dwarf factions. The site where the Dragon was
 *    defeated becomes a Border-hold [{B}] and Dwarf-hold for all purposes
 *    and has no Dragon automatic-attacks. Only Dwarves may play items at
 *    this site."
 *
 * Effects:
 * | # | Effect Type   | Notes                                                                  |
 * |---|---------------|--------------------------------------------------------------------------|
 * | 1 | play-target   | character, name in [Balin, Dáin II, Thorin II, Thráin II] AND           |
 * |   |               | target.dragonAtHomeVictorySiteId exists                                 |
 * | 2 | stat-modifier | +5 direct-influence, reason influence-check, target.race dwarf          |
 * | 3 | stat-modifier | +5 direct-influence, reason faction-influence-check, faction.race dwarf |
 * | 4 | on-event      | self-enters-play -> add-constraint site-type-override (border-hold),    |
 * |   |               | siteFrom: dragon-at-home-victory                                        |
 * | 5 | on-event      | self-enters-play -> add-constraint dwarf-hold-override (site-flag)      |
 * | 6 | on-event      | self-enters-play -> add-constraint skip-automatic-attacks (site-flag)   |
 * | 7 | on-event      | self-enters-play -> add-constraint item-play-race-restriction (dwarf)   |
 *
 * The "if his company has defeated an at home Dragon manifestation attack"
 * clause required new persistent state: `CharacterInPlay.dragonAtHomeVictorySiteId`,
 * stamped on every member of a company that fully defeats the *augmented*
 * automatic-attack an in-play "<Dragon> at Home" permanent-event contributes
 * to its lair (as opposed to the lair's baseline printed Dragon attack),
 * excluding Eärcaraxë at Home (td-22) by definition id (`combat-finalize.ts`).
 * The site the card converts is resolved from that recorded id via a new
 * `siteFrom: "dragon-at-home-victory"` add-constraint flag (`chain-reducer.ts`),
 * not from where the card itself is played (it is played on a character).
 * "Dwarf-hold for all purposes" reuses the existing `dwarf-hold` site keyword
 * (previously only ever printed statically) via a new `dwarf-hold-override`
 * site-flag folded into `site.keywords` (`legal-actions/organization.ts`,
 * the sole existing consumer of that keyword, Map to Mithril td-133). "No
 * Dragon automatic-attacks" reuses the existing `skip-automatic-attacks`
 * site-flag — every Dragon's-lair site in the pool has exactly one printed
 * automatic-attack (the Dragon itself), so removing all of them is exactly
 * "no Dragon automatic-attacks". "Only Dwarves may play items" is a new
 * `item-play-race-restriction` constraint consumed by the item-play
 * candidate-character filter in `legal-actions/site.ts`.
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  BALIN, GIMLI, ARAGORN, ELROND, GLORFINDEL_II, DAGGER_OF_WESTERNESSE,
  BLUE_MOUNTAIN_DWARF_HOLD, BLUE_MOUNTAIN_DWARVES,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, buildSitePhaseState, resetMint, setupAutoAttackStep,
  runAutoAttackCombatMulti, addCardInPlay, addCardToHand,
  findCharInstanceId, findHandCardId, playPermanentEventAndResolve,
  viableActionsForHandCard, dispatch,
  Phase,
} from '../test-helpers.js';
import { computeLegalActions, SiteType } from '../../index.js';
import { hasSiteFlag } from '../../engine/reducer-utils.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import { buildGrantActionContext, availableDI } from '../../engine/legal-actions/organization.js';
import type {
  CardDefinitionId, GameState, CharacterCard, PlayPermanentEventAction, InfluenceAttemptAction,
} from '../../index.js';

const KING_UNDER_THE_MOUNTAIN = 'td-126' as CardDefinitionId;
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;
const EARCARAXE_AT_HOME = 'td-22' as CardDefinitionId;
const LONELY_MOUNTAIN_HERO = 'tw-428' as CardDefinitionId; // Smaug's lair (lairOf tw-90)
const ISLE_OF_THE_ULOND = 'td-178' as CardDefinitionId;    // Eärcaraxë's lair (lairOf td-20)

/**
 * Pass through the remaining site-phase steps (declare-agent-attack,
 * resolve-attacks, …) after all automatic-attacks are resolved, until the
 * 'play-resources' step is reached, where character-targeted permanent
 * events are offered again.
 */
function advanceToPlayResources(state: GameState): GameState {
  let s = state;
  while (s.phaseState.phase === Phase.Site && s.phaseState.step !== 'play-resources') {
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
  }
  return s;
}

/**
 * Set up a site-phase company of Balin/Elrond/Glorfindel II at `site`,
 * optionally with a Dragon-at-home card in the hazard player's cardsInPlay,
 * positioned at the automatic-attacks step. Elrond (prowess 7) and
 * Glorfindel II (prowess 8) are strong enough to reliably defeat the
 * augmented at-home Dragon attack (18 prowess) on a forced roll of 12
 * (roll + prowess > creature prowess); Balin (prowess 4) alone suffices for
 * the lair's weaker printed attack (14 prowess).
 */
function setupLairCompany(site: CardDefinitionId, atHomeDefId?: CardDefinitionId): GameState {
  let state: GameState = setupAutoAttackStep(buildSitePhaseState({
    site,
    characters: [BALIN, ELROND, GLORFINDEL_II],
  }));
  if (atHomeDefId) {
    state = addCardInPlay(state, HAZARD_PLAYER, atHomeDefId);
  }
  return state;
}

describe('King under the Mountain (td-126)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: "if his company has defeated an at home Dragon manifestation attack" ──

  test('defeating the printed lair attack alone (no At-Home in play) does NOT record a victory', () => {
    const state = setupLairCompany(LONELY_MOUNTAIN_HERO);
    const { state: after } = runAutoAttackCombatMulti(state, [
      { characterDefId: BALIN, roll: 12 },
    ]);
    expect(after.combat).toBeNull();
    const balinId = findCharInstanceId(after, RESOURCE_PLAYER, BALIN);
    expect(after.players[RESOURCE_PLAYER].characters[balinId].dragonAtHomeVictorySiteId).toBeUndefined();
  });

  test('defeating the augmented Smaug-at-Home attack records the victory on every company member', () => {
    const state = setupLairCompany(LONELY_MOUNTAIN_HERO, SMAUG_AT_HOME);
    // Attack 0: printed Dragon (1 strike, 14 prowess) — Balin defeats it (taps).
    const round1 = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]);
    expect(round1.state.combat).toBeNull();
    // Attack 1: augmented at-home Dragon (2 strikes, 18 prowess) — Elrond + Glorfindel II defeat it.
    const round2 = runAutoAttackCombatMulti(round1.state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]);
    expect(round2.state.combat).toBeNull();

    const after = round2.state;
    const balinId = findCharInstanceId(after, RESOURCE_PLAYER, BALIN);
    const elrondId = findCharInstanceId(after, RESOURCE_PLAYER, ELROND);
    const glorfindelId = findCharInstanceId(after, RESOURCE_PLAYER, GLORFINDEL_II);
    expect(after.players[RESOURCE_PLAYER].characters[balinId].dragonAtHomeVictorySiteId).toBe(LONELY_MOUNTAIN_HERO);
    expect(after.players[RESOURCE_PLAYER].characters[elrondId].dragonAtHomeVictorySiteId).toBe(LONELY_MOUNTAIN_HERO);
    expect(after.players[RESOURCE_PLAYER].characters[glorfindelId].dragonAtHomeVictorySiteId).toBe(LONELY_MOUNTAIN_HERO);
  });

  test('defeating the augmented Eärcaraxë-at-Home attack does NOT record a victory ("other than Eärcaraxë at Home")', () => {
    const state = setupLairCompany(ISLE_OF_THE_ULOND, EARCARAXE_AT_HOME);
    const round1 = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]);
    expect(round1.state.combat).toBeNull();
    const round2 = runAutoAttackCombatMulti(round1.state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]);
    expect(round2.state.combat).toBeNull();

    const after = round2.state;
    const balinId = findCharInstanceId(after, RESOURCE_PLAYER, BALIN);
    const elrondId = findCharInstanceId(after, RESOURCE_PLAYER, ELROND);
    expect(after.players[RESOURCE_PLAYER].characters[balinId].dragonAtHomeVictorySiteId).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].characters[elrondId].dragonAtHomeVictorySiteId).toBeUndefined();
  });

  test('playable on Balin once his company has defeated the At-Home attack', () => {
    let state = setupLairCompany(LONELY_MOUNTAIN_HERO, SMAUG_AT_HOME);
    state = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]).state;
    state = runAutoAttackCombatMulti(state, [
      { characterDefId: ELROND, roll: 12 },
      { characterDefId: GLORFINDEL_II, roll: 12 },
    ]).state;
    state = advanceToPlayResources(state);
    state = addCardToHand(state, RESOURCE_PLAYER, KING_UNDER_THE_MOUNTAIN);

    const balinId = findCharInstanceId(state, RESOURCE_PLAYER, BALIN);
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const kutmId = findHandCardId(state, RESOURCE_PLAYER, KING_UNDER_THE_MOUNTAIN);

    const plays = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action).cardInstanceId === kutmId)
      .map(a => a.action as PlayPermanentEventAction);

    expect(plays.some(a => a.targetCharacterId === balinId)).toBe(true);
    // Elrond also has the victory recorded (he was in the defending company),
    // but he is not one of the four named Dwarfs — the name filter excludes him.
    expect(plays.some(a => a.targetCharacterId === elrondId)).toBe(false);
  });

  test('NOT playable on Balin without a recorded victory', () => {
    let state = setupLairCompany(LONELY_MOUNTAIN_HERO);
    state = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]).state;
    state = addCardToHand(state, RESOURCE_PLAYER, KING_UNDER_THE_MOUNTAIN);
    const kutmId = findHandCardId(state, RESOURCE_PLAYER, KING_UNDER_THE_MOUNTAIN);

    const plays = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action).cardInstanceId === kutmId);
    expect(plays).toHaveLength(0);
  });

  // ─── Effects 2 & 3: +5 DI vs Dwarves and Dwarf factions ────────────────────

  test('+5 DI bonus applies when controlling a Dwarf follower', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: BALIN, items: [KING_UNDER_THE_MOUNTAIN] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const balinId = findCharInstanceId(state, RESOURCE_PLAYER, BALIN);
    const gimliDef = state.cardPool[GIMLI] as CharacterCard;
    // Balin printed DI 2 + his own built-in +1 vs Dwarves + King under the
    // Mountain's +5 = 8. Without the card: 2 + 1 = 3.
    expect(availableDI(state, balinId, state.players[RESOURCE_PLAYER], gimliDef)).toBe(8);
    expect(availableDI(state, balinId, state.players[RESOURCE_PLAYER])).toBe(2);
  });

  test('+5 DI bonus applies when influencing a Dwarf faction (Blue Mountain Dwarves)', () => {
    // Balin DI 2 (printed) + 1 (his own built-in vs Dwarf factions) + 5 (King
    // under the Mountain) = 8, plus the faction's own +2 dwarf-bearer check
    // bonus. Blue Mountain Dwarves influenceNumber 10 -> need = 10 - 2 - 8 = 0.
    const state = buildSitePhaseState({
      characters: [{ defId: BALIN, items: [KING_UNDER_THE_MOUNTAIN] }],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const balinId = findCharInstanceId(state, RESOURCE_PLAYER, BALIN);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);
    const attempt = influenceActions.find(a => a.influencingCharacterId === balinId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(0);
  });

  test('without King under the Mountain, need is higher (no +5 dwarf-faction DI bonus)', () => {
    // Balin DI 2 + 1 (built-in) = 3, check bonus +2 -> need = 10 - 2 - 3 = 5.
    const state = buildSitePhaseState({
      characters: [BALIN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const balinId = findCharInstanceId(state, RESOURCE_PLAYER, BALIN);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);
    const attempt = influenceActions.find(a => a.influencingCharacterId === balinId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  // ─── Effects 4-7: the site conversion (played for real) ───────────────────

  describe('playing it for real converts the Dragon-defeat site', () => {
    function playOnBalin(): { state: GameState; balinId: ReturnType<typeof findCharInstanceId> } {
      let state = setupLairCompany(LONELY_MOUNTAIN_HERO, SMAUG_AT_HOME);
      state = runAutoAttackCombatMulti(state, [{ characterDefId: BALIN, roll: 12 }]).state;
      state = runAutoAttackCombatMulti(state, [
        { characterDefId: ELROND, roll: 12 },
        { characterDefId: GLORFINDEL_II, roll: 12 },
      ]).state;
      state = advanceToPlayResources(state);
      state = addCardToHand(state, RESOURCE_PLAYER, KING_UNDER_THE_MOUNTAIN);
      const balinId = findCharInstanceId(state, RESOURCE_PLAYER, BALIN);
      const kutmId = findHandCardId(state, RESOURCE_PLAYER, KING_UNDER_THE_MOUNTAIN);
      state = playPermanentEventAndResolve(state, PLAYER_1, kutmId, balinId);
      return { state, balinId };
    }

    test('attaches to Balin as an item', () => {
      const { state, balinId } = playOnBalin();
      const balin = state.players[RESOURCE_PLAYER].characters[balinId];
      expect(balin.items.some(i => i.definitionId === KING_UNDER_THE_MOUNTAIN)).toBe(true);
    });

    test('the site becomes a Border-hold for all purposes', () => {
      const { state } = playOnBalin();
      const siteInstanceId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
      expect(getEffectiveSiteType(state, LONELY_MOUNTAIN_HERO, SiteType.RuinsAndLairs, siteInstanceId))
        .toBe(SiteType.BorderHold);
    });

    test('the site counts as a Dwarf-hold', () => {
      const { state, balinId } = playOnBalin();
      const company = state.players[RESOURCE_PLAYER].companies[0];
      const balin = state.players[RESOURCE_PLAYER].characters[balinId];
      const balinDef = state.cardPool[BALIN] as CharacterCard;
      const ctx = buildGrantActionContext(state, balin, balinDef, company) as { site?: { keywords?: readonly string[] } };
      expect(ctx.site?.keywords).toContain('dwarf-hold');
    });

    test('the site has no Dragon automatic-attacks', () => {
      // The Lonely Mountain's only automatic-attack is the Dragon itself
      // (verified in the Smaug at Home tests), so `skip-automatic-attacks` —
      // consumed by the site-phase automatic-attacks trigger
      // (reducer-site.ts) — is exactly "no Dragon automatic-attacks" here.
      const { state } = playOnBalin();
      expect(hasSiteFlag(state.activeConstraints, 'skip-automatic-attacks', LONELY_MOUNTAIN_HERO)).toBe(true);
    });

    test('only Dwarves may play items at the site', () => {
      const { state: playedState } = playOnBalin();
      const restriction = playedState.activeConstraints.filter(c => c.kind.type === 'item-play-race-restriction');
      expect(restriction).toHaveLength(1);

      // Merge the genuine constraint into a fresh play-resources-step state
      // for the same site with a non-Dwarf (Aragorn) and a Dwarf (Gimli).
      const itemState = buildSitePhaseState({
        site: LONELY_MOUNTAIN_HERO,
        characters: [ARAGORN, GIMLI],
        hand: [DAGGER_OF_WESTERNESSE],
      });
      const merged: GameState = { ...itemState, activeConstraints: [...itemState.activeConstraints, ...restriction] };
      const aragornId = findCharInstanceId(merged, RESOURCE_PLAYER, ARAGORN);
      const gimliId = findCharInstanceId(merged, RESOURCE_PLAYER, GIMLI);

      const plays = viableActionsForHandCard(merged, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE)
        .map(a => a.action as { attachToCharacterId?: string });
      expect(plays.some(a => a.attachToCharacterId === (aragornId as unknown as string))).toBe(false);
      expect(plays.some(a => a.attachToCharacterId === (gimliId as unknown as string))).toBe(true);
    });
  });
});
