/**
 * @module wh-51.test
 *
 * Card test: Blasting Fire (wh-51)
 * Type: minion-resource-item (subtype "special", keyword Technology)
 * Effects: 2 (item-play-site, grant-action)
 *
 * "Technology. Playable at a tapped or untapped Shadow-hold [{S}],
 *  Dark-hold [{D}], or a site with a Dwarf automatic-attack. Discard to
 *  cancel all automatic-attacks at a site against the bearer's company,
 *  any influence attempts against factions at the site this turn are
 *  modified by +2."
 *
 * | # | Effect Type    | Status | Notes                                                |
 * |---|----------------|--------|------------------------------------------------------|
 * | 1 | item-play-site | OK     | filter: shadow-hold / dark-hold / Dwarf auto-attack; |
 * |   |                |        | allowTapped bypasses the tapped-site gate            |
 * | 2 | grant-action   | OK     | activeSitePhase discard → skip-automatic-attacks +   |
 * |   |                |        | influence-at-site-modifier (+2) constraints          |
 *
 * Playable: YES
 *
 * Fixtures are minion (ringwraith) sites, characters, and factions:
 *  - Goblin-gate (le-378): shadow-hold with an Orcs automatic-attack and
 *    the Goblins of Goblin-gate faction (le-265) playable there.
 *  - Cirith Gorgor (le-361): dark-hold.
 *  - Easterling Camp (le-371): border-hold (no Dwarf auto-attack) — the
 *    play restriction must reject it.
 *  - A synthetic ruins-and-lairs site with a Dwarves automatic-attack
 *    isolates the "site with a Dwarf automatic-attack" clause (no real
 *    site in the pool carries a Dwarf auto-attack).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  buildSitePhaseState, buildTestState, resetMint, recomputeDerived,
  viableActions, viableActionsForHandCard, attachItemToChar, getCharacter,
  findCharInstanceId, findHandCardId, companyIdAt, dispatch, phaseStateAs,
  pool, LORIEN, MORIA, MINAS_TIRITH, LEGOLAS,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, SitePhaseState, SiteCard,
  InfluenceAttemptAction, ActivateGrantedAction,
} from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const BLASTING_FIRE = 'wh-51' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;     // shadow-hold, Orcs auto-attack
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;   // dark-hold
const EASTERLING_CAMP = 'le-371' as CardDefinitionId; // border-hold (no Dwarf AA)
const GOBLINS = 'le-265' as CardDefinitionId;         // faction playable at Goblin-gate
const ASTERNAK = 'le-1' as CardDefinitionId;          // minion character (man, DI 2)
const TEST_DWARF_LAIR = 'test-dwarf-lair' as CardDefinitionId;

/** A play-resources SitePhaseState for the active company (index 0). */
const PLAY_RESOURCES_STEP: SitePhaseState = {
  phase: Phase.Site,
  step: 'play-resources',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: true,
  resourcePlayed: false,
  minorItemAvailable: false,
  hoardBountyAvailable: false,
  thoroughSearchAvailable: false,
  declaredAgentAttack: null,
  automaticAttacksResolved: 0,
  awaitingOnGuardReveal: false,
  pendingResourceAction: null,
  opponentInteractionThisTurn: null,
  pendingOpponentInfluence: null,
};

/** An enter-or-skip SitePhaseState for the active company (index 0). */
const ENTER_OR_SKIP_STEP: SitePhaseState = {
  ...PLAY_RESOURCES_STEP,
  step: 'enter-or-skip',
  siteEntered: false,
};

describe('Blasting Fire (wh-51)', () => {
  beforeEach(() => resetMint());

  // ─── Card stat: corruption points ────────────────────────────────────────────

  test('bearing Blasting Fire adds 1 corruption point to the bearer', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ASTERNAK, BLASTING_FIRE));

    expect(getCharacter(withItem, RESOURCE_PLAYER, ASTERNAK).effectiveStats.corruptionPoints).toBe(1);
  });

  // ─── Effect 1: item-play-site playability ────────────────────────────────────

  test('playable at an untapped Shadow-hold', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [BLASTING_FIRE],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLASTING_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a TAPPED Shadow-hold (allowTapped bypasses the tapped-site gate)', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [BLASTING_FIRE],
      siteStatus: CardStatus.Tapped,
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLASTING_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a Dark-hold', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: CIRITH_GORGOR,
      hand: [BLASTING_FIRE],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLASTING_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Border-hold without a Dwarf automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: EASTERLING_CAMP,
      hand: [BLASTING_FIRE],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLASTING_FIRE);
    expect(offered).toHaveLength(0);

    // And it is explicitly reported as not playable due to the restriction.
    const notPlayable = computeLegalActions(state, PLAYER_1).filter(
      a => !a.viable && a.reason?.includes('play restriction'),
    );
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a (non-hold) site with a Dwarf automatic-attack', () => {
    // No real site in the pool carries a Dwarf auto-attack, so synthesise a
    // ruins-and-lairs site (NOT a shadow/dark-hold) with a Dwarves attack to
    // isolate the "site with a Dwarf automatic-attack" clause.
    const realSite = pool[GOBLIN_GATE as string] as SiteCard;
    const dwarfLair = {
      ...realSite,
      id: TEST_DWARF_LAIR,
      name: 'Test Dwarf Lair',
      siteType: 'ruins-and-lairs',
      automaticAttacks: [{ creatureType: 'Dwarves', strikes: 1, prowess: 8 }],
      effects: [],
    } as unknown as SiteCard;

    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: TEST_DWARF_LAIR, characters: [ASTERNAK] }], hand: [BLASTING_FIRE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = {
      ...base,
      cardPool: { ...base.cardPool, [TEST_DWARF_LAIR as string]: dwarfLair },
      phaseState: PLAY_RESOURCES_STEP,
    };

    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, BLASTING_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Effect 2: discard grant-action ──────────────────────────────────────────

  test('discard ability is offered at the enter-or-skip step while borne', () => {
    let state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = { ...attachItemToChar(state, RESOURCE_PLAYER, ASTERNAK, BLASTING_FIRE), phaseState: ENTER_OR_SKIP_STEP };

    const discard = viableActions(state, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'blasting-fire-discard',
    );
    expect(discard).toHaveLength(1);
  });

  test('discarding cancels the automatic-attacks and adds the +2 influence constraint', () => {
    let state = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = { ...attachItemToChar(state, RESOURCE_PLAYER, ASTERNAK, BLASTING_FIRE), phaseState: ENTER_OR_SKIP_STEP };

    const cid = companyIdAt(state, RESOURCE_PLAYER);

    // Baseline: WITHOUT the discard, entering Goblin-gate (Orcs auto-attack)
    // advances to the on-guard reveal step (attacks will be faced).
    const enteredBaseline = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect(phaseStateAs<SitePhaseState>(enteredBaseline).step).toBe('reveal-on-guard-attacks');

    // Activate the discard ability.
    const discardAction = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'blasting-fire-discard',
    );
    expect(discardAction).toBeDefined();
    const afterDiscard = dispatch(state, discardAction!.action);

    // The item is discarded (no longer borne; in the owner's discard pile).
    const asternakId = findCharInstanceId(afterDiscard, RESOURCE_PLAYER, ASTERNAK);
    const asternak = afterDiscard.players[RESOURCE_PLAYER].characters[asternakId];
    expect(asternak.items.some(i => i.definitionId === BLASTING_FIRE)).toBe(false);
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BLASTING_FIRE)).toBe(true);

    // skip-automatic-attacks constraint for Goblin-gate exists.
    const skipAA = afterDiscard.activeConstraints.find(
      c => c.kind.type === 'site-flag'
        && c.kind.flag === 'skip-automatic-attacks'
        && c.kind.siteDefinitionId === GOBLIN_GATE,
    );
    expect(skipAA).toBeDefined();

    // influence-at-site-modifier constraint (+2) for Goblin-gate exists.
    const infMod = afterDiscard.activeConstraints.find(
      c => c.kind.type === 'influence-at-site-modifier'
        && c.kind.siteDefinitionId === GOBLIN_GATE,
    );
    expect(infMod).toBeDefined();
    expect(infMod!.kind.type === 'influence-at-site-modifier' && infMod!.kind.value).toBe(2);

    // Entering the site now skips the automatic-attacks entirely.
    const enteredAfter = dispatch(afterDiscard, { type: 'enter-site', player: PLAYER_1, companyId: cid });
    expect(phaseStateAs<SitePhaseState>(enteredAfter).step).toBe('declare-agent-attack');
  });

  // ─── Effect 2 (cont.): the +2 influence modifier is applied at the site ──────

  test('influence-at-site-modifier reduces the influence need by 2 at the site', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [GOBLINS],
    });
    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, GOBLINS);
    const cid = companyIdAt(state, RESOURCE_PLAYER);

    const needBefore = (computeLegalActions(state, PLAYER_1)
      .map(a => a.action)
      .find(
        (a): a is InfluenceAttemptAction =>
          a.type === 'influence-attempt'
          && (a).influencingCharacterId === asternakId
          && (a).factionInstanceId === factionId,
      ))?.need;
    expect(needBefore).toBeDefined();

    const withMod = addConstraint(state, {
      source: 'blasting-fire-src' as CardInstanceId,
      sourceDefinitionId: BLASTING_FIRE,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: cid },
      kind: { type: 'influence-at-site-modifier', siteDefinitionId: GOBLIN_GATE, value: 2 },
    });

    const needAfter = (computeLegalActions(withMod, PLAYER_1)
      .map(a => a.action)
      .find(
        (a): a is InfluenceAttemptAction =>
          a.type === 'influence-attempt'
          && (a).influencingCharacterId === asternakId
          && (a).factionInstanceId === factionId,
      ))?.need;
    expect(needAfter).toBeDefined();

    // +2 to the roll means the required roll drops by 2.
    expect(needAfter).toBe(needBefore! - 2);
  });

  test('influence-at-site-modifier does NOT apply at a different site', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [GOBLINS],
    });
    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const cid = companyIdAt(state, RESOURCE_PLAYER);

    const needBefore = (computeLegalActions(state, PLAYER_1)
      .map(a => a.action)
      .find(
        (a): a is InfluenceAttemptAction =>
          a.type === 'influence-attempt'
          && (a).influencingCharacterId === asternakId,
      ))?.need;

    // Constraint keyed to a DIFFERENT site (Cirith Gorgor) must not affect
    // influence attempts at Goblin-gate.
    const withMod = addConstraint(state, {
      source: 'blasting-fire-src' as CardInstanceId,
      sourceDefinitionId: BLASTING_FIRE,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: cid },
      kind: { type: 'influence-at-site-modifier', siteDefinitionId: CIRITH_GORGOR, value: 2 },
    });

    const needAfter = (computeLegalActions(withMod, PLAYER_1)
      .map(a => a.action)
      .find(
        (a): a is InfluenceAttemptAction =>
          a.type === 'influence-attempt'
          && (a).influencingCharacterId === asternakId,
      ))?.need;

    expect(needAfter).toBe(needBefore);
  });
});
