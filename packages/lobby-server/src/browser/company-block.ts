/**
 * @module company-block
 *
 * Renders a complete company block: name label, site area, and character
 * columns. Builds the click handler logic for two-step interactions
 * (influence reassignment, item transfer, company move, merge, corruption
 * checks, and opponent influence).
 *
 * Also contains the dummy company block renderer (for empty sites) and
 * the cards-in-play row renderer (permanent resources, factions, events).
 */

import type {
  PlayerView,
  GameAction,
  CardDefinition,
  CardInstanceId,
  CharacterInPlay,
  Company,
  OpponentCompanyView,
  MoveToInfluenceAction,
  TransferItemAction,
  StoreItemAction,
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  StartSideboardToDeckAction,
  StartSideboardToDiscardAction,
  CorruptionCheckAction,
  SupportCorruptionCheckAction,
  ActivateGrantedAction,
  OpponentInfluenceAttemptAction,
  InfluenceAttemptAction,
  PlayShortEventAction,
  PlayPermanentEventAction,
  SelectCardBearerAction,
  DeclareAgentAttackAction,
  TapAltPermanentEventAction,
  PayEventMaintenanceAction,
  ActivateOrgFetchAction,
} from '@meccg/shared';
import { cardImageProxyPath, isAttachedToPresentSite, cardsAttachedToCompany, isAttachedToPresentCompany, Phase, CardStatus, viableActions, getTitleCharacter } from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { createCardImage, createCardImageFromDefId, inPlayCardDefs } from './render-utils.js';
import { getSelectedFactionForInfluence, clearFactionInfluenceSelection, getSelectedResourceForPlay, clearResourcePlaySelection, getSelectedAllyForPlay, clearAllyPlaySelection, getSelectedHazardForPlay, clearHazardPlaySelection, getSelectedInfluencerForOpponent, setSelectedInfluencerForOpponent, clearOpponentInfluenceSelection, getSelectedShortEvent, clearShortEventSelection, setTargetingInstruction, getSelectedPermanentEventForPlay, clearPermanentEventPlaySelection, getSelectedPermanentEventForLongEventTarget, clearPermanentEventLongEventTargetSelection, getSelectedTapAltPermanentEvent, setSelectedTapAltPermanentEvent, clearTapAltPermanentEventSelection } from './render.js';
import {
  getCachedInstanceLookup,
  getInfluenceMoveSourceId, setInfluenceMoveSourceId,
  getTransferItemSourceId, setTransferItemSourceId,
  getTransferItemFromCharId, setTransferItemFromCharId,
  getCompanyMoveSourceId, setCompanyMoveSourceId,
  setCompanyMoveSourceCompanyId,
  getMergeSourceCompanyId, setMergeSourceCompanyId,
  getLastView, getLastOnAction,
  rerender,
} from './company-view-state.js';
import { renderSiteArea } from './company-site.js';
import { renderCharacterColumn } from './company-character.js';
import { showCharacterActionTooltip, showGrantedActionTooltip, showInPlayGrantedActionMenu, buildGrantedActionMenuItems, showOpponentInfluenceMenu } from './company-modals.js';
import { showTooltipMenu, type TooltipMenuItem } from './tooltip-menu.js';
import { resolveItemClick, isSelfDiscardGrantedAction } from './company-actions.js';
import { switchToAllCompanies } from './company-view.js';
import { showConfirm } from './dialog.js';

/**
 * All viable influence-attempt actions for a given (faction, character) pair.
 *
 * A faction carrying a `leader-control` effect (LE "Orcs of Udûn"-style
 * factions such as Stone Trolls le-288) yields two influence-attempt variants
 * for an eligible Orc/Troll leader: a plain influence (taps the site) and one
 * with {@link InfluenceAttemptAction.placeUnderLeaderControl} (placing the
 * faction under the leader's control, leaving the site untapped). Both variants
 * share the same faction and influencing character, so the UI must present them
 * as a choice rather than silently firing the first one. Returns all matching
 * variants (usually one, occasionally two).
 */
export function findInfluenceVariants(
  viable: readonly GameAction[],
  factionInstanceId: CardInstanceId,
  charInstanceId: CardInstanceId,
): InfluenceAttemptAction[] {
  return viable.filter(
    (a): a is InfluenceAttemptAction =>
      a.type === 'influence-attempt'
      && a.factionInstanceId === factionInstanceId
      && a.influencingCharacterId === charInstanceId,
  );
}

/**
 * Human-readable label for an influence-attempt variant, used when the UI must
 * disambiguate the plain attempt from the leader-control variant.
 */
export function influenceVariantLabel(action: InfluenceAttemptAction): string {
  return action.placeUnderLeaderControl
    ? "Place under leader's control (site not tapped)"
    : 'Influence (tap site)';
}

/**
 * Get the display name for a company based on its title character and current site.
 * Returns e.g. "Aragorn's Company at Rivendell" or "Company" if no title character found.
 */
function getCompanyName(
  company: Company | OpponentCompanyView,
  charMap: Readonly<Record<string, CharacterInPlay>>,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const titleChar = getTitleCharacter(company.characters, charMap, cardPool);
  if (!titleChar) return 'Company';
  const def = cardPool[titleChar.definitionId as string];
  if (!def) return 'Company';
  const name = def.name;
  // Simple possessive: add 's or just ' for names ending in s
  const possessive = name.endsWith('s') ? `${name}'` : `${name}'s`;
  let label = `${possessive} Company`;

  // Append site info: "moving to [destination]" if moving, otherwise "at [current site]"
  const destSite = 'destinationSite' in company ? company.destinationSite
    : 'revealedDestinationSite' in company ? company.revealedDestinationSite
    : null;
  if (destSite) {
    const destDefId = cachedInstanceLookup(destSite.instanceId);
    if (destDefId) {
      const destDef = cardPool[destDefId as string];
      if (destDef) {
        label += ` moving to ${destDef.name}`;
      }
    }
  } else if (company.currentSite) {
    const siteDefId = cachedInstanceLookup(company.currentSite.instanceId);
    if (siteDefId) {
      const siteDef = cardPool[siteDefId as string];
      if (siteDef) {
        label += ` at ${siteDef.name}`;
      }
    }
  }

  return label;
}

/**
 * Render a complete company block: name label, site area, character columns.
 * Used at both scales via the --company-scale CSS variable.
 */
export function renderCompanyBlock(
  company: Company | OpponentCompanyView,
  charMap: Readonly<Record<string, CharacterInPlay>>,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  owner: 'self' | 'opponent',
  options?: {
    hideTitle?: boolean;
    hasLegalMovement?: boolean;
    onAction?: (action: GameAction) => void;
    /** Map from character instance ID to move-to-influence actions for that character. */
    influenceActions?: Map<string, MoveToInfluenceAction[]>;
    /** Map from item instance ID to transfer-item actions for that item. */
    transferActions?: Map<string, TransferItemAction[]>;
    /** Map from item instance ID to store-item action for that item. */
    storeItemActions?: Map<string, StoreItemAction>;
    /** Map from character instance ID to split-company actions for that character. */
    splitActions?: Map<string, SplitCompanyAction>;
    /** Map from character instance ID to move-to-company actions for that character. */
    moveToCompanyActions?: Map<string, MoveToCompanyAction[]>;
    /** Map from source company ID to merge-companies actions for that company. */
    mergeActions?: Map<string, MergeCompaniesAction[]>;
    /** Map from avatar character instance ID to sideboard intent actions. */
    sideboardIntentActions?: Map<string, (StartSideboardToDeckAction | StartSideboardToDiscardAction)[]>;
    /** Map from character instance ID to corruption-check action. */
    corruptionCheckActions?: Map<string, CorruptionCheckAction>;
    /** Map from character instance ID to support-corruption-check action. */
    supportCorruptionCheckActions?: Map<string, SupportCorruptionCheckAction>;
    /** Map from source card instance ID to activate-granted-action actions. */
    grantedActions?: Map<string, ActivateGrantedAction[]>;
    /** Map from character instance ID to select-card-bearer action. */
    selectCardBearerActions?: Map<string, SelectCardBearerAction>;
    /**
     * Shared set of site instance ids already rendered in the current
     * all-companies overview pass, forwarded to {@link renderSiteArea} so a
     * site shared by sibling companies gets a company-scoped
     * `data-instance-id` on repeat occurrences (stable FLIP identity).
     */
    renderedSiteInstances?: Set<string>;
  },
): HTMLElement {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const lastView = getLastView();
  const _lastOnAction = getLastOnAction();
  const influenceMoveSourceId = getInfluenceMoveSourceId();
  const transferItemSourceId = getTransferItemSourceId();
  const transferItemFromCharId = getTransferItemFromCharId();
  const companyMoveSourceId = getCompanyMoveSourceId();
  const mergeSourceCompanyId = getMergeSourceCompanyId();

  const block = document.createElement('div');
  const isSelfTurn = view.activePlayer !== null && view.activePlayer === view.self.id;
  // Free Council used to be excluded from dimming because `activePlayer`
  // wasn't kept in sync with the corruption-check sub-turn (fixed by
  // reducer-free-council.ts's pass handler), which left dimming stuck on
  // the first checker. Now that activePlayer tracks the current checker,
  // dimming the other side makes it clear whose corruption checks are
  // being resolved instead of showing both companies as equally active.
  let isInactive = (owner === 'self' && !isSelfTurn) || (owner === 'opponent' && isSelfTurn);

  // During M/H or Site phase (after select-company), dim all companies except the active one
  if (view.phaseState.phase === Phase.MovementHazard || view.phaseState.phase === Phase.Site) {
    const mhOrSite = view.phaseState;
    if (mhOrSite.step !== 'select-company') {
      const resourceCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
      const activeCompany = resourceCompanies[mhOrSite.activeCompanyIndex];
      if (activeCompany && company.id !== activeCompany.id) {
        isInactive = true;
      }
    }
  }

  block.className = isInactive ? 'company-block company-block--inactive' : 'company-block';
  block.dataset.companyId = company.id as string;

  // Company name (omitted in single-company view)
  if (!options?.hideTitle) {
    const nameEl = document.createElement('div');
    nameEl.className = `company-name company-name--${owner}`;
    nameEl.textContent = getCompanyName(company, charMap, view, cardPool);
    block.appendChild(nameEl);

    // Moved badge
    if (company.moved) {
      const movedBadge = document.createElement('span');
      movedBadge.className = 'company-moved-badge';
      movedBadge.textContent = '\u2713'; // checkmark
      nameEl.appendChild(movedBadge);
    }
  }

  // Cards row: site on the left, then characters
  const row = document.createElement('div');
  row.className = 'company-row';

  // Site area (leftmost)
  // During declare-agent-attack step, find agents threatening the active company's site
  let agentAttackActions: DeclareAgentAttackAction[] | undefined;
  if (view.phaseState.phase === Phase.Site && view.phaseState.step === 'declare-agent-attack' && options?.onAction) {
    const siteState = view.phaseState;
    const isSelfTurn = view.activePlayer !== null && view.activePlayer === view.self.id;
    const resourceCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
    const activeCompany = resourceCompanies[siteState.activeCompanyIndex];
    if (activeCompany && company.id === activeCompany.id) {
      agentAttackActions = viableActions(view.legalActions).filter(
        (a): a is DeclareAgentAttackAction => a.type === 'declare-agent-attack',
      );
    }
  }

  row.appendChild(renderSiteArea(company, view, cardPool, {
    hasLegalMovement: options?.hasLegalMovement,
    onAction: options?.onAction,
    grantedActions: options?.grantedActions,
    agentAttackActions,
    cardsInPlay: owner === 'self' ? view.self.cardsInPlay : view.opponent.cardsInPlay,
    renderedSiteInstances: options?.renderedSiteInstances,
  }));

  // Characters — title character always rendered first (leftmost after site).
  // Followers are rendered nested under their controlling character, not as
  // separate columns, so collect follower IDs to skip in the main loop.
  //
  // Direct influence (controlledBy/followers) is independent of physical
  // company membership (CoE 2.II.2.2) — e.g. Seized by Terror (dm-88) can
  // split a follower off into its own company while it remains under its
  // controller's direct influence. Only nest a follower under its controller
  // here if it is still physically present in *this* company; otherwise it
  // renders as its own standalone column in its actual company, and nesting
  // it here too would show the same character in two companies at once.
  const companyCharacterIds = new Set(company.characters as readonly string[]);
  const followerIds = new Set<string>();
  for (const charInstId of company.characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    for (const fId of char.followers) {
      if (companyCharacterIds.has(fId as string)) followerIds.add(fId as string);
    }
  }
  /** Restrict a character's followers to those physically present in this company. */
  const withPresentFollowers = (char: CharacterInPlay): CharacterInPlay =>
    char.followers.some(fId => !companyCharacterIds.has(fId as string))
      ? { ...char, followers: char.followers.filter(fId => companyCharacterIds.has(fId as string)) }
      : char;

  const titleChar = getTitleCharacter(company.characters, charMap, cardPool);

  /** Build the influence click handler for a character, if applicable. */
  const buildInfluenceClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    if (!options?.influenceActions || !options.onAction) return undefined;
    const onAction = options.onAction;
    const actions = options.influenceActions.get(charInstId as string);

    if (influenceMoveSourceId) {
      // Targeting mode: this character is a valid controller target
      const targetAction = viableActions(lastView!.legalActions).find(
        a => a.type === 'move-to-influence'
          && a.characterInstanceId === influenceMoveSourceId
          && a.controlledBy === charInstId,
      ) as MoveToInfluenceAction | undefined;
      if (targetAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            setInfluenceMoveSourceId(null);
            setTargetingInstruction(null);
            onAction(targetAction);
          },
        };
      }
      // Source character itself — clicking again deselects
      if (charInstId === influenceMoveSourceId) {
        return {
          cls: 'company-card--influence-selected',
          handler: (e) => {
            e.stopPropagation();
            setInfluenceMoveSourceId(null);
            setTargetingInstruction(null);
            rerender();
          },
        };
      }
      return undefined;
    }

    if (!actions || actions.length === 0) return undefined;

    // All actions are regress — still clickable but no glow
    const allRegress = actions.every(a => a.regress);
    const cls = allRegress ? '' : 'company-card--influence-source';

    if (actions.length === 1 && actions[0].controlledBy === 'general') {
      // Single option: move to GI — mark as available but don't auto-execute.
      // The tooltip (shown by buildCombinedClick) will let the user confirm.
      const action = actions[0];
      return {
        cls,
        handler: (e) => {
          e.stopPropagation();
          onAction(action);
        },
      };
    }

    // Multiple options (or to-DI): enter targeting mode
    return {
      cls,
      handler: (e) => {
        e.stopPropagation();
        setInfluenceMoveSourceId(charInstId);
        const sourceDefId = cachedInstanceLookup(charInstId);
        const sourceName = sourceDefId ? cardPool[sourceDefId as string]?.name : undefined;
        setTargetingInstruction(
          `Click a highlighted character to reassign ${sourceName ?? 'character'} influence`,
        );
        rerender();
      },
    };
  };

  /**
   * Discard-target short event: highlight and click the target card. Shared by
   * items and hazards since a discard-target short event can name either.
   */
  const buildDiscardTargetClick = (instId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    const selectedSE = getSelectedShortEvent();
    if (!selectedSE || !options?.onAction) return undefined;
    const seAction = viableActions(lastView!.legalActions).find(
      (a): a is PlayShortEventAction => a.type === 'play-short-event'
        && a.cardInstanceId === selectedSE
        && a.discardTargetInstanceId === instId,
    );
    if (!seAction) return undefined;
    return {
      cls: 'company-card--influence-target',
      handler: (e) => {
        e.stopPropagation();
        clearShortEventSelection();
        options.onAction!(seAction);
      },
    };
  };

  /**
   * Build the item click handler for an item on a character, if applicable.
   *
   * An item can simultaneously be storable at the current site, transferable
   * to another character, AND carry its own granted action (e.g. Cram is both
   * transferable and grants untap-bearer / extra-region-movement) — all
   * options are merged into one menu so none is silently hidden behind another.
   */
  const buildItemClick = (itemInstId: CardInstanceId, charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    const discardClick = buildDiscardTargetClick(itemInstId);
    if (discardClick) return discardClick;

    if (!options?.onAction) return undefined;

    if (transferItemSourceId) {
      // We're in targeting mode — clicking a character card is the target, not items
      // Items during targeting mode: the selected item gets a green highlight
      if (itemInstId === transferItemSourceId) {
        return {
          cls: 'company-card--transfer-selected',
          handler: (e) => {
            e.stopPropagation();
            setTransferItemSourceId(null);
            setTransferItemFromCharId(null);
            setTargetingInstruction(null);
            rerender();
          },
        };
      }
      return undefined;
    }

    // Not in targeting mode — gather the item's possible actions.
    const onAction = options.onAction;
    const storeAction = options.storeItemActions?.get(itemInstId as string);
    const hasStore = !!storeAction && storeAction.characterId === charInstId;
    const transferActions = options.transferActions?.get(itemInstId as string) ?? [];
    const grantedActions = options.grantedActions?.get(itemInstId as string) ?? [];

    const resolution = resolveItemClick(grantedActions, hasStore ? storeAction : undefined, transferActions);
    if (resolution.kind === 'none') return undefined;

    const itemDefId = cachedInstanceLookup(itemInstId);
    const itemName = itemDefId ? cardPool[itemDefId as string]?.name : undefined;
    const resolveName = (id: CardInstanceId): string | undefined => {
      const defId = cachedInstanceLookup(id);
      return defId ? cardPool[defId as string]?.name : undefined;
    };

    /** Enter spatial targeting mode so the player picks a recipient character. */
    const enterTransferMode = (): void => {
      setTransferItemSourceId(itemInstId);
      setTransferItemFromCharId(charInstId);
      setTargetingInstruction(
        `Click a highlighted character to receive ${itemName ?? 'item'}`,
      );
      rerender();
    };

    // More than one option available — present a menu so the player explicitly
    // chooses instead of one option being forced or silently hidden.
    if (resolution.kind === 'menu') {
      const menuItems: TooltipMenuItem[] = [
        ...buildGrantedActionMenuItems(grantedActions, onAction, resolveName),
        ...(hasStore ? [{ label: 'Store at site', onClick: () => onAction(storeAction) }] : []),
        ...(transferActions.length > 0 ? [{ label: `Transfer ${itemName ?? 'item'}`, onClick: enterTransferMode }] : []),
      ];
      return {
        cls: 'company-card--transfer-source',
        handler: (e) => {
          e.stopPropagation();
          showTooltipMenu(e.currentTarget as HTMLElement, menuItems, { placement: 'auto' });
        },
      };
    }

    // Only a granted action is available — commit it directly, unless its
    // cost discards the card itself: that loss can't be undone, so a
    // misclick (bug report 95b2e034703ec1d0: Secret Book as-131 discarded
    // instantly by one accidental click) needs a confirmation first.
    if (resolution.kind === 'granted') {
      const action = resolution.action;
      const needsConfirm = isSelfDiscardGrantedAction(action, cardPool);
      return {
        cls: 'company-card--transfer-source',
        handler: (e) => {
          e.stopPropagation();
          if (!needsConfirm) {
            onAction(action);
            return;
          }
          void showConfirm(`Discard ${itemName ?? 'this card'}?`).then(ok => {
            if (ok) onAction(action);
          });
        },
      };
    }

    // Only storing is available — commit the store action directly.
    if (resolution.kind === 'store') {
      return {
        cls: 'company-card--transfer-source',
        handler: (e) => {
          e.stopPropagation();
          onAction(resolution.action);
        },
      };
    }

    // Only transferring is available — always enter targeting mode, even with a
    // single target, so the player confirms explicitly.
    const allRegress = transferActions.every(a => a.regress);
    const cls = allRegress ? '' : 'company-card--transfer-source';
    return {
      cls,
      handler: (e) => {
        e.stopPropagation();
        enterTransferMode();
      },
    };
  };

  /** Build click handler for cards with granted actions (hazards, or bearer-less in-play cards). */
  const buildHazardClick = (instId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    const discardClick = buildDiscardTargetClick(instId);
    if (discardClick) return discardClick;

    if (!options?.onAction || !options.grantedActions) return undefined;
    const actions = options.grantedActions.get(instId as string);
    if (!actions || actions.length === 0) return undefined;
    const onAction = options.onAction;
    if (actions.length === 1) {
      return {
        cls: 'company-card--transfer-source',
        handler: (e) => {
          e.stopPropagation();
          onAction(actions[0]);
        },
      };
    }
    return {
      cls: 'company-card--transfer-source',
      handler: (e) => {
        e.stopPropagation();
        const anchor = e.currentTarget as HTMLElement;
        showGrantedActionTooltip(anchor, actions, onAction);
      },
    };
  };

  /** Build the character click handler for transfer targeting, if applicable. */
  const buildTransferTargetClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    if (!transferItemSourceId || !transferItemFromCharId || !options?.onAction) return undefined;
    const onAction = options.onAction;

    // Find the transfer action for this target character
    const targetAction = viableActions(lastView!.legalActions).find(
      a => a.type === 'transfer-item'
        && a.itemInstanceId === transferItemSourceId
        && a.fromCharacterId === transferItemFromCharId
        && a.toCharacterId === charInstId,
    ) as TransferItemAction | undefined;

    if (targetAction) {
      return {
        cls: 'company-card--transfer-target',
        handler: (e) => {
          e.stopPropagation();
          setTransferItemSourceId(null);
          setTransferItemFromCharId(null);
          setTargetingInstruction(null);
          onAction(targetAction);
        },
      };
    }
    return undefined;
  };

  /** Build click handler for split/move-company actions on a character. */
  const buildCompanyMoveClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    if (!options?.onAction) return undefined;

    // In company-move targeting mode, this character is the source — clicking deselects
    if (companyMoveSourceId === charInstId) {
      return {
        cls: 'company-card--influence-selected',
        handler: (e) => {
          e.stopPropagation();
          setCompanyMoveSourceId(null);
          setCompanyMoveSourceCompanyId(null);
          setTargetingInstruction(null);
          rerender();
        },
      };
    }

    const splitAction = options.splitActions?.get(charInstId as string);
    const moveActions = options.moveToCompanyActions?.get(charInstId as string);
    if (!splitAction && (!moveActions || moveActions.length === 0)) return undefined;

    const allRegress = [
      ...(splitAction ? [splitAction] : []),
      ...(moveActions ?? []),
    ].every(a => 'regress' in a && a.regress);
    const cls = allRegress ? '' : 'company-card--influence-source';

    // Always show tooltip menu for character actions
    return {
      cls,
      handler: (e) => {
        e.stopPropagation();
        showCharacterActionTooltip(e.target as HTMLElement, charInstId, cardPool, {
          ...options,
          companyId: company.id,
        });
      },
    };
  };

  /** Check if a character is the title character of this company. */
  const isTitleChar = (charInstId: CardInstanceId): boolean =>
    titleChar !== undefined && titleChar.instanceId === charInstId;

  /** Get merge actions for this company if the character is the title character. */
  const getMergeActionsForChar = (charInstId: CardInstanceId): MergeCompaniesAction[] | undefined => {
    if (!isTitleChar(charInstId)) return undefined;
    const acts = options?.mergeActions?.get(company.id as string);
    return acts && acts.length > 0 ? acts : undefined;
  };

  /** Combine all character click handlers into one: if one action type, take it; if multiple, show tooltip. */
  const buildCombinedClick = (charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
    // Short-event character targeting (e.g. Stealth → scout) takes priority when active
    const selectedSE = getSelectedShortEvent();
    if (selectedSE) {
      const seAction = viableActions(view.legalActions).find(
        a => a.type === 'play-short-event'
          && a.cardInstanceId === selectedSE
          && a.targetScoutInstanceId === charInstId,
      );
      if (seAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            clearShortEventSelection();
            options?.onAction?.(seAction);
          },
        };
      }
      return undefined;
    }

    // Faction influence targeting takes priority when active
    const selectedFaction = getSelectedFactionForInfluence();
    if (selectedFaction) {
      const influenceVariants = findInfluenceVariants(
        viableActions(view.legalActions), selectedFaction, charInstId,
      );
      if (influenceVariants.length > 0) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            // A single variant fires immediately. Two variants (plain vs.
            // leader-control, e.g. Stone Trolls le-288) require a choice — show
            // a tooltip menu so the player can place the faction under the
            // Orc/Troll leader's control instead of always tapping the site.
            if (influenceVariants.length === 1) {
              clearFactionInfluenceSelection();
              options?.onAction?.(influenceVariants[0]);
              return;
            }
            showTooltipMenu(
              e.target as HTMLElement,
              influenceVariants.map(variant => ({
                label: influenceVariantLabel(variant),
                onClick: () => {
                  clearFactionInfluenceSelection();
                  options?.onAction?.(variant);
                },
              })),
              { placement: 'auto' },
            );
          },
        };
      }
      return undefined;
    }

    // Ally play targeting: click an untapped character to control the selected ally
    const selectedAlly = getSelectedAllyForPlay();
    if (selectedAlly) {
      const allyAction = viableActions(view.legalActions).find(
        a => a.type === 'play-hero-resource'
          && a.cardInstanceId === selectedAlly
          && a.attachToCharacterId === charInstId,
      );
      if (allyAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            clearAllyPlaySelection();
            options?.onAction?.(allyAction);
          },
        };
      }
      return undefined;
    }

    // Resource/item play targeting: click an untapped character to bear the selected resource
    const selectedResource = getSelectedResourceForPlay();
    if (selectedResource) {
      const resourceAction = viableActions(view.legalActions).find(
        a => (a.type === 'play-hero-resource' || a.type === 'play-minor-item')
          && a.cardInstanceId === selectedResource
          && a.attachToCharacterId === charInstId,
      );
      if (resourceAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            clearResourcePlaySelection();
            options?.onAction?.(resourceAction);
          },
        };
      }
      return undefined;
    }

    // Permanent-event character targeting: click a character to apply selected permanent event
    const selectedPermanentEvent = getSelectedPermanentEventForPlay();
    if (selectedPermanentEvent) {
      const permEventAction = viableActions(view.legalActions).find(
        a => a.type === 'play-permanent-event'
          && a.cardInstanceId === selectedPermanentEvent
          && 'targetCharacterId' in a
          && a.targetCharacterId === charInstId,
      );
      if (permEventAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            clearPermanentEventPlaySelection();
            options?.onAction?.(permEventAction);
          },
        };
      }
      return undefined;
    }

    // Tap-alt-permanent-event character targeting: after clicking an in-play
    // creature-permanent-event (e.g. Adûnaphel tw-2), click any eligible
    // character — of either player — to tap it. The target character may belong
    // to the opponent, so this branch runs for both self and opponent columns.
    const selectedTapAltPE = getSelectedTapAltPermanentEvent();
    if (selectedTapAltPE) {
      const tapAltAction = findTapAltPermanentEventTarget(
        viableActions(view.legalActions), selectedTapAltPE, charInstId,
      );
      if (tapAltAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            clearTapAltPermanentEventSelection();
            options?.onAction?.(tapAltAction);
          },
        };
      }
      return undefined;
    }

    // Hazard character targeting: click a character to play hazard on them
    const selectedHazard = getSelectedHazardForPlay();
    if (selectedHazard) {
      const hazardAction = viableActions(view.legalActions).find(
        a => a.type === 'play-hazard'
          && a.cardInstanceId === selectedHazard
          && 'targetCharacterId' in a
          && a.targetCharacterId === charInstId,
      );
      if (hazardAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            clearHazardPlaySelection();
            options?.onAction?.(hazardAction);
          },
        };
      }
      return undefined;
    }

    // Opponent influence targeting: selected influencer deselects on re-click
    const selectedOppInfluencer = getSelectedInfluencerForOpponent();
    if (selectedOppInfluencer) {
      if (selectedOppInfluencer === charInstId) {
        return {
          cls: 'company-card--influence-selected',
          handler: (e) => {
            e.stopPropagation();
            clearOpponentInfluenceSelection();
            rerender();
          },
        };
      }
      // Other own characters are not clickable during opponent targeting
      return undefined;
    }

    // Transfer targeting takes priority when active
    if (transferItemSourceId) return buildTransferTargetClick(charInstId);

    // Company-move targeting: no character actions, just waiting for company click
    if (companyMoveSourceId) {
      // Source character deselects on click
      if (companyMoveSourceId === charInstId) return buildCompanyMoveClick(charInstId);
      return undefined;
    }

    // Merge targeting: no character actions, just waiting for company click
    if (mergeSourceCompanyId) return undefined;

    // Influence targeting takes priority when active
    if (influenceMoveSourceId) return buildInfluenceClick(charInstId);

    // Gather all action types available for this character
    const influenceResult = buildInfluenceClick(charInstId);
    const companyResult = buildCompanyMoveClick(charInstId);
    const mergeActionsForChar = getMergeActionsForChar(charInstId);
    const sideboardIntents = options?.sideboardIntentActions?.get(charInstId as string);
    const hasSideboard = sideboardIntents && sideboardIntents.length > 0;
    const ccAction = options?.corruptionCheckActions?.get(charInstId as string);
    const ccSupportAction = options?.supportCorruptionCheckActions?.get(charInstId as string);
    const bearerAction = options?.selectCardBearerActions?.get(charInstId as string);
    // Grant-actions declared directly on the character card itself (e.g.
    // Gandalf's test-gold-ring, tw-156) are keyed by the character's own
    // instance ID, same as attached items/hazards are keyed by their own ID.
    const grantedActionsForChar = options?.grantedActions?.get(charInstId as string) ?? [];
    const hasGrantedActions = grantedActionsForChar.length > 0;

    // Check for opponent influence actions
    const oppInfluenceActions = viableActions(view.legalActions).filter(
      (a): a is OpponentInfluenceAttemptAction =>
        a.type === 'opponent-influence-attempt' && a.influencingCharacterId === charInstId,
    );
    const hasOppInfluence = oppInfluenceActions.length > 0;

    // Count how many action types are available
    const actionTypes = [influenceResult, companyResult, mergeActionsForChar, hasSideboard, ccAction, ccSupportAction, hasOppInfluence, bearerAction, hasGrantedActions].filter(Boolean).length;

    if (actionTypes === 0) return undefined;

    // Determine if merge actions are all regressive
    const mergeAllRegress = mergeActionsForChar
      ? mergeActionsForChar.every(a => a.regress)
      : true;
    const mergeCls = mergeActionsForChar && !mergeAllRegress ? 'company-card--influence-source' : '';

    // Multiple types — always show tooltip for disambiguation
    if (actionTypes > 1) {
      const cls = influenceResult?.cls || companyResult?.cls || mergeCls
        || (hasSideboard ? 'company-card--influence-source' : '')
        || (ccAction ? 'company-card--influence-source' : '')
        || (hasGrantedActions ? 'company-card--transfer-source' : '');
      return {
        cls,
        handler: (e) => {
          e.stopPropagation();
          showCharacterActionTooltip(e.target as HTMLElement, charInstId, cardPool, {
            ...options!,
            companyId: company.id,
          });
        },
      };
    }

    // Single type: opponent influence — enter targeting mode to select opponent's card
    if (hasOppInfluence) {
      const charDefId = cachedInstanceLookup(charInstId);
      const charName = charDefId ? cardPool[charDefId as string]?.name : undefined;
      return {
        cls: 'company-card--influence-source',
        handler: (e) => {
          e.stopPropagation();
          setSelectedInfluencerForOpponent(charInstId);
          setTargetingInstruction(
            `Click an opponent's card to attempt influence with ${charName ?? 'character'}`,
          );
          // Switch to all-companies view so opponent cards are visible
          switchToAllCompanies();
          rerender();
        },
      };
    }

    // Single type: merge only — enter merge flow directly
    if (mergeActionsForChar) {
      return {
        cls: mergeCls,
        handler: (e) => {
          e.stopPropagation();
          if (mergeActionsForChar.length === 1) {
            options!.onAction!(mergeActionsForChar[0]);
          } else {
            setMergeSourceCompanyId(company.id);
            setTargetingInstruction('Click a company to join into');
            switchToAllCompanies();
            rerender();
          }
        },
      };
    }

    // Single type: sideboard access — if only one intent, execute directly; otherwise show tooltip
    if (hasSideboard) {
      if (sideboardIntents.length === 1) {
        return {
          cls: 'company-card--influence-source',
          handler: (e) => {
            e.stopPropagation();
            options!.onAction!(sideboardIntents[0]);
          },
        };
      }
      return {
        cls: 'company-card--influence-source',
        handler: (e) => {
          e.stopPropagation();
          showCharacterActionTooltip(e.target as HTMLElement, charInstId, cardPool, {
            ...options!,
            companyId: company.id,
          });
        },
      };
    }

    // Single type: corruption check — execute directly
    if (ccAction) {
      return {
        cls: 'company-card--influence-source',
        handler: (e) => {
          e.stopPropagation();
          options!.onAction!(ccAction);
        },
      };
    }

    // Single type: corruption check support — tap to support
    if (ccSupportAction) {
      return {
        cls: 'company-card--influence-source',
        handler: (e) => {
          e.stopPropagation();
          options!.onAction!(ccSupportAction);
        },
      };
    }

    // Single type: select-card-bearer — tap character to bear the permanent event
    if (bearerAction) {
      return {
        cls: 'company-card--influence-target',
        handler: (e) => {
          e.stopPropagation();
          options!.onAction!(bearerAction);
        },
      };
    }

    // Single type: granted action(s) declared on the character card itself —
    // commit directly if there's only one target, otherwise show a menu
    // (mirrors buildHazardClick's handling of attached-card grant-actions).
    if (hasGrantedActions) {
      const onAction = options!.onAction!;
      if (grantedActionsForChar.length === 1) {
        const onlyAction = grantedActionsForChar[0];
        return {
          cls: 'company-card--transfer-source',
          handler: (e) => {
            e.stopPropagation();
            onAction(onlyAction);
          },
        };
      }
      return {
        cls: 'company-card--transfer-source',
        handler: (e) => {
          e.stopPropagation();
          showGrantedActionTooltip(e.currentTarget as HTMLElement, grantedActionsForChar, onAction);
        },
      };
    }

    // Single type: company-move only
    if (companyResult && !influenceResult) return companyResult;

    // Single type: influence only — show tooltip so the user confirms
    if (influenceResult && !companyResult) {
      return {
        cls: influenceResult.cls,
        handler: (e) => {
          e.stopPropagation();
          showCharacterActionTooltip(e.target as HTMLElement, charInstId, cardPool, {
            ...options!,
            companyId: company.id,
          });
        },
      };
    }

    return influenceResult ?? companyResult;
  };

  // Definitions of every card in play, either player's: an `in-play-item-modifier`
  // (Scorba at Home td-65, Itangast at Home td-38, Rumor of the One le-224)
  // raises the corruption points of matching items regardless of who played it,
  // so the item CP badges must take both sides into account. A modifier may also
  // spare some players (Bane of the Ithil-stone tw-13 skips minion players), so
  // the badges also need the alignment of this company's controlling player.
  const inPlayDefs = inPlayCardDefs(view, cardPool);
  const bearerAlignment = owner === 'self' ? view.self.alignment : view.opponent.alignment;

  if (titleChar) {
    row.appendChild(renderCharacterColumn(withPresentFollowers(titleChar), cardPool, true, charMap, buildCombinedClick(titleChar.instanceId), buildCombinedClick, buildItemClick, buildHazardClick, inPlayDefs, bearerAlignment));
  }
  for (const charInstId of company.characters) {
    if (followerIds.has(charInstId as string)) continue;
    const char = charMap[charInstId as string];
    if (!char) continue;
    if (titleChar && char.instanceId === titleChar.instanceId) continue;
    row.appendChild(renderCharacterColumn(withPresentFollowers(char), cardPool, false, charMap, buildCombinedClick(charInstId), buildCombinedClick, buildItemClick, buildHazardClick, inPlayDefs, bearerAlignment));
  }

  // Company-targeting permanent events bound to this company (e.g. Fellowship,
  // Going Ever Under Dark) render inside the company block — they sit with the
  // company on the physical table, not in the flat cards-in-play row (which
  // excludes them; see renderCardsInPlayRow). Either player's card may be
  // bound here (hazard permanents target the opponent's companies), so both
  // players' cardsInPlay are consulted.
  const companyBound = [
    ...cardsAttachedToCompany(view.self.cardsInPlay, company.id),
    ...cardsAttachedToCompany(view.opponent.cardsInPlay, company.id),
  ];
  if (companyBound.length > 0) {
    const strip = document.createElement('div');
    strip.className = 'company-attachments';
    for (const card of companyBound) {
      const img = renderInPlayCardImage(card, view, cardPool, options?.onAction);
      if (!img) continue;
      img.classList.add('company-card--company-attachment');
      strip.appendChild(img);
    }
    if (strip.childElementCount > 0) row.appendChild(strip);
  }

  block.appendChild(row);

  return block;
}

/**
 * Render a dummy company block for a site from the site deck where
 * no company exists yet. Shows the site card with an "empty company" label.
 */
export function renderDummyCompanyBlock(
  siteInstanceId: CardInstanceId,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const block = document.createElement('div');
  block.className = 'company-block';

  const siteDefId = cachedInstanceLookup(siteInstanceId);
  const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
  const siteName = siteDef?.name ?? 'Unknown site';

  // Company name
  const nameEl = document.createElement('div');
  nameEl.className = 'company-name company-name--self';
  nameEl.textContent = `New company at ${siteName}`;
  block.appendChild(nameEl);

  // Cards row: just the site card
  const row = document.createElement('div');
  row.className = 'company-row';

  if (siteDef) {
    const area = document.createElement('div');
    area.className = 'company-site-area';
    const imgPath = cardImageProxyPath(siteDef);
    if (imgPath) {
      area.appendChild(createCardImage(siteDefId as string, siteDef, imgPath, 'company-card company-card--site', siteInstanceId as string));
    }
    row.appendChild(area);
  }
  block.appendChild(row);

  return block;
}

/**
 * Render the cards-in-play row for both players.
 * Shows permanent resources, factions, and other general cards on the table.
 * Positioned at the top of the board above the company overview.
 */
/**
 * Find a viable hazard-limit-swap activation (Power Built by Waiting as-34)
 * for the given card-in-play instance.
 *
 * The hazard player may `tap-hazard-card-for-limit` (tap the card for
 * +hazard limit) or, once it is tapped, `pay-hazard-limit-to-untap-card`
 * (spend hazard limit to untap it). Both actions reference the card by
 * `cardInstanceId`; this returns whichever is currently viable, or `null`.
 *
 * Exported so the cards-in-play renderer can wire a board click handler and
 * the behaviour can be regression-tested without a full DOM render.
 */
export function findCardsInPlayTapAction(
  actions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): GameAction | null {
  return (
    actions.find(
      a =>
        (a.type === 'tap-hazard-card-for-limit' || a.type === 'pay-hazard-limit-to-untap-card')
        && a.cardInstanceId === cardInstanceId,
    ) ?? null
  );
}

/**
 * Find a viable `discard-card-for-hazard-limit` activation for the given
 * card-in-play instance (the Dragon "At Home" permanent events, e.g. Daelomin
 * at Home td-11).
 *
 * During the opponent's movement/hazard phase the hazard player may discard the
 * card from play — not against the hazard limit — to increase the hazard limit
 * against the active company. The action is fully specified (it targets the
 * active company), so the board can fire it immediately on click.
 *
 * Exported so the cards-in-play renderer can wire a board click handler and the
 * behaviour can be regression-tested without a full DOM render.
 */
export function findDiscardForHazardLimitAction(
  actions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): GameAction | null {
  return (
    actions.find(
      a => a.type === 'discard-card-for-hazard-limit' && a.cardInstanceId === cardInstanceId,
    ) ?? null
  );
}

/**
 * Find the viable `activate-org-fetch` activation for the given card-in-play
 * instance (A Strident Spawn wh-61: "During your organization phase, you may
 * take one Half-orc character from your discard pile to your hand").
 *
 * The engine offers at most one such action per source card; firing it
 * enqueues the shared pick-one-or-pass fetch flow, so the board only needs to
 * dispatch the action itself. Without this the card had no board affordance
 * and the ability was only reachable from the debug action panel (bug
 * report d9f80cd5e5f57819).
 *
 * Exported so the cards-in-play renderer can wire a board click handler and
 * the behaviour can be regression-tested without a full DOM render.
 */
export function findOrgPhaseFetchAction(
  actions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): ActivateOrgFetchAction | null {
  return (
    actions.find(
      (a): a is ActivateOrgFetchAction =>
        a.type === 'activate-org-fetch' && a.cardInstanceId === cardInstanceId,
    ) ?? null
  );
}

/**
 * Find the viable `tap-alt-permanent-event` activations for an in-play
 * dual-mode creature-permanent-event (Adûnaphel tw-2, Ûvatha tw-107).
 *
 * Tapping the card during the opponent's movement/hazard phase turns it into a
 * short-event. The engine emits one action per eligible target for a
 * `tap-character` on-tap effect (tw-2 — one per untapped character of either
 * player) or a single targetless action otherwise (tw-107). Returns all such
 * actions for the card so the renderer can decide between an immediate fire and
 * a two-step character-target selection.
 *
 * Exported so the cards-in-play renderer can wire a board click handler and the
 * behaviour can be regression-tested without a full DOM render.
 */
export function findTapAltPermanentEventActions(
  actions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): TapAltPermanentEventAction[] {
  return actions.filter(
    (a): a is TapAltPermanentEventAction =>
      a.type === 'tap-alt-permanent-event' && a.cardInstanceId === cardInstanceId,
  );
}

/**
 * Find the viable `activate-granted-action` activations granted by a bare
 * in-play card (a `cardsInPlay` entry with no bearer), e.g. The Lidless Eye
 * (le-203) / Sauron (ba-43) offering `sauron-sideboard-fetch` and
 * `sauron-peek-hand` during the controller's organization phase.
 *
 * Such a permanent has no activating character, so the engine self-references
 * the source instance in both `characterId` and `sourceCardId` and puts the
 * chosen card (a sideboard card to fetch, a hand card to discard) in
 * `targetCardId` — one action per candidate. Returns every activation whose
 * source is this card so the renderer can highlight it and offer the choice.
 *
 * Exported so the cards-in-play renderer can wire a board click handler and the
 * behaviour can be regression-tested without a full DOM render.
 */
export function findInPlayGrantedActions(
  actions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): ActivateGrantedAction[] {
  return actions.filter(
    (a): a is ActivateGrantedAction =>
      a.type === 'activate-granted-action' && a.sourceCardId === cardInstanceId,
  );
}

/**
 * Find the viable `pay-event-maintenance` actions for the in-play event
 * `cardInstanceId` is the upkeep source of (Thrice Outnumbered le-142,
 * Balance Between Powers dm-118). One action per way to resolve the current
 * stage — give the card up, decline to bid, or discard one of the actor's
 * matching hand cards — all keyed to the same `sourceInstanceId`.
 *
 * Exported so the cards-in-play renderer can wire a board click handler and
 * the behaviour can be regression-tested without a full DOM render.
 */
export function findEventMaintenanceActions(
  actions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
): PayEventMaintenanceAction[] {
  return actions.filter(
    (a): a is PayEventMaintenanceAction =>
      a.type === 'pay-event-maintenance' && a.sourceInstanceId === cardInstanceId,
  );
}

/**
 * Build the tooltip menu label for one `pay-event-maintenance` action.
 * `discard-self` and `decline` both name the source event itself (`sourceName`);
 * `discard-from-hand` names whichever hand card that specific action pays
 * with, resolved through the cached instance lookup.
 */
export function eventMaintenanceActionLabel(
  action: PayEventMaintenanceAction,
  sourceName: string,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  if (action.paymentType === 'discard-self') return `Discard ${sourceName}`;
  if (action.paymentType === 'decline') return 'Decline';
  const handDefId = getCachedInstanceLookup()(action.cardInstanceId);
  const handName = handDefId ? cardPool[handDefId as string]?.name : undefined;
  return `Discard ${handName ?? 'card'} from hand`;
}

/**
 * Resolve the `tap-alt-permanent-event` action that taps `targetCharacterId`
 * using the already-selected in-play permanent-event `cardInstanceId`, or
 * `null` if no such target is offered. Backs the second click of the two-step
 * targeting flow (e.g. Adûnaphel tw-2 tapping any one character).
 */
export function findTapAltPermanentEventTarget(
  actions: readonly GameAction[],
  cardInstanceId: CardInstanceId,
  targetCharacterId: CardInstanceId,
): TapAltPermanentEventAction | null {
  return (
    findTapAltPermanentEventActions(actions, cardInstanceId).find(
      a => a.targetCharacterId === targetCharacterId,
    ) ?? null
  );
}

/**
 * Find the viable `opponent-influence-attempt` actions by `selectedInfluencer`
 * that target this in-play card (a `cardsInPlay` entry with no bearer — most
 * commonly a faction, the only kind of card an opponent-influence attempt can
 * target that never sits inside a company block).
 *
 * Character/ally/item targets live inside a rendered company block and are
 * wired by `addOpponentInfluenceTargets` on that block; a bare `cardsInPlay`
 * permanent has no such block, so the flat cards-in-play row needs its own
 * lookup to make it a valid second click of the targeting flow.
 *
 * Exported so the cards-in-play renderer can wire a board click handler and
 * the behaviour can be regression-tested without a full DOM render.
 */
export function findOpponentInfluenceTargetActions(
  actions: readonly GameAction[],
  selectedInfluencer: CardInstanceId,
  targetInstanceId: CardInstanceId,
): OpponentInfluenceAttemptAction[] {
  return actions.filter(
    (a): a is OpponentInfluenceAttemptAction =>
      a.type === 'opponent-influence-attempt'
      && a.influencingCharacterId === selectedInfluencer
      && a.targetInstanceId === targetInstanceId,
  );
}

/**
 * Render a single in-play permanent (a `cardsInPlay` entry) as a board card
 * image with its interactive affordances wired: short-event discard-target
 * highlighting, opponent-influence targeting, dual-mode creature-permanent
 * tap, hazard-limit tap/untap, and discard-for-hazard-limit. Shared by the
 * flat cards-in-play row and the per-company attachments strip so a
 * company-bound permanent keeps the same click behaviour wherever it renders.
 *
 * When the card carries `attachedToSite` (e.g. *No Strangers at this Time*
 * as-51), the returned element is wrapped in a `.company-card-wrapper` with a
 * `.company-card-site-badge` naming the bound site, so a card that has fallen
 * into the flat cards-in-play row (its site no longer occupied by a company —
 * see `renderCardsInPlayRow`) still shows which site it belongs to. Cards
 * rendered inside a company block are bound by `companyId`, not
 * `attachedToSite`, so this only fires in practice from the flat-row call
 * site — computed here anyway to keep the logic in one place.
 *
 * Returns `null` when the card image cannot be created.
 */
function renderInPlayCardImage(
  card: { readonly instanceId: CardInstanceId; readonly definitionId: CardDefinitionId; readonly status?: string; readonly attachedToSite?: CardDefinitionId },
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): HTMLElement | null {
  const img = createCardImageFromDefId(card.definitionId, cardPool, 'company-card', card.instanceId as string);
  if (!img) return null;
  if (card.status === CardStatus.Tapped) img.classList.add('company-card--tapped');
  const selectedSE = getSelectedShortEvent();
  // Highlight as discard target when a short event with discardTargetInstanceId is selected
  if (selectedSE && onAction) {
    const seAction = viableActions(view.legalActions).find(
      (a): a is PlayShortEventAction => a.type === 'play-short-event'
        && a.cardInstanceId === selectedSE
        && a.discardTargetInstanceId === card.instanceId,
    );
    if (seAction) {
      img.classList.add('company-card--influence-target');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        clearShortEventSelection();
        onAction(seAction);
      });
    }
  }
  else if (onAction && getSelectedInfluencerForOpponent()) {
    const selectedInfluencer = getSelectedInfluencerForOpponent()!;
    const oppInfluenceActions = findOpponentInfluenceTargetActions(
      viableActions(view.legalActions), selectedInfluencer, card.instanceId,
    );
    if (oppInfluenceActions.length > 0) {
      img.classList.add('company-card--influence-target');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (oppInfluenceActions.length === 1) {
          clearOpponentInfluenceSelection();
          onAction(oppInfluenceActions[0]);
        } else {
          showOpponentInfluenceMenu(e, oppInfluenceActions, onAction);
        }
      });
    }
  }
  else if (onAction && getSelectedPermanentEventForLongEventTarget()) {
    // Long-event-targeting permanent event selected from hand (Echo of All
    // Joy td-110): highlight own in-play resource long-events this specific
    // action can attach to, and dispatch on click. Without this the player
    // had no way to pick which long-event a second protector attached to —
    // it silently bound to whichever instance the engine listed first (bug
    // e1b9f49abb624834).
    const selectedHandCard = getSelectedPermanentEventForLongEventTarget()!;
    const targetAction = viableActions(view.legalActions).find(
      (a): a is PlayPermanentEventAction => a.type === 'play-permanent-event'
        && a.cardInstanceId === selectedHandCard
        && a.targetLongEventInstanceId === card.instanceId,
    );
    if (targetAction) {
      img.classList.add('company-card--influence-target');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        clearPermanentEventLongEventTargetSelection();
        onAction(targetAction);
      });
    }
  }
  else if (onAction) {
    // Dual-mode creature-permanent-events (Adûnaphel tw-2, Ûvatha tw-107):
    // clicking the in-play card taps it ("becomes a short-event"). For a
    // tap-character on-tap effect (tw-2) the tap needs a target character, so
    // clicking selects the card and highlights eligible characters for a
    // second click; otherwise (tw-107, whose follow-up is a pending flow) the
    // single action fires immediately. Without this the only way to tap was
    // the debug action panel — the card was untappable from the board.
    const tapAltActions = findTapAltPermanentEventActions(viableActions(view.legalActions), card.instanceId);
    // Power Built by Waiting (as-34) and similar hazard-limit-swap permanents:
    // clicking the card-in-play taps it for +hazard limit, or (when tapped)
    // spends hazard limit to untap it. Without this the only way to activate
    // the card was the debug action panel — it was invisible on the board.
    const tapAction = findCardsInPlayTapAction(viableActions(view.legalActions), card.instanceId);
    // Dragon "At Home" permanents (Daelomin at Home td-11): clicking the
    // in-play card discards it for +hazard limit against the active company.
    // Without this the only way to trigger the discard was the debug action
    // panel — the card had no board affordance.
    const discardForLimitAction = findDiscardForHazardLimitAction(viableActions(view.legalActions), card.instanceId);
    // Org-phase fetch permanents (A Strident Spawn wh-61): clicking the
    // in-play card fires the once-per-turn discard-pile-to-hand fetch. Without
    // this the card had no board affordance and the ability was only
    // reachable from the debug action panel.
    const orgFetchAction = findOrgPhaseFetchAction(viableActions(view.legalActions), card.instanceId);
    // Bearer-less granted actions (The Lidless Eye le-203 / Sauron ba-43:
    // sideboard-fetch and peek-opponent's-hand): the permanent itself is the
    // source, so clicking it opens the ability menu. Without this the card was
    // never highlighted and the ability was only reachable from the debug
    // action panel.
    const grantedActions = findInPlayGrantedActions(viableActions(view.legalActions), card.instanceId);
    // Event-maintenance upkeep (Thrice Outnumbered le-142, Balance Between
    // Powers dm-118): clicking the maintained permanent offers every way to
    // resolve the current stage — give it up, decline to bid, or discard a
    // matching hand card. Without this the player had no affordance at all:
    // the pass button's whitelist doesn't cover `pay-event-maintenance`
    // either, so the game looked frozen (bug fc2f6484500c88f1).
    const maintenanceActions = findEventMaintenanceActions(viableActions(view.legalActions), card.instanceId);
    if (tapAltActions.length > 0) {
      const isSelected = getSelectedTapAltPermanentEvent() === card.instanceId;
      img.classList.add('company-card--movable');
      if (isSelected) img.classList.add('company-card--influence-source');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        const withTarget = tapAltActions.filter(a => a.targetCharacterId);
        if (withTarget.length === 0) {
          // No character to choose (e.g. tw-107): fire the single action.
          clearTapAltPermanentEventSelection();
          onAction(tapAltActions[0]);
          return;
        }
        // Toggle the two-step character-targeting selection.
        setSelectedTapAltPermanentEvent(isSelected ? null : card.instanceId);
        setTargetingInstruction(isSelected ? null : 'Click a character to tap');
        rerender();
      });
    } else if (tapAction) {
      img.classList.add('company-card--movable');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction(tapAction);
      });
    } else if (discardForLimitAction) {
      img.classList.add('company-card--movable');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction(discardForLimitAction);
      });
    } else if (orgFetchAction) {
      img.classList.add('company-card--movable');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction(orgFetchAction);
      });
    } else if (grantedActions.length > 0) {
      img.classList.add('company-card--movable');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        showInPlayGrantedActionMenu(img, grantedActions, cardPool, onAction);
      });
    } else if (maintenanceActions.length > 0) {
      img.classList.add('company-card--movable');
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        if (maintenanceActions.length === 1) {
          onAction(maintenanceActions[0]);
          return;
        }
        const sourceName = cardPool[card.definitionId as string]?.name ?? 'the card';
        showTooltipMenu(
          img,
          maintenanceActions.map(action => ({
            label: eventMaintenanceActionLabel(action, sourceName, cardPool),
            onClick: () => onAction(action),
          })),
          { placement: 'auto' },
        );
      });
    }
  }

  if (card.attachedToSite) {
    const siteName = cardPool[card.attachedToSite as string]?.name;
    if (siteName) {
      img.dataset.attachedSiteName = siteName;
      const wrapper = document.createElement('div');
      wrapper.className = 'company-card-wrapper';
      wrapper.appendChild(img);
      const badge = document.createElement('div');
      badge.className = 'company-card-site-badge';
      badge.textContent = siteName;
      badge.title = siteName;
      wrapper.appendChild(badge);
      return wrapper;
    }
  }

  return img;
}

export function renderCardsInPlayRow(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  // Cards bound to a site occupied by one of a player's companies are rendered
  // beneath that site (see renderSiteArea), and cards bound to a rendered
  // company are shown inside that company's block (see renderCompanyBlock),
  // so drop both from the flat row to avoid showing them twice. Bound cards
  // whose site/company is not on the board stay here.
  const cachedInstanceLookup = getCachedInstanceLookup();
  const presentSiteDefIds = (companies: readonly (Company | OpponentCompanyView)[]): Set<string> => {
    const ids = new Set<string>();
    for (const c of companies) {
      if (!c.currentSite) continue;
      const defId = cachedInstanceLookup(c.currentSite.instanceId);
      if (defId) ids.add(defId as string);
    }
    return ids;
  };
  const selfPresent = presentSiteDefIds(view.self.companies);
  const oppPresent = presentSiteDefIds(view.opponent.companies);
  const presentCompanyIds = new Set<string>(
    [...view.self.companies, ...view.opponent.companies].map(c => c.id as string),
  );
  const selfCards = view.self.cardsInPlay.filter(c =>
    !isAttachedToPresentSite(c, selfPresent) && !isAttachedToPresentCompany(c, presentCompanyIds));
  const oppCards = view.opponent.cardsInPlay.filter(c =>
    !isAttachedToPresentSite(c, oppPresent) && !isAttachedToPresentCompany(c, presentCompanyIds));
  if (selfCards.length === 0 && oppCards.length === 0) return;

  const row = document.createElement('div');
  row.className = 'cards-in-play-row';
  row.style.setProperty('--company-scale', '0.6');

  const renderGroup = (cards: readonly { instanceId: CardInstanceId; definitionId: CardDefinitionId; status?: string; attachedToSite?: CardDefinitionId }[], className: string) => {
    if (cards.length === 0) return;
    const group = document.createElement('div');
    group.className = className;
    for (const card of cards) {
      const img = renderInPlayCardImage(card, view, cardPool, onAction);
      if (img) group.appendChild(img);
    }
    row.appendChild(group);
  };

  renderGroup(selfCards, 'cards-in-play-group');
  renderGroup(oppCards, 'cards-in-play-group');
  container.appendChild(row);
}
