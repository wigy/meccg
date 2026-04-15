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
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  StartSideboardToDeckAction,
  StartSideboardToDiscardAction,
  CorruptionCheckAction,
  SupportCorruptionCheckAction,
  ActivateGrantedAction,
  OpponentInfluenceAttemptAction,
} from '@meccg/shared';
import { cardImageProxyPath, Phase, CardStatus, viableActions, getTitleCharacter } from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { createCardImage } from './render-utils.js';
import { getSelectedFactionForInfluence, clearFactionInfluenceSelection, getSelectedResourceForPlay, clearResourcePlaySelection, getSelectedAllyForPlay, clearAllyPlaySelection, getSelectedHazardForPlay, clearHazardPlaySelection, getSelectedInfluencerForOpponent, setSelectedInfluencerForOpponent, clearOpponentInfluenceSelection, getSelectedShortEvent, clearShortEventSelection, setTargetingInstruction } from './render.js';
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
import { showCharacterActionTooltip, showGrantedActionTooltip } from './company-modals.js';
import { switchToAllCompanies } from './company-view.js';

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
  let isInactive = view.phaseState.phase !== Phase.FreeCouncil
    && ((owner === 'self' && !isSelfTurn) || (owner === 'opponent' && isSelfTurn));

  // During M/H phase (after select-company), dim all companies except the active one
  if (view.phaseState.phase === Phase.MovementHazard) {
    const mh = view.phaseState;
    if (mh.step !== 'select-company') {
      const resourceCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
      const activeCompany = resourceCompanies[mh.activeCompanyIndex];
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
  row.appendChild(renderSiteArea(company, view, cardPool, {
    hasLegalMovement: options?.hasLegalMovement,
    onAction: options?.onAction,
  }));

  // Characters — title character always rendered first (leftmost after site).
  // Followers are rendered nested under their controlling character, not as
  // separate columns, so collect follower IDs to skip in the main loop.
  const followerIds = new Set<string>();
  for (const charInstId of company.characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    for (const fId of char.followers) {
      followerIds.add(fId as string);
    }
  }

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

  /** Build the item click handler for an item on a character, if applicable. */
  const buildItemClick = (itemInstId: CardInstanceId, charInstId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
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

    // Not in targeting mode — check if this item has transfer actions
    if (!options.transferActions) return undefined;
    const actions = options.transferActions.get(itemInstId as string);
    if (!actions || actions.length === 0) return undefined;

    const allRegress = actions.every(a => a.regress);
    const cls = allRegress ? '' : 'company-card--transfer-source';

    // Always enter targeting mode — even with a single target, ask explicitly
    return {
      cls,
      handler: (e) => {
        e.stopPropagation();
        setTransferItemSourceId(itemInstId);
        setTransferItemFromCharId(charInstId);
        const itemDefId = cachedInstanceLookup(itemInstId);
        const itemName = itemDefId ? cardPool[itemDefId as string]?.name : undefined;
        setTargetingInstruction(
          `Click a highlighted character to receive ${itemName ?? 'item'}`,
        );
        rerender();
      },
    };
  };

  /** Build click handler for cards with granted actions (hazards or items like Cram). */
  const buildHazardClick = (instId: CardInstanceId): { cls: string; handler: (e: Event) => void } | undefined => {
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
      const influenceAction = viableActions(view.legalActions).find(
        a => a.type === 'influence-attempt'
          && a.factionInstanceId === selectedFaction
          && a.influencingCharacterId === charInstId,
      );
      if (influenceAction) {
        return {
          cls: 'company-card--influence-target',
          handler: (e) => {
            e.stopPropagation();
            clearFactionInfluenceSelection();
            options?.onAction?.(influenceAction);
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

    // Check for opponent influence actions
    const oppInfluenceActions = viableActions(view.legalActions).filter(
      (a): a is OpponentInfluenceAttemptAction =>
        a.type === 'opponent-influence-attempt' && a.influencingCharacterId === charInstId,
    );
    const hasOppInfluence = oppInfluenceActions.length > 0;

    // Count how many action types are available
    const actionTypes = [influenceResult, companyResult, mergeActionsForChar, hasSideboard, ccAction, ccSupportAction, hasOppInfluence].filter(Boolean).length;

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
        || (ccAction ? 'company-card--influence-source' : '');
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

  if (titleChar) {
    row.appendChild(renderCharacterColumn(titleChar, cardPool, true, charMap, buildCombinedClick(titleChar.instanceId), buildCombinedClick, buildItemClick, buildHazardClick));
  }
  for (const charInstId of company.characters) {
    if (followerIds.has(charInstId as string)) continue;
    const char = charMap[charInstId as string];
    if (!char) continue;
    if (titleChar && char.instanceId === titleChar.instanceId) continue;
    row.appendChild(renderCharacterColumn(char, cardPool, false, charMap, buildCombinedClick(charInstId), buildCombinedClick, buildItemClick, buildHazardClick));
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
export function renderCardsInPlayRow(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const selfCards = view.self.cardsInPlay;
  const oppCards = view.opponent.cardsInPlay;
  if (selfCards.length === 0 && oppCards.length === 0) return;

  const row = document.createElement('div');
  row.className = 'cards-in-play-row';
  row.style.setProperty('--company-scale', '0.6');

  const renderGroup = (cards: readonly { instanceId: CardInstanceId; definitionId: CardDefinitionId; status?: string }[], className: string) => {
    if (cards.length === 0) return;
    const group = document.createElement('div');
    group.className = className;
    for (const card of cards) {
      const def = cardPool[card.definitionId as string];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;
      const img = createCardImage(card.definitionId as string, def, imgPath, 'company-card', card.instanceId as string);
      if (card.status === CardStatus.Tapped) img.classList.add('company-card--tapped');
      group.appendChild(img);
    }
    row.appendChild(group);
  };

  renderGroup(selfCards, 'cards-in-play-group');
  renderGroup(oppCards, 'cards-in-play-group');
  container.appendChild(row);
}
