/**
 * @module as-132.test
 *
 * Card test: Thong of Fire (as-132)
 * Type: minion-resource-item (Greater Item), alignment ringwraith, unique.
 * Marshalling points: 3 · Corruption: 3. Keywords: hoard, weapon.
 *
 * Text: "Unique. Hoard item. Weapon. May only be borne by a character with a
 * prowess of 6 or more. Warrior only: +1 body; +1 prowess; if bearer chooses
 * not to tap against a strike, he receives no prowess penalty."
 *
 * Rules & engine support:
 * | # | Rule                                              | Status      | Mechanism                                                        |
 * |---|---------------------------------------------------|-------------|------------------------------------------------------------------|
 * | 1 | Unique                                            | IMPLEMENTED | `unique: true` — the site item emitter blocks a second copy       |
 * | 2 | Hoard item (playable only at a site with a hoard) | IMPLEMENTED | `item-play-site` filter `site.keywords $includes "hoard"`         |
 * | 3 | Weapon                                            | IMPLEMENTED | `weapon` keyword → rule 9.15 one-weapon-in-use slot (item-slots)  |
 * | 4 | Only a bearer with prowess 6 or more              | IMPLEMENTED | `play-target` character filter `target.prowess $gte 6`            |
 * | 5 | Warrior only: +1 body                             | IMPLEMENTED | `stat-modifier` body +1, `when bearer.skills $includes warrior`   |
 * | 6 | Warrior only: +1 prowess                          | IMPLEMENTED | `stat-modifier` prowess +1, same warrior gate                     |
 * | 7 | Warrior only: no prowess penalty when not tapping | IMPLEMENTED | `stat-modifier` `untap-penalty` `op: "set"` `value: 0`, warrior gate |
 *
 * Playable: YES — CERTIFIED.
 *
 * Modeling notes:
 *  - Rule 2: the `item-play-site` hoard restriction is an *addition* to the
 *    site's `playableResources` gate, not a replacement (METD Hoards: a hoard
 *    item "may only be played at a site that contains a hoard" — a
 *    restriction, never a grant). So this **greater** item needs a hoard site
 *    that also lists greater items (e.g. Dancing Spire as-143); Ovir Hollow
 *    (as-157, minor/major only) refuses it even though it has a hoard. A
 *    Ruins & Lairs that does list greater items but has no hoard (The
 *    Pûkel-deeps as-158, keyword `under-deeps` rather than `hoard`) is also
 *    refused. Every Dragon's-lair Ruins & Lairs (including the minion ones,
 *    e.g. Dancing Spire as-143) carries the `hoard` keyword per CoE g.hoa.1.
 *  - Rule 4 reads the candidate's **effective** prowess (printed + modifiers
 *    from cards already borne). The item being played is not attached yet, so
 *    its own warrior bonus never feeds its own gate.
 *  - Rule 7 is the new mechanic: `stat-modifier` gained the synthetic stat
 *    `untap-penalty`, resolved by `computeStayUntappedPenalty`
 *    (`recompute-derived.ts`) on top of the CoE 3.iv.3 base of 3 (1 for The
 *    Balrog avatar). It feeds both the tap/untap "need" offered by the
 *    legal-action computer and the reducer's strike resolution.
 *
 * Fixture alignment: minion (ringwraith) throughout.
 *  - LIEUTENANT_OF_MORGUL (le-22): troll warrior/ranger, prowess 8, body 9 — eligible warrior bearer
 *  - ULKAUR (le-49):              troll warrior, prowess 6, body 9 — boundary bearer (exactly 6)
 *  - ORC_CAPTAIN (le-31):         orc warrior, prowess 5, body 8 — ineligible bearer
 *  - REN (le-56):                 Ringwraith avatar, prowess 8, body 10, NO warrior skill
 *  - OVIR_HOLLOW (as-157):        minion Ruins & Lairs *with a hoard*
 *  - THE_PUKEL_DEEPS (as-158):    minion Ruins & Lairs, no hoard (lists greater items)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, recomputeDerived, getCharacter, attachItemToChar,
  findCharInstanceId, findHandCardId, companyIdAt, executeAction,
  makeShadowMHState, viableActions,
} from '../test-helpers.js';
import { computeLegalActions, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameState,
  PlayHeroResourceAction, ResolveStrikeAction, SitePhaseState,
} from '../../index.js';

const THONG_OF_FIRE = 'as-132' as CardDefinitionId;
const ANCIENT_BLACK_AXE = 'as-122' as CardDefinitionId; // the other minion weapon (warrior +3 prowess)
const ILL_REPORT_YOU = 'le-196' as CardDefinitionId;    // +1 prowess to the whole company

// Minion characters.
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId; // warrior/ranger, prowess 8, body 9
const ULKAUR = 'le-49' as CardDefinitionId;               // warrior, prowess 6, body 9
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;          // warrior, prowess 5, body 8
const REN = 'le-56' as CardDefinitionId;                  // no warrior skill, prowess 8, body 10

// Sites.
const OVIR_HOLLOW = 'as-157' as CardDefinitionId;   // minion R&L WITH a hoard (minor/major only)
const DANCING_SPIRE = 'as-143' as CardDefinitionId; // minion R&L Dragon's lair (hoard)
const THE_PUKEL_DEEPS = 'as-158' as CardDefinitionId; // minion R&L, no hoard (lists greater items)
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion Darkhaven
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;  // hero site for the opposing player
const TW_RIVENDELL = 'tw-404' as CardDefinitionId;

// A real Orc hazard creature so a defeated creature has somewhere to go.
const ORC_WARBAND = 'tw-076' as CardDefinitionId;
const ORC_CREATURE_ID = 'orc-creature-1' as CardInstanceId;

/** The Orc strike the bearer faces in the combat fixtures below. */
const STRIKE_PROWESS = 11;

const SITE_PHASE: SitePhaseState = {
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

/** Minion company at `site` holding a Thong of Fire in hand, in its site phase. */
function sitePhaseWith(site: CardDefinitionId, ...characters: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters }], hand: [THONG_OF_FIRE], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
    ],
  });
  return { ...base, phaseState: SITE_PHASE };
}

/** Character instance IDs the Thong of Fire in hand may legally be played on. */
function eligibleBearers(state: GameState): CardInstanceId[] {
  const handCopy = findHandCardId(state, RESOURCE_PLAYER, THONG_OF_FIRE);
  return computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable && ea.action.type === 'play-hero-resource'
      && (ea.action).cardInstanceId === handCopy)
    .map(ea => (ea.action as PlayHeroResourceAction).attachToCharacterId as CardInstanceId);
}

/** Minion company at a Darkhaven, for pure effective-stat assertions. */
function orgBase(bearerDefId: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [bearerDefId] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
}

/**
 * An M/H creature combat in which a single Orc strike of prowess 11 is
 * pre-assigned to `bearerDefId`, poised at `resolve-strike`. `items` are
 * attached in the given order (which decides the weapon slot, rule 9.15).
 */
function strikeCombat(bearerDefId: CardDefinitionId, items: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: bearerDefId, items }] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
  const bearerId = findCharInstanceId(base, RESOURCE_PLAYER, bearerDefId);
  const companyId = companyIdAt(base, RESOURCE_PLAYER);

  const withCreature = {
    ...base.players[HAZARD_PLAYER],
    cardsInPlay: [
      ...base.players[HAZARD_PLAYER].cardsInPlay,
      { instanceId: ORC_CREATURE_ID, definitionId: ORC_WARBAND, status: CardStatus.Untapped },
    ],
  };
  const players: typeof base.players = [base.players[RESOURCE_PLAYER], withCreature];

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: ORC_CREATURE_ID },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: STRIKE_PROWESS,
    creatureBody: 9,
    creatureRace: Race.Orc,
    strikeAssignments: [{ characterId: bearerId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { ...base, players, phaseState: makeShadowMHState(), combat };
}

/** The roll the defender needs, for the tap-to-fight and stay-untapped options. */
function strikeNeeds(state: GameState): { tap: number; untap: number | undefined } {
  const actions = viableActions(state, PLAYER_1, 'resolve-strike')
    .map(ea => ea.action as ResolveStrikeAction);
  return {
    tap: actions.find(a => a.tapToFight)!.need,
    untap: actions.find(a => !a.tapToFight)?.need,
  };
}

describe('Thong of Fire (as-132)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: hoard item — only at a site that contains a hoard ─────────────

  test('not playable at a hoard site whose playableResources excludes greater items', () => {
    // Ovir Hollow's playableResources are minor + major; Thong of Fire is a
    // GREATER item. The `item-play-site` hoard restriction adds the hoard
    // requirement on top of the site's tier gate — it does not replace it.
    const state = sitePhaseWith(OVIR_HOLLOW, LIEUTENANT_OF_MORGUL);
    expect(eligibleBearers(state)).toHaveLength(0);
  });

  test('not playable at a Ruins & Lairs without a hoard, even one that allows greater items', () => {
    // The Pûkel-deeps lists minor/major/greater/gold-ring but has no hoard
    // (its keyword is `under-deeps`, not `hoard`).
    const state = sitePhaseWith(THE_PUKEL_DEEPS, LIEUTENANT_OF_MORGUL);
    expect(eligibleBearers(state)).toHaveLength(0);
  });

  test('playable at a minion Dragon-lair Ruins & Lairs (hoard keyword, per CoE g.hoa.1)', () => {
    // Regression test: Dancing Spire (as-143) has a permanent Dragon
    // automatic-attack and must carry the `hoard` keyword like its hero-side
    // counterpart (tw-383), so hoard items are playable there too.
    const state = sitePhaseWith(DANCING_SPIRE, LIEUTENANT_OF_MORGUL);
    const lieutenant = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    expect(eligibleBearers(state)).toContain(lieutenant);
  });

  // ── Rule 4: may only be borne by a character with prowess 6 or more ───────

  test('a prowess-8 warrior is an eligible bearer; a prowess-5 warrior in the same company is not', () => {
    const state = sitePhaseWith(DANCING_SPIRE, LIEUTENANT_OF_MORGUL, ORC_CAPTAIN);
    const lieutenant = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    const captain = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const bearers = eligibleBearers(state);
    expect(bearers).toContain(lieutenant);
    expect(bearers).not.toContain(captain);
  });

  test('prowess exactly 6 qualifies (the boundary is "6 or more")', () => {
    const state = sitePhaseWith(DANCING_SPIRE, ULKAUR);
    const ulkaur = findCharInstanceId(state, RESOURCE_PLAYER, ULKAUR);
    expect(eligibleBearers(state)).toContain(ulkaur);
  });

  test('the gate reads EFFECTIVE prowess: a prowess-5 warrior boosted to 6 becomes eligible', () => {
    // I'll Report You (le-196) gives +1 prowess to every character in the
    // company, lifting Orc Captain's effective prowess from 5 to 6.
    const base = sitePhaseWith(DANCING_SPIRE, ORC_CAPTAIN);
    expect(eligibleBearers(base)).toHaveLength(0);

    const boosted = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ORC_CAPTAIN, ILL_REPORT_YOU));
    const captain = findCharInstanceId(boosted, RESOURCE_PLAYER, ORC_CAPTAIN);
    expect(getCharacter(boosted, RESOURCE_PLAYER, ORC_CAPTAIN).effectiveStats.prowess).toBe(6);
    expect(eligibleBearers(boosted)).toContain(captain);
  });

  // ── Rules 5 & 6: warrior only — +1 prowess, +1 body ───────────────────────

  test('a warrior bearer gains +1 prowess and +1 body', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(LIEUTENANT_OF_MORGUL), RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL, THONG_OF_FIRE));
    const lieutenant = getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    expect(lieutenant.effectiveStats.prowess).toBe(9); // 8 + 1
    expect(lieutenant.effectiveStats.body).toBe(10);   // 9 + 1
  });

  test('a non-warrior bearer gains neither prowess nor body', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(REN), RESOURCE_PLAYER, REN, THONG_OF_FIRE));
    const ren = getCharacter(state, RESOURCE_PLAYER, REN);
    expect(ren.effectiveStats.prowess).toBe(8);  // unchanged
    expect(ren.effectiveStats.body).toBe(10);    // unchanged
  });

  // ── Rule 7: warrior only — no prowess penalty when not tapping ────────────

  test('a warrior bearer needs the same roll whether he taps or stays untapped', () => {
    const state = strikeCombat(LIEUTENANT_OF_MORGUL, [THONG_OF_FIRE]);
    // Prowess 8 + 1 = 9 in both modes; the stay-untapped penalty is cancelled.
    // need = max(2, 11 - 9 + 1) = 3 either way.
    expect(strikeNeeds(state)).toEqual({ tap: 3, untap: 3 });
  });

  test('without the Thong the same warrior pays the standard -3 to stay untapped', () => {
    const state = strikeCombat(LIEUTENANT_OF_MORGUL, []);
    // Tap: prowess 8 → need max(2, 11-8+1) = 4. Untap: 8-3 = 5 → need 7.
    expect(strikeNeeds(state)).toEqual({ tap: 4, untap: 7 });
  });

  test('a non-warrior bearer still pays the full -3 (warrior gate)', () => {
    const state = strikeCombat(REN, [THONG_OF_FIRE]);
    // Ren gains no +1, and the untap-penalty cancellation is warrior-gated.
    expect(strikeNeeds(state)).toEqual({ tap: 4, untap: 7 });
  });

  test('the warrior bearer parries a strike while staying untapped that he would fail without the Thong', () => {
    const withThong = executeAction(strikeCombat(LIEUTENANT_OF_MORGUL, [THONG_OF_FIRE]), PLAYER_1, 'resolve-strike', 3, /* tapToFight */ false);
    // 3 + 9 = 12 > 11 → the strike is defeated and he is still untapped.
    expect(withThong.combat!.bodyCheckTarget).toBe('creature');
    expect(getCharacter(withThong, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL).status).toBe(CardStatus.Untapped);

    const without = executeAction(strikeCombat(LIEUTENANT_OF_MORGUL, []), PLAYER_1, 'resolve-strike', 3, /* tapToFight */ false);
    // 3 + (8 - 3) = 8 < 11 → the strike succeeds and he is wounded.
    expect(without.combat!.bodyCheckTarget).toBe('character');
    expect(getCharacter(without, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL).status).toBe(CardStatus.Inverted);
  });

  // ── Rule 3: Weapon — only one weapon is in use (rule 9.15) ────────────────

  test('a second weapon carried ahead of the Thong silences all of its effects', () => {
    // Ancient Black Axe (also a weapon) is borne first, so it fills the weapon
    // slot: the Thong grants no prowess, no body and no penalty relief.
    const state = strikeCombat(LIEUTENANT_OF_MORGUL, [ANCIENT_BLACK_AXE, THONG_OF_FIRE]);
    const lieutenant = getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    expect(lieutenant.effectiveStats.prowess).toBe(11); // 8 + 3 from the Axe only
    expect(lieutenant.effectiveStats.body).toBe(9);     // no Thong +1
    // Tap: need max(2, 11-11+1) = 2. Untap: 11-3 = 8 → need max(2, 11-8+1) = 4.
    expect(strikeNeeds(state)).toEqual({ tap: 2, untap: 4 });
  });

  test('with the Thong carried first it is the weapon in use and the Axe is silenced', () => {
    const state = strikeCombat(LIEUTENANT_OF_MORGUL, [THONG_OF_FIRE, ANCIENT_BLACK_AXE]);
    const lieutenant = getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    expect(lieutenant.effectiveStats.prowess).toBe(9); // 8 + 1 from the Thong only
    expect(lieutenant.effectiveStats.body).toBe(10);
    expect(strikeNeeds(state)).toEqual({ tap: 3, untap: 3 });
  });

  // ── Rule 1: unique ───────────────────────────────────────────────────────

  test('a second copy cannot be played while one is already in play', () => {
    const base = sitePhaseWith(DANCING_SPIRE, LIEUTENANT_OF_MORGUL, ULKAUR);
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL, THONG_OF_FIRE));
    // Ulkaur (prowess 6) would otherwise be an eligible bearer.
    expect(eligibleBearers(state)).toHaveLength(0);
  });
});
