/**
 * @module wh-54.test
 *
 * Card test: Vile Fumes (wh-54)
 * Type: minion-resource-item (subtype: Special Item; keyword: Technology)
 * Corruption: 1 · Marshalling points: 1 (item)
 *
 * Card text:
 *   "Technology. Playable at a tapped or untapped Shadow-hold [{S}],
 *    Dark-hold [{D}], or a site with a Dwarf automatic-attack. Discard
 *    during the site phase at a Border-hold [{B}] or Shadow-hold [{S}]
 *    to make all versions of the site Ruins & Lairs [{R}]. Its normal
 *    automatic-attacks are replaced with: Gas — each character faces 1
 *    strike with 7 prowess (cannot be canceled). Keep Vile Fumes with
 *    the site until the site is discarded or returned to its location
 *    deck."
 *
 * Rules interpretation (confirmed with the project owner): Vile Fumes is
 * an ordinary item carried by a character (it moves with the company)
 * that has ONE activatable feature. Two distinct steps:
 *
 *   1. Playability — played as a carried item during the site phase at a
 *      Shadow-hold, a Dark-hold, or a site with a Dwarf automatic-attack;
 *      the site may be tapped or untapped (`item-play-site` +
 *      `allowWhenTapped`, filter on `site.type` / `site.autoAttackRaces`).
 *   2. Activated feature — during the site phase, while the company is at
 *      a Border-hold or Shadow-hold, discard Vile Fumes (a `transform-site`
 *      grant-action) to permanently transform that site: all versions →
 *      Ruins & Lairs, and the site's automatic-attacks are replaced by a
 *      single uncancelable Gas attack (each character faces 1 strike, 7
 *      prowess). Modelled as two `until-cleared` constraints filtered by
 *      the site's definition ID ("all versions"): a `site.type` override
 *      and a `replace-automatic-attacks`.
 *
 * | # | Rule                                               | Status |
 * |---|----------------------------------------------------|--------|
 * | 1 | playable at tapped/untapped S/D/Dwarf-attack site  | OK     |
 * | 2 | discard at a B/S site to make all versions R&L     | OK     |
 * | 3 | auto-attacks replaced by uncancelable Gas (1/7)    | OK     |
 * | 4 | item kept in play (1 MP) until activated/site gone | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, buildMinionSitePhaseState, setupAutoAttackStep,
  CardStatus, dispatch, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import { resolveEffective } from '../../engine/effective.js';
import type { CardDefinitionId, CardInstanceId, GameState, ActiveConstraint } from '../../index.js';

const VILE_FUMES = 'wh-54' as CardDefinitionId;

// Minion sites
const MORIA = 'le-392' as CardDefinitionId;      // shadow-hold (Orcs auto-attack)
const BARAD_DUR = 'le-352' as CardDefinitionId;   // dark-hold (no auto-attack)
const DALE = 'le-363' as CardDefinitionId;        // border-hold (Men auto-attack, no Dwarf)

// Minion characters (orcs)
const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

// Synthetic minion border-hold whose automatic-attack is by Dwarves — no
// real site in the pool has a Dwarf automatic-attack, so we inject one to
// exercise the `site.autoAttackRaces $includes "dwarf"` playability branch.
const DWARF_HOLD = 'test-dwarf-hold' as CardDefinitionId;
const DWARF_HOLD_DEF = {
  cardType: 'minion-site',
  alignment: 'ringwraith',
  id: DWARF_HOLD,
  name: 'Test Dwarf Hold',
  image: '',
  siteType: 'border-hold',
  sitePath: ['border'],
  nearestHaven: 'Carn Dûm',
  region: 'Test',
  playableResources: ['minor'],
  automaticAttacks: [{ creatureType: 'Dwarves', strikes: 2, prowess: 6 }],
  resourceDraws: 1,
  hazardDraws: 1,
};

describe('Vile Fumes (wh-54)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playability ────────────────────────────────────────────────────

  test('playable at an untapped Shadow-hold', () => {
    const state = buildMinionSitePhaseState({ site: MORIA, characters: [GORBAG], hand: [VILE_FUMES] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === VILE_FUMES)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('playable at a Dark-hold', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [GORBAG], hand: [VILE_FUMES] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === VILE_FUMES)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('playable even when the Shadow-hold is already tapped', () => {
    const state = buildMinionSitePhaseState({
      site: MORIA, characters: [GORBAG], hand: [VILE_FUMES], siteStatus: CardStatus.Tapped,
    });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === VILE_FUMES)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('playable at a site with a Dwarf automatic-attack', () => {
    const built = buildMinionSitePhaseState({ site: DWARF_HOLD, characters: [GORBAG], hand: [VILE_FUMES] });
    // Inject the synthetic Dwarf-attack site definition into the pool.
    const state = { ...built, cardPool: { ...built.cardPool, [DWARF_HOLD as string]: DWARF_HOLD_DEF } } as GameState;
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === VILE_FUMES)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(1);
  });

  test('NOT playable at a plain Border-hold (no Dwarf automatic-attack)', () => {
    const state = buildMinionSitePhaseState({ site: DALE, characters: [GORBAG], hand: [VILE_FUMES] });
    const id = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === VILE_FUMES)!.instanceId;
    const plays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-hero-resource'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === id,
    );
    expect(plays).toHaveLength(0);
  });

  test('once played it is a carried item on the character and scores 1 item MP', () => {
    const noItem = buildMinionSitePhaseState({ site: MORIA, characters: [GORBAG] });
    const withItem = buildMinionSitePhaseState({ site: MORIA, characters: [{ defId: GORBAG, items: [VILE_FUMES] }] });
    const baseMp = noItem.players[RESOURCE_PLAYER].marshallingPoints.item;
    const withMp = withItem.players[RESOURCE_PLAYER].marshallingPoints.item;
    expect(withMp - baseMp).toBe(1);
    // It rides on the character's items list (not bound to a site).
    const gorbag = Object.values(withItem.players[RESOURCE_PLAYER].characters)[0];
    expect(gorbag.items.some(i => i.definitionId === VILE_FUMES)).toBe(true);
  });

  // ── Rule 2 + 4: activated feature gating, transform, persistence ────────────

  test('transform-site is offered at a Shadow-hold while carrying Vile Fumes', () => {
    const state = buildMinionSitePhaseState({ site: MORIA, characters: [{ defId: GORBAG, items: [VILE_FUMES] }] });
    const transforms = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'activate-granted-action'
        && (a.action as { actionId?: string }).actionId === 'transform-site',
    );
    expect(transforms).toHaveLength(1);
  });

  test('transform-site is offered at a Border-hold', () => {
    const state = buildMinionSitePhaseState({ site: DALE, characters: [{ defId: GORBAG, items: [VILE_FUMES] }] });
    const transforms = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'activate-granted-action'
        && (a.action as { actionId?: string }).actionId === 'transform-site',
    );
    expect(transforms).toHaveLength(1);
  });

  test('transform-site is NOT offered at a Dark-hold', () => {
    const state = buildMinionSitePhaseState({ site: BARAD_DUR, characters: [{ defId: GORBAG, items: [VILE_FUMES] }] });
    const transforms = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'activate-granted-action'
        && (a.action as { actionId?: string }).actionId === 'transform-site',
    );
    expect(transforms).toHaveLength(0);
  });

  test('activating transform-site discards Vile Fumes and overrides the site type to Ruins & Lairs', () => {
    const state = buildMinionSitePhaseState({ site: MORIA, characters: [{ defId: GORBAG, items: [VILE_FUMES] }] });
    const action = computeLegalActions(state, PLAYER_1).find(
      a => a.viable && a.action.type === 'activate-granted-action'
        && (a.action as { actionId?: string }).actionId === 'transform-site',
    )!.action;
    const after = dispatch(state, action);

    // Vile Fumes left play (discarded) — no longer on the character.
    const gorbag = Object.values(after.players[RESOURCE_PLAYER].characters)[0];
    expect(gorbag.items.some(i => i.definitionId === VILE_FUMES)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === VILE_FUMES)).toBe(true);

    // Two until-cleared constraints were added.
    const companyId = after.players[RESOURCE_PLAYER].companies[0].id;
    const typeOverride = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    const replace = after.activeConstraints.find(c => c.kind.type === 'replace-automatic-attacks');
    expect(typeOverride).toBeDefined();
    expect(replace).toBeDefined();
    expect(typeOverride!.scope.kind).toBe('until-cleared');
    expect(replace!.scope.kind).toBe('until-cleared');

    // The company now reads Moria's effective type as ruins-and-lairs.
    const { value } = resolveEffective(
      after,
      { kind: 'company', companyId },
      'site.type',
      'shadow-hold',
      { site: { definitionId: MORIA } },
    );
    expect(value).toBe('ruins-and-lairs');
  });

  // ── Rule 3: the replacement Gas automatic-attack ────────────────────────────

  test('a transformed site replaces its automatic-attacks with an uncancelable Gas attack', () => {
    // Stand up a company at Moria with the transformation already in effect
    // (replace-automatic-attacks constraint filtered by Moria's definition).
    const base = buildMinionSitePhaseState({ site: MORIA, characters: [GORBAG, SHAGRAT] });
    const companyId = base.players[RESOURCE_PLAYER].companies[0].id;
    const replaceConstraint: ActiveConstraint = {
      id: 'vf-replace-1' as ActiveConstraint['id'],
      source: 'vf-1' as CardInstanceId,
      sourceDefinitionId: VILE_FUMES,
      scope: { kind: 'until-cleared' },
      target: { kind: 'company', companyId },
      kind: {
        type: 'replace-automatic-attacks',
        siteDefinitionId: MORIA,
        attack: { creatureType: 'Gas', strikes: 1, prowess: 7, uncancelable: true, eachCharacter: true },
      },
    };
    const withConstraint = { ...base, activeConstraints: [replaceConstraint] };

    const ready = setupAutoAttackStep(withConstraint);
    const inCombat = dispatch(ready, { type: 'pass', player: PLAYER_1 });

    expect(inCombat.combat).not.toBeNull();
    // Gas: 7 prowess, each character (2) faces 1 strike, and uncancelable.
    expect(inCombat.combat!.strikeProwess).toBe(7);
    // "Gas" names no race, so the attack carries no `creatureRace` at all —
    // keeping non-race text out of the Race-typed slot means no race-gated
    // condition (e.g. a weapon's "+2 against Orcs") can ever match it.
    expect(inCombat.combat!.creatureRace).toBeUndefined();
    expect(inCombat.combat!.strikesTotal).toBe(2);
    expect(inCombat.combat!.eachCharacterFacesOneStrike).toBe(true);
    expect(inCombat.combat!.uncancelable).toBe(true);

    // "cannot be canceled" — no cancel-attack action is available to the defender.
    const defenderActions = computeLegalActions(inCombat, PLAYER_1);
    expect(defenderActions.some(a => a.action.type === 'cancel-attack')).toBe(false);
  });

  test('without the transform constraint, Moria keeps its printed Orcs auto-attack', () => {
    const base = buildMinionSitePhaseState({ site: MORIA, characters: [GORBAG] });
    const ready = setupAutoAttackStep(base);
    const inCombat = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.creatureRace).toBe('orc');
    expect(inCombat.combat!.uncancelable ?? false).toBe(false);
  });
});
