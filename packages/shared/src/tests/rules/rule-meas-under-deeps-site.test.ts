/**
 * @module rule-meas-under-deeps-site
 *
 * MEAS §6 — The Under-deeps (site sub-rules).
 *
 * - (b) Eagle-mounts and Gwaihir cannot move to or from an Under-deeps site.
 * - (d) An environment that changes site type cannot change an Under-deeps
 *       site's type.
 * - (e) MPs of a company at an Under-deeps site do not count toward calling the
 *       Free Council / Audience with Sauron, but still count in the final tally.
 * - (f) At an Under-deeps site the extra-character item play (rule 2.V.5) widens
 *       from "a minor item" to any item the site itself allows.
 *
 * (Sub-rule (c) "no site path → only site-keyed hazards" is covered by the
 * Under-deeps movement coverage in rule-5.03.)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, CardInstanceId, ActiveConstraint, PlayTargetEffect, GameState, PlayerState, Company } from '../../index.js';
import { computeLegalActions } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import {
  buildTestState, buildSitePhaseState, buildFallenWizardSitePhaseState, resetMint, viableActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  HAUBERK_OF_BRIGHT_MAIL,
  Phase, CardStatus, pool,
} from '../test-helpers.js';

const THE_UNDER_GATES = 'dm-38' as CardDefinitionId; // under-deeps, shadow-hold, adj Moria(0)
const DWARVEN_LIGHT_STONE = 'dm-168' as CardDefinitionId; // special subtype; playable at any Under-deeps site
const DEEP_MINES = 'wh-55' as CardDefinitionId; // Fallen-wizard Ruins & Lairs, Under-deeps analog (no printed keyword)
const SARUMAN_FW = 'wh-9' as CardDefinitionId; // Fallen-wizard avatar (company character)

/** Set a company's specialMovement (no CompanySetup field exposes it). */
function withGwaihir(state: GameState): GameState {
  const company: Company = { ...state.players[0].companies[0], specialMovement: 'gwaihir' };
  const p0: PlayerState = { ...state.players[0], companies: [company] };
  return { ...state, players: [p0, state.players[1]] as [PlayerState, PlayerState] };
}

/** Definition IDs of the sites a player's plan-movement actions target. */
function planMovementDestDefs(state: GameState, player = PLAYER_1): (string | undefined)[] {
  return computeLegalActions(state, player)
    .filter(ea => ea.viable && ea.action.type === 'plan-movement')
    .map(ea => {
      const dest = (ea.action as { destinationSite: CardInstanceId }).destinationSite;
      return resolveInstanceId(state, dest) as string | undefined;
    });
}

describe('MEAS §6 — Under-deeps site sub-rules', () => {
  beforeEach(() => resetMint());

  // --- (b) Eagle/Gwaihir exclusion -----------------------------------------

  test('(b) Gwaihir is not offered an Under-deeps destination', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH, THE_UNDER_GATES] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const state = withGwaihir(base);
    const dests = planMovementDestDefs(state);
    expect(dests).toContain(MINAS_TIRITH as string);      // reachable
    expect(dests).not.toContain(THE_UNDER_GATES as string); // excluded by §6(b)
  });

  test('(b) a Gwaihir company at an Under-deeps site is offered no special movement', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const state = withGwaihir(base);
    expect(viableActions(state, PLAYER_1, 'plan-movement')).toHaveLength(0);
  });

  // --- (d) site-type-change guard ------------------------------------------

  test('(d) a site-type-change override does not change an Under-deeps site type', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const overrideTo = (defId: CardDefinitionId): GameState => ({
      ...state,
      activeConstraints: [{
        kind: { type: 'attribute-modifier', attribute: 'site.type', op: 'override', value: 'border-hold', filter: { 'site.definitionId': defId as string } },
      } as unknown as ActiveConstraint],
    });

    // Under-deeps site: override is a no-op — printed type survives.
    const udState = overrideTo(THE_UNDER_GATES);
    expect(getEffectiveSiteType(udState, THE_UNDER_GATES, 'shadow-hold' as never)).toBe('shadow-hold');

    // Control: a non-Under-deeps site DOES take the override.
    const moriaState = overrideTo(MORIA);
    expect(getEffectiveSiteType(moriaState, MORIA, 'shadow-hold' as never)).toBe('border-hold');
  });

  // --- (e) MP threshold exclusion ------------------------------------------

  test('(e) MPs of a company at an Under-deeps site are excluded from the callable total but kept in the full tally', () => {
    const atUnderDeeps = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // Aragorn (3) + Bilbo (2) carry character MPs.
    expect(atUnderDeeps.players[0].marshallingPoints.character).toBeGreaterThan(0);
    // Excluded from the callable total because the whole company is underground.
    expect(atUnderDeeps.players[0].callableMarshallingPoints.character).toBe(0);

    // Control: the same company on the surface counts toward the callable total.
    const onSurface = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    expect(onSurface.players[0].callableMarshallingPoints.character)
      .toBe(onSurface.players[0].marshallingPoints.character);
  });

  // --- (f) "play any item" at Under-deeps ----------------------------------

  test('(f) at an Under-deeps site the extra-character play accepts a major item', () => {
    const base = buildSitePhaseState({
      site: THE_UNDER_GATES,
      characters: [ARAGORN],
      hand: [HAUBERK_OF_BRIGHT_MAIL], // major item, allowed at the site
      siteStatus: CardStatus.Tapped,
    });
    // The site has been tapped and one extra item play is available.
    const state: GameState = { ...base, phaseState: { ...base.phaseState, minorItemAvailable: true } as typeof base.phaseState };
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('(f) at a non-Under-deeps site the same extra play is still minor-only', () => {
    const base = buildSitePhaseState({
      site: MORIA, // shadow-hold, allows major, but NOT under-deeps
      characters: [ARAGORN],
      hand: [HAUBERK_OF_BRIGHT_MAIL],
      siteStatus: CardStatus.Tapped,
    });
    const state: GameState = { ...base, phaseState: { ...base.phaseState, minorItemAvailable: true } as typeof base.phaseState };
    // The major item is NOT playable via the minor-only extra allowance.
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('(f) at an Under-deeps site the extra-character play accepts an item that is playable there only via its own item-play-site restriction', () => {
    // Dwarven Light-stone (dm-168) is "Playable at any Under-deeps site" via
    // its own item-play-site filter, but its formal subtype is "special" —
    // which The Under-gates' printed playableResources list (minor, major,
    // greater, gold-ring) does not include. CoE 2.V.5.1 grants the bonus to
    // "any one additional item that is playable at the site", so this must
    // still be offered even though the subtype gate alone would reject it.
    const base = buildSitePhaseState({
      site: THE_UNDER_GATES,
      characters: [ARAGORN],
      hand: [DWARVEN_LIGHT_STONE],
      siteStatus: CardStatus.Tapped,
    });
    const state: GameState = { ...base, phaseState: { ...base.phaseState, minorItemAvailable: true } as typeof base.phaseState };
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  test('(f) Deep Mines (wh-55) counts as an Under-deeps site for the bonus item, though it carries no printed keyword', () => {
    // Regression: a second Dwarven Light-stone was rejected with "site is
    // already tapped" at Deep Mines, because the bonus-item widening only
    // checked the literal `under-deeps` keyword. CoE g.sur.F1 and the Deep
    // Mines CRF errata both treat Deep Mines as an Under-deeps-style site
    // (isDeepMinesSite), so the rule 2.V.5.1 bonus must widen here too.
    const base = buildFallenWizardSitePhaseState({
      site: DEEP_MINES,
      characters: [SARUMAN_FW],
      hand: [DWARVEN_LIGHT_STONE],
      siteStatus: CardStatus.Tapped,
    });
    const state: GameState = { ...base, phaseState: { ...base.phaseState, minorItemAvailable: true } as typeof base.phaseState };
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThanOrEqual(1);
  });

  // Sanity: the off-to-the-side `targetsSetAside` flag is a recognized
  // play-target field (type-level guard for MEAS §1 certification).
  test('play-target accepts targetsSetAside in the data model', () => {
    const pt: PlayTargetEffect = { type: 'play-target', target: 'character', targetsSetAside: true };
    expect(pt.targetsSetAside).toBe(true);
    // The under-deeps site really is keyed as such in the loaded pool.
    expect((pool[THE_UNDER_GATES as string] as { keywords?: string[] }).keywords).toContain('under-deeps');
  });
});
