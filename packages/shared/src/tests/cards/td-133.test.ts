/**
 * @module td-133.test
 *
 * Card test: Map to Mithril (td-133)
 * Type: hero-resource-event (permanent), alignment: wizard
 *
 * Text:
 *   "Playable on a Dwarf during the site phase at a site at which Information
 *    is playable. Tap the Dwarf and site. Tap Map to Mithril if bearer is ever
 *    at Moria; this card never untaps. If Map to Mithril is at a Dwarf-hold
 *    and it is tapped, the bearer may tap himself and place this card with a
 *    non-unique weapon in his company. This gives the weapon a +3 prowess
 *    bonus."
 *
 * Modeling:
 *  - `play-target` site (`playableResources` includes `information`) +
 *    `play-target` character (`target.race: "dwarf"`) + `play-flag`
 *    `tap-site-on-play` / `tap-character-on-play` — same shape as Dreams of
 *    Lore (tw-210): the card attaches to the Dwarf's `items`.
 *  - `play-flag: "no-auto-untap"` — extended in this certification to also
 *    apply to items borne by a character (`reducer-untap.ts`), not just
 *    top-level `cardsInPlay` entries.
 *  - NEW `tap-at-site` effect (`siteNames: ["Moria"]`) — a `postReduce` sweep
 *    (`sweepTapAtSiteItems`, `reducer-utils.ts`) taps the card whenever its
 *    bearer's company currently sits at a named site. Combined with
 *    `no-auto-untap`, the tap is permanent.
 *  - The two Dwarf-hold sites (Blue Mountain / Iron Hill) are tagged with the
 *    NEW `dwarf-hold` keyword; a NEW `grant-action` (`map-to-mithril-attach-weapon`)
 *    gated on `self.status: "tapped"` + `site.keywords $includes dwarf-hold`
 *    (both NEW `buildGrantActionContext` fields) targets a non-unique weapon
 *    in the bearer's company (`targets.scope: "company-items"`) and applies
 *    the NEW `reattach-to-item` verb (`grant-action-apply.ts`): the card moves
 *    from the bearer's `items` into `cardsInPlay` with `attachedToItem` set —
 *    the same binding Barrow-blade (dm-119) gets at play time.
 *  - A `stat-modifier` (+3 prowess) flagged `activeWhileAttachedToItem` grants
 *    the bonus only once so re-parented (never while merely sitting as the
 *    Dwarf's own item) — gated in `collectCharacterEffects` (`resolver.ts`).
 *
 * Every test drives the reducer / legal-action computation — no assertion
 * reads a card-JSON field back against itself.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus,
  resetMint,
  buildSitePhaseState,
  buildTestState,
  findItemInstanceId,
  viableActions, dispatch, resolveChain,
  getCharacter, setItemStatus, setCharStatus,
  actionAs,
  GIMLI, ARAGORN, LEGOLAS,
  MORIA, MINAS_TIRITH, LORIEN, BLUE_MOUNTAIN_DWARF_HOLD,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
} from '../test-helpers.js';
import { Phase, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, ActivateGrantedAction } from '../../index.js';

const MAP_TO_MITHRIL = 'td-133' as CardDefinitionId;
const AMON_HEN = 'tw-371' as CardDefinitionId; // ruins-and-lairs, Information playable, not a Dwarf-hold
const TOLFALAS = 'tw-433' as CardDefinitionId; // ruins-and-lairs, NO Information
const DWARVEN_AXE = 'tw-499' as CardDefinitionId; // non-unique weapon

describe('Map to Mithril (td-133)', () => {
  beforeEach(() => resetMint());

  // ── Effects 1 + 2: playable on a Dwarf at a site where Information is playable ──

  test('offered on a Dwarf at a site where Information is playable', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: AMON_HEN,
      hand: [MAP_TO_MITHRIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBeGreaterThan(0);
  });

  test('NOT offered on a non-Dwarf character', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: AMON_HEN,
      hand: [MAP_TO_MITHRIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT offered at a site where Information is not playable', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: TOLFALAS,
      hand: [MAP_TO_MITHRIL],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect: "Tap the Dwarf and site" ────────────────────────────────────────

  test('playing it taps the Dwarf and the site, and attaches to the Dwarf', () => {
    const state = buildSitePhaseState({
      characters: [GIMLI],
      site: AMON_HEN,
      hand: [MAP_TO_MITHRIL],
    });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const gimli = getCharacter(after, RESOURCE_PLAYER, GIMLI);
    expect(gimli.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    const borne = gimli.items.find(i => i.definitionId === MAP_TO_MITHRIL);
    expect(borne).toBeDefined();
    expect(borne?.status).toBe(CardStatus.Untapped);
  });

  // ── "Tap Map to Mithril if bearer is ever at Moria" ─────────────────────────

  test('taps Map to Mithril once its bearer\'s company is at Moria', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: GIMLI, items: [MAP_TO_MITHRIL] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).items.find(i => i.definitionId === MAP_TO_MITHRIL)?.status)
      .toBe(CardStatus.Untapped);

    // Any reduce triggers the postReduce sweepTapAtSiteItems check.
    const swept = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(swept, RESOURCE_PLAYER, GIMLI).items.find(i => i.definitionId === MAP_TO_MITHRIL)?.status)
      .toBe(CardStatus.Tapped);
  });

  test('stays untapped while its bearer\'s company is elsewhere', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [MAP_TO_MITHRIL] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const swept = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(getCharacter(swept, RESOURCE_PLAYER, GIMLI).items.find(i => i.definitionId === MAP_TO_MITHRIL)?.status)
      .toBe(CardStatus.Untapped);
  });

  // ── "this card never untaps" ────────────────────────────────────────────────

  test('does not untap during the untap phase, unlike an ordinary tapped item', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: GIMLI, items: [MAP_TO_MITHRIL, DWARVEN_AXE] }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    state = setItemStatus(state, RESOURCE_PLAYER, GIMLI, MAP_TO_MITHRIL, CardStatus.Tapped);
    state = setItemStatus(state, RESOURCE_PLAYER, GIMLI, DWARVEN_AXE, CardStatus.Tapped);

    const inUntap = {
      ...state,
      phaseState: {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      } as typeof state.phaseState,
    };
    const afterUntap = dispatch(inUntap, { type: 'untap', player: PLAYER_1 });
    const gimli = getCharacter(afterUntap, RESOURCE_PLAYER, GIMLI);
    expect(gimli.items.find(i => i.definitionId === MAP_TO_MITHRIL)?.status).toBe(CardStatus.Tapped);
    // Control: an ordinary tapped item on the same character untaps as normal.
    expect(gimli.items.find(i => i.definitionId === DWARVEN_AXE)?.status).toBe(CardStatus.Untapped);
  });

  // ── "If Map to Mithril is at a Dwarf-hold and it is tapped, the bearer may
  //    tap himself and place this card with a non-unique weapon" ─────────────

  function dwarfHoldState(opts: { weaponDefId?: CardDefinitionId; mapTapped?: boolean; gimliTapped?: boolean; site?: CardDefinitionId } = {}) {
    const { weaponDefId = DAGGER_OF_WESTERNESSE, mapTapped = true, gimliTapped = false, site = BLUE_MOUNTAIN_DWARF_HOLD } = opts;
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site,
            characters: [
              { defId: GIMLI, items: [MAP_TO_MITHRIL] },
              { defId: LEGOLAS, items: weaponDefId ? [weaponDefId] : [] },
            ],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    if (mapTapped) state = setItemStatus(state, RESOURCE_PLAYER, GIMLI, MAP_TO_MITHRIL, CardStatus.Tapped);
    if (gimliTapped) state = setCharStatus(state, RESOURCE_PLAYER, GIMLI, CardStatus.Tapped);
    return state;
  }

  function attachActions(state: ReturnType<typeof dwarfHoldState>) {
    return computeLegalActions(state, PLAYER_1).filter(
      a => a.viable
        && a.action.type === 'activate-granted-action'
        && actionAs<ActivateGrantedAction>(a.action).actionId === 'map-to-mithril-attach-weapon',
    );
  }

  test('offered when tapped, at a Dwarf-hold, with a non-unique weapon in the company', () => {
    const state = dwarfHoldState();
    const actions = attachActions(state);
    expect(actions).toHaveLength(1);
    const axeId = findItemInstanceId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    expect(actionAs<ActivateGrantedAction>(actions[0].action).targetCardId).toBe(axeId);
  });

  test('NOT offered while Map to Mithril is still untapped', () => {
    const state = dwarfHoldState({ mapTapped: false });
    expect(attachActions(state)).toHaveLength(0);
  });

  test('NOT offered when the company is not at a Dwarf-hold', () => {
    const state = dwarfHoldState({ site: AMON_HEN });
    expect(attachActions(state)).toHaveLength(0);
  });

  test('NOT offered when the company has no non-unique weapon (only a unique one)', () => {
    const state = dwarfHoldState({ weaponDefId: GLAMDRING });
    expect(attachActions(state)).toHaveLength(0);
  });

  test('NOT offered when the bearer (Gimli) is already tapped (cost unpayable)', () => {
    const state = dwarfHoldState({ gimliTapped: true });
    expect(attachActions(state)).toHaveLength(0);
  });

  // ── Resolution: re-parents onto the weapon, taps Gimli, grants +3 prowess ──

  test('activating it moves the card onto the weapon, taps Gimli, and grants +3 prowess to the weapon\'s bearer', () => {
    const state = dwarfHoldState();
    const axeId = findItemInstanceId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const beforeProwess = getCharacter(state, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess;

    const action = attachActions(state)[0].action;
    const after = dispatch(state, action);

    // No longer one of Gimli's items.
    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).items.some(i => i.definitionId === MAP_TO_MITHRIL)).toBe(false);
    // Now a cardsInPlay entry attached to the weapon.
    const reattached = after.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === MAP_TO_MITHRIL && c.attachedToItem === axeId,
    );
    expect(reattached).toBeDefined();
    // Cost paid: Gimli tapped.
    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).status).toBe(CardStatus.Tapped);
    // +3 prowess flows to the weapon's bearer (Legolas), not Gimli.
    expect(getCharacter(after, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess).toBe(beforeProwess + 3);
  });

  test('grants no prowess bonus before it is reattached to the weapon', () => {
    // With Map to Mithril tapped in Gimli's items (Moria has fired, but the
    // player has not yet activated the attach ability), Gimli's and Legolas's
    // prowess must equal a fixture with no Map to Mithril in play at all —
    // proving the +3 stat-modifier stays dormant (`activeWhileAttachedToItem`)
    // until the card is actually re-parented onto the weapon.
    const withCard = dwarfHoldState();
    const baseline = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: BLUE_MOUNTAIN_DWARF_HOLD,
            characters: [GIMLI, { defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(withCard, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess)
      .toBe(getCharacter(baseline, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess);
    expect(getCharacter(withCard, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess)
      .toBe(getCharacter(baseline, RESOURCE_PLAYER, LEGOLAS).effectiveStats.prowess);
  });
});
