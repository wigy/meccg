/**
 * @module le-348.test
 *
 * Card test: Whip (le-348)
 * Type: minion-resource-item (subtype: minor)
 * Corruption: 1, Marshalling Points: 0
 *
 * "Orc or Troll only: provides +2 direct influence against one character with
 *  a mind and prowess less than the bearer's. Cannot be duplicated on a given
 *  character."
 *
 * The bonus is a conditional direct-influence modifier in the mould of
 * Trifling Ring (le-346), with three gates on top:
 *   - bearer must be an Orc or Troll ("Orc or Troll only:"),
 *   - the target character must have a mind (avatars — mind "—" — are out),
 *   - the target's prowess must be strictly less than the bearer's
 *     (effective prowess, so weapons raising the bearer's prowess widen the
 *     Whip's reach).
 * The prowess comparison uses the condition-matcher's path operand:
 * `{ "target.prowess": { "$lt": "bearer.prowess" } }`.
 *
 * Engine support:
 * | # | Feature                                             | Status      | Notes                                                |
 * |---|-----------------------------------------------------|-------------|------------------------------------------------------|
 * | 1 | +1 corruption point to bearer                       | IMPLEMENTED | itemDef.corruptionPoints summed in recomputeDerived  |
 * | 2 | +2 DI when controlling a qualifying character       | IMPLEMENTED | stat-modifier, reason influence-check                |
 * | 3 | +2 DI when influencing an opponent's character      | IMPLEMENTED | stat-modifier, reason opponent-influence-check       |
 * | 4 | Orc/Troll bearer gate                               | IMPLEMENTED | when bearer.race $in [orc, troll]                    |
 * | 5 | Target must have a mind (no avatars)                | IMPLEMENTED | target.mind $gt 0 — ctx omits mind for avatars       |
 * | 6 | Target prowess < bearer's (strict, effective)       | IMPLEMENTED | $lt path operand vs bearer.prowess (effective)       |
 * | 7 | No bonus vs factions / allies                       | IMPLEMENTED | reason + target.kind gates                           |
 * | 8 | Cannot be duplicated on a given character           | IMPLEMENTED | duplication-limit scope:character (site.ts item play)|
 *
 * Fixture alignment: minion (ringwraith) — minion characters and sites.
 *
 * Character fixtures:
 *   - LAGDUF        (le-18): orc warrior, mind 3, prowess 5, DI 0 — main bearer
 *   - TROLL_CHIEF   (le-45): troll warrior, mind 6, prowess 6, DI 0 — troll bearer
 *   - TROLL_LOUT    (le-44): troll warrior, mind 3, prowess 4, DI 0 — spear bearer
 *   - OLD_TROLL     (le-29): troll warrior, mind 4, prowess 5, DI 0 — equal/greater-prowess target
 *   - CIRYAHER      (le-6):  dúnadan, mind 5, prowess 2, DI 2 — qualifying target / non-Orc bearer
 *   - LT_DOL_GULDUR (le-21): troll, mind 9, prowess 7 — higher-prowess target
 *   - LT_MORGUL     (le-22): troll, mind 9, prowess 8, DI 2 — bearer vs avatar
 *   - ADUNAPHEL     (le-50): Ringwraith avatar, mind —, prowess 8 — mindless target
 *   - PON_ORA_PON   (dm-22): man, mind 5, prowess 1 — low-prowess target for the race gate
 *
 * Other fixtures:
 *   - BROAD_HEADED_SPEAR (le-304): +2 prowess (warrior, max 8) — effective-prowess proof
 *   - WAR_WOLF  (le-157): minion ally — opponent-influence ally target
 *   - SNAGA_HAI (le-286): orc faction, influence# 10 — faction-influence control
 *   - MORIA (le-392) shadow-hold, MINAS_MORGUL (le-390) / DOL_GULDUR (le-367)
 *     havens, ETTENMOORS (le-373), SHREL_KAIN (le-403) border-hold [minor, major]
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  attachItemToChar, attachAllyToChar,
  findCharInstanceId, viableActions, dispatchResult,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  makeSitePhase, getCharacter, pool, buildMinionSitePhaseState,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CharacterCard, GameState } from '../../index.js';
import { Alignment } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const WHIP = 'le-348' as CardDefinitionId;

// Minion fixtures — declared locally per card-ids.ts constants policy
const LAGDUF = 'le-18' as CardDefinitionId;        // orc warrior, mind 3, prowess 5, DI 0
const TROLL_CHIEF = 'le-45' as CardDefinitionId;   // troll warrior, mind 6, prowess 6, DI 0
const TROLL_LOUT = 'le-44' as CardDefinitionId;    // troll warrior, mind 3, prowess 4, DI 0
const OLD_TROLL = 'le-29' as CardDefinitionId;     // troll warrior, mind 4, prowess 5, DI 0
const CIRYAHER = 'le-6' as CardDefinitionId;       // dúnadan, mind 5, prowess 2, DI 2
const LT_DOL_GULDUR = 'le-21' as CardDefinitionId; // troll, mind 9, prowess 7, DI 3
const LT_MORGUL = 'le-22' as CardDefinitionId;     // troll, mind 9, prowess 8, DI 2
const ADUNAPHEL = 'le-50' as CardDefinitionId;     // Ringwraith avatar, mind —, prowess 8
const PON_ORA_PON = 'dm-22' as CardDefinitionId;   // minion man, mind 5, prowess 1

const BROAD_HEADED_SPEAR = 'le-304' as CardDefinitionId; // +2 prowess (warrior, max 8)
const WAR_WOLF = 'le-157' as CardDefinitionId;           // minion ally
const SNAGA_HAI = 'le-286' as CardDefinitionId;          // orc faction, influence# 10

const ORC_CAPTAIN = 'le-31' as CardDefinitionId;         // orc leader, mind 5, prowess 5, DI 0 — +3 DI vs Orcs/Orc factions
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;     // orc warrior, mind 2, prowess 3, DI 0
const BLAZON_OF_THE_EYE = 'le-302' as CardDefinitionId;  // +2 DI vs factions
const ORCS_OF_UDUN = 'le-282' as CardDefinitionId;       // orc faction, influence# 9, playable at Cirith Gorgor
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;      // dark-hold — Orcs of Udûn's home site

const MORIA = 'le-392' as CardDefinitionId;        // shadow-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // haven
const ETTENMOORS = 'le-373' as CardDefinitionId;   // ruins-and-lairs
const SHREL_KAIN = 'le-403' as CardDefinitionId;   // border-hold, [minor, major]

describe('Whip (le-348)', () => {
  beforeEach(() => resetMint());

  // ─── +1 corruption on bearer (structural) ─────────────────────────────────

  test('bearer gains +1 effective corruption point while the Whip is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    expect(getCharacter(base, RESOURCE_PLAYER, LAGDUF).effectiveStats.corruptionPoints).toBe(0);

    const withWhip = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, LAGDUF, WHIP));
    expect(getCharacter(withWhip, RESOURCE_PLAYER, LAGDUF).effectiveStats.corruptionPoints).toBe(1);
  });

  // ─── Conditional bonus — NOT a blanket boost to the DI stat ───────────────

  test('effective direct influence is unchanged by the Whip (conditional, not a stat boost)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, LAGDUF).effectiveStats.directInfluence).toBe(0);
  });

  // ─── +2 DI when controlling a qualifying character ────────────────────────

  test('+2 DI for an Orc bearer against a character with a mind and lower prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const ciryaherDef = pool[CIRYAHER as string] as CharacterCard;

    // Ciryaher: mind 5 (> 0) and prowess 2 < Lagduf's 5 → base DI 0 + 2 = 2.
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER], ciryaherDef)).toBe(2);
    // No specific target → conditional bonus cannot fire: base DI 0.
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER])).toBe(0);
  });

  test('+2 DI for a Troll bearer against the same qualifying character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: TROLL_CHIEF, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);
    const ciryaherDef = pool[CIRYAHER as string] as CharacterCard;
    // Ciryaher prowess 2 < Troll-chief's 6 → base DI 0 + 2 = 2.
    expect(availableDI(state, chiefId, state.players[RESOURCE_PLAYER], ciryaherDef)).toBe(2);
  });

  test('no bonus without the Whip', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const ciryaherDef = pool[CIRYAHER as string] as CharacterCard;
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER], ciryaherDef)).toBe(0);
  });

  // ─── Gate: "Orc or Troll only" ────────────────────────────────────────────

  test('a non-Orc/Troll bearer gets no bonus even against a qualifying target', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: CIRYAHER, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    // Pôn-ora-Pôn: mind 5 (> 0), prowess 1 < Ciryaher's 2 — target qualifies,
    // but Ciryaher is a Dúnadan, so only his base DI 2 is available.
    const targetDef = pool[PON_ORA_PON as string] as CharacterCard;
    expect(availableDI(state, ciryaherId, state.players[RESOURCE_PLAYER], targetDef)).toBe(2);
  });

  // ─── Gate: target prowess strictly less than the bearer's ─────────────────

  test('no bonus against a character with higher prowess than the bearer', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    // Lieutenant of Dol Guldur: mind 9 but prowess 7 > Lagduf's 5 → no bonus.
    const targetDef = pool[LT_DOL_GULDUR as string] as CharacterCard;
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER], targetDef)).toBe(0);
  });

  test('no bonus against a character with prowess equal to the bearer\'s (strictly less required)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: LAGDUF, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    // Old Troll: mind 4 but prowess 5 = Lagduf's 5 → "less than" fails.
    const targetDef = pool[OLD_TROLL as string] as CharacterCard;
    expect(availableDI(state, lagdufId, state.players[RESOURCE_PLAYER], targetDef)).toBe(0);
  });

  test('the prowess comparison uses the bearer\'s EFFECTIVE prowess (weapon widens the Whip\'s reach)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: TROLL_LOUT, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const loutId = findCharInstanceId(base, RESOURCE_PLAYER, TROLL_LOUT);
    const targetDef = pool[OLD_TROLL as string] as CharacterCard;

    // Troll Lout printed prowess 4 < Old Troll's 5 → no bonus yet.
    expect(availableDI(base, loutId, base.players[RESOURCE_PLAYER], targetDef)).toBe(0);

    // Broad-headed Spear: +2 prowess (warrior) → effective prowess 6 > 5.
    const withSpear = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, TROLL_LOUT, BROAD_HEADED_SPEAR));
    expect(getCharacter(withSpear, RESOURCE_PLAYER, TROLL_LOUT).effectiveStats.prowess).toBe(6);
    expect(availableDI(withSpear, loutId, withSpear.players[RESOURCE_PLAYER], targetDef)).toBe(2);
  });

  // ─── Gate: target must have a mind (avatars excluded) ─────────────────────

  test('no bonus against a Ringwraith avatar (no mind)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: LT_MORGUL, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const ltId = findCharInstanceId(state, RESOURCE_PLAYER, LT_MORGUL);
    // Adûnaphel has no mind (mind "—"): the resolver context omits `mind`,
    // so the `target.mind > 0` gate fails → only the Lieutenant's base DI 2.
    const targetDef = pool[ADUNAPHEL as string] as CharacterCard;
    expect(availableDI(state, ltId, state.players[RESOURCE_PLAYER], targetDef)).toBe(2);
  });

  // ─── +2 DI when influencing an opponent's character ───────────────────────

  test('+2 DI on an opponent-influence attempt against a qualifying character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const ciryaherId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);

    const attempt = firstOpponentInfluenceAttempt(state, ciryaherId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('character');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Ciryaher: mind 5, prowess 2 < Lagduf's 5 → base DI 0 + 2 = 2.
    expect(pending.kind.attempt.influencerDI).toBe(2);
  });

  test('no +2 DI on an opponent-influence attempt against an ally (not a character)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [WHIP] }] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = attachAllyToChar(state, HAZARD_PLAYER, CIRYAHER, WAR_WOLF);
    const ciryaherId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);
    const allyId = state.players[HAZARD_PLAYER].characters[ciryaherId].allies[0].instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, allyId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('ally');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    expect(pending.kind.attempt.influencerDI).toBe(0);
  });

  // ─── No bonus to a faction-influence roll ─────────────────────────────────

  test('no +2 DI to a faction-influence attempt (bringing a faction under control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [WHIP] }] }], hand: [SNAGA_HAI], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    // influence# 10, Lagduf DI 0, Whip gives NO faction bonus → need = 10.
    expect(attempt!.need).toBe(10);
  });

  // ─── Whip discount frees DI already spent on a qualifying follower ────────

  test('a follower matching the Whip\'s conditions costs discounted DI to retain, freeing DI for a later faction-influence attempt (regression — Orc-Captain + Blazon of the Eye + Whip + Orcs of Udûn, game mt0g5tyu-v2y1js seq 538)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: CIRITH_GORGOR,
            characters: [
              { defId: ORC_CAPTAIN, items: [BLAZON_OF_THE_EYE, WHIP] },
              { defId: CROOK_LEGGED_ORC, followerOf: 0 },
            ],
          }],
          hand: [ORCS_OF_UDUN],
          siteDeck: [ETTENMOORS],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    // Orc Captain's own +3 (vs Orc factions) and Blazon of the Eye's +2 give
    // a +5 DI bonus toward the influence# 9 check. Crook-legged Orc (mind 2,
    // prowess 3 < Orc Captain's 5) qualifies for the Whip's target-conditional
    // +2 DI, so keeping him under control should cost Orc Captain 0 DI, not
    // his full mind of 2 — need = 9 - 5 = 4. Before the fix, followers' mind
    // was always charged in full regardless of the Whip, driving Orc
    // Captain's available DI to -2 and inflating the need to 6 — exactly
    // what stranded the real influence roll of 5 in game mt0g5tyu-v2y1js.
    expect(attempt!.need).toBe(4);
  });

  // ─── Duplication: cannot be duplicated on a given character ───────────────

  test('a second Whip cannot be played on a character who already bears one, but can on another', () => {
    const state = buildMinionSitePhaseState({
      site: SHREL_KAIN,
      characters: [{ defId: LAGDUF, items: [WHIP] }, TROLL_CHIEF],
      hand: [WHIP],
    });
    const whipInHand = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === WHIP)!.instanceId;
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const chiefId = findCharInstanceId(state, RESOURCE_PLAYER, TROLL_CHIEF);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === whipInHand,
    );
    const targets = plays.map(a => (a.action as { attachToCharacterId?: CardInstanceId }).attachToCharacterId);
    expect(targets).not.toContain(lagdufId);
    expect(targets).toContain(chiefId);
  });

  test('a Whip is playable on a character who bears none', () => {
    const state = buildMinionSitePhaseState({
      site: SHREL_KAIN,
      characters: [LAGDUF],
      hand: [WHIP],
    });
    const whipInHand = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === WHIP)!.instanceId;
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource').filter(
      a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === whipInHand,
    );
    const targets = plays.map(a => (a.action as { attachToCharacterId?: CardInstanceId }).attachToCharacterId);
    expect(targets).toContain(lagdufId);
  });
});
