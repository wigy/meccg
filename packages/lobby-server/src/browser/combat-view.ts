/**
 * @module combat-view
 *
 * Renders the combat arena as a third view mode in the visual board,
 * activated automatically when `view.combat` is non-null. Displays
 * two rows of combatants (attacker vs defender) with SVG arrows
 * showing strike assignments between them.
 *
 * Perspective depends on the viewing player: if you are the defender,
 * your characters appear on the bottom row; if you are the attacker,
 * the creature you played is on the bottom and defenders are on top.
 */

import type {
  PlayerView,
  GameAction,
  CardDefinition,
  CombatState,
  CharacterInPlay,
  Company,
  OpponentCompanyView,
  AssignStrikeAction,
  SupportStrikeAction,
  ChooseStrikeOrderAction,
  CancelByTapAction,
  CancelStrikeAction,
  CancelAttackAction,
  ModifyAttackAction,
  TapItemForStrikeAction,
  FaceStrikeOnTapAction,
  SalvageItemAction,
  EvaluatedAction,
  CardEffect,
} from '@meccg/shared';
import { cardImageProxyPath, viableActions, CardStatus, buildInstanceLookup, effectiveItemCorruptionPoints, isItemCard } from '@meccg/shared';
import { combatButtonLabel } from './combat-button-label.js';
import { withDetainmentSuffix } from './combat-detainment-suffix.js';
import { withIsolatedSuffix } from './combat-isolated-suffix.js';
import { inPlayCancelAttackIds, groupCancelAttackActionsByScout } from './cancel-attack-targets.js';
import { resolveAttackerCardInstanceId } from './attacker-card-instance.js';
import { resolveCardElement } from './combat-arrow-card-el.js';
import { resolveFaceStrikeOnTapAction } from './combat-face-strike-action.js';
import { strikeResultDisplay } from './strike-result-display.js';
import type { CardInstanceId, CardDefinitionId } from '@meccg/shared';
import { createCardImage, createCardImageFromDefId, inPlayCardDefs, findIsolatingEventName } from './render-utils.js';
import { showTooltipMenu, type TooltipMenuItem } from './tooltip-menu.js';
import { getSelectedCancelAttack, clearCancelAttackSelection, getSelectedCvCCAttacker, setSelectedCvCCAttacker, clearSelectedCvCCAttacker, getSelectedCvCCDefender, setSelectedCvCCDefender, clearSelectedCvCCDefender } from './render-selection-state.js';
import { setAllCompaniesOverride, rerender } from './company-view-state.js';
import { createRadar } from './map-radar.js';
import { openFullMap } from './map-fullscreen.js';
import { loadCoordinates, areCoordinatesLoaded } from './map-coordinates.js';
import { getFocusedCompanyId, setSavedFocusedCompanyId, setFocusedCompanyId } from './company-view-state.js';

/** Cached instance-to-definition lookup, updated each time the view changes. */
let cachedInstanceLookup: ((id: CardInstanceId) => CardDefinitionId | undefined) = () => undefined;

/**
 * Corruption points per attached-card instance (items via the effective-CP
 * helper, corruption hazards via their printed CP), rebuilt each render.
 * Drives the CP badges on the battle screen so the stakes of a coming
 * corruption check are visible mid-combat.
 */
let cachedItemCp: Map<string, number> = new Map();

/**
 * Wrap an attachment card with its CP badge (same look as the company
 * view's item badges) when the instance carries corruption points.
 */
function withItemCpBadge(itemEl: HTMLElement, instanceId: string): HTMLElement {
  const cp = cachedItemCp.get(instanceId);
  if (!cp) return itemEl;
  const wrap = document.createElement('div');
  wrap.className = 'item-card-wrap';
  wrap.appendChild(itemEl);
  const badge = document.createElement('div');
  badge.className = 'item-cp-badge';
  badge.textContent = `${cp} CP`;
  wrap.appendChild(badge);
  return wrap;
}

/** Remove any combat action buttons from the bottom-right corner. */
export function clearCombatButtons(): void {
  for (const old of document.querySelectorAll('.combat-visual-btn')) old.remove();
}

/**
 * Render the combat arena into the visual board container.
 * Replaces the normal company view while combat is active.
 */
export function renderCombatView(
  board: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const combat = view.combat;
  if (!combat) return;

  cachedInstanceLookup = buildInstanceLookup(view);

  // CP badges for every attached card on the arena: items use the same
  // effective-CP computation as the company view; permanent corruption
  // hazards (e.g. Lure of the Senses) use their printed CP.
  cachedItemCp = new Map();
  const inPlayDefs = inPlayCardDefs(view, cardPool);
  for (const player of [view.self, view.opponent]) {
    for (const char of Object.values(player.characters)) {
      for (const item of char.items) {
        const def = cardPool[item.definitionId as string];
        if (def && isItemCard(def)) {
          const cp = effectiveItemCorruptionPoints(def, inPlayDefs, player.alignment);
          if (cp > 0) cachedItemCp.set(item.instanceId as string, cp);
        }
      }
      for (const hazard of char.hazards) {
        const def = cardPool[hazard.definitionId as string] as { corruptionPoints?: number } | undefined;
        if (def?.corruptionPoints && def.corruptionPoints > 0) {
          cachedItemCp.set(hazard.instanceId as string, def.corruptionPoints);
        }
      }
    }
  }

  const arena = document.createElement('div');
  arena.className = 'combat-arena';

  // Determine perspective: defender sees own characters on bottom
  const iAmDefender = view.self.id === combat.defendingPlayerId;

  // Phase banner
  arena.appendChild(renderPhaseBanner(combat, iAmDefender, view, cardPool));

  // Gather legal actions for click handlers
  const viable = viableActions(view.legalActions);
  const assignActions = viable.filter((a): a is AssignStrikeAction => a.type === 'assign-strike');
  const supportActions = viable.filter((a): a is SupportStrikeAction => a.type === 'support-strike');
  const chooseOrderActions = viable.filter((a): a is ChooseStrikeOrderAction => a.type === 'choose-strike-order');
  const cancelByTapActions = viable.filter((a): a is CancelByTapAction => a.type === 'cancel-by-tap');
  const cancelStrikeActions = viable.filter((a): a is CancelStrikeAction => a.type === 'cancel-strike');
  const cancelAttackActions = viable.filter((a): a is CancelAttackAction => a.type === 'cancel-attack');
  const modifyAttackActions = viable.filter((a): a is ModifyAttackAction => a.type === 'modify-attack');
  const tapItemForStrikeActions = viable.filter((a): a is TapItemForStrikeAction => a.type === 'tap-item-for-strike');
  const faceStrikeOnTapActions = viable.filter((a): a is FaceStrikeOnTapAction => a.type === 'face-strike-on-tap');
  const salvageActions = viable.filter((a): a is SalvageItemAction => a.type === 'salvage-item');

  // Two-step attacker selection is used in two CvCC sub-phases:
  // - 'attacker': the attacker pairs their untapped characters with defenders
  // - 'defender-any': the defender assigns remaining unpaired attackers to any of their characters
  // Clear stale selection whenever we leave these phases.
  const inCvCCTwoStepPhase = !!combat.isCvCC
    && combat.phase === 'assign-strikes'
    && ((combat.assignmentPhase === 'attacker' && view.self.id === combat.attackingPlayerId)
      || (combat.assignmentPhase === 'defender-any' && view.self.id === combat.defendingPlayerId));
  if (!inCvCCTwoStepPhase) clearSelectedCvCCAttacker();
  const selectedCvCCAttacker = getSelectedCvCCAttacker();

  // Two-step defender selection is used in the CvCC defender phase:
  // - 'defender': the defender (iAmDefender) picks one of their untapped chars first (golden),
  //   then clicks an unpaired attacker (blue) to create the full pair.
  // Clear stale selection whenever we leave this phase.
  const inCvCCDefenderPhase = !!combat.isCvCC
    && iAmDefender
    && combat.phase === 'assign-strikes'
    && combat.assignmentPhase === 'defender';
  if (!inCvCCDefenderPhase) clearSelectedCvCCDefender();
  const selectedCvCCDefender = getSelectedCvCCDefender();

  // Build attacker row and defender row
  const attackerRow = renderAttackerRow(combat, view, cardPool, assignActions, selectedCvCCAttacker, selectedCvCCDefender, iAmDefender, onAction);
  const defenderRow = renderDefenderRow(combat, view, cardPool, assignActions, supportActions, chooseOrderActions, cancelByTapActions, cancelStrikeActions, cancelAttackActions, modifyAttackActions, tapItemForStrikeActions, faceStrikeOnTapActions, selectedCvCCAttacker, selectedCvCCDefender, onAction);

  // Top row is the "opponent" side, bottom row is "my" side
  const topRow = document.createElement('div');
  topRow.className = 'combat-row combat-row--top';

  const bottomRow = document.createElement('div');
  bottomRow.className = 'combat-row combat-row--bottom';

  if (iAmDefender) {
    topRow.appendChild(attackerRow);
    bottomRow.appendChild(defenderRow);
  } else {
    topRow.appendChild(defenderRow);
    bottomRow.appendChild(attackerRow);
  }

  arena.appendChild(topRow);

  // Salvage items panel — rendered between the two rows during item-salvage phase
  if (combat.phase === 'item-salvage' && iAmDefender && salvageActions.length > 0) {
    arena.appendChild(renderSalvagePanel(combat, view, cardPool, salvageActions, onAction));
  }

  // SVG arrows placeholder — drawn after layout
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('combat-arrows');
  // Arrow marker definition
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="combat-arrowhead" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="rgba(220, 100, 60, 0.9)" />
    </marker>
    <marker id="combat-arrowhead-success" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="rgba(80, 200, 80, 0.9)" />
    </marker>
    <marker id="combat-arrowhead-wound" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="rgba(200, 50, 50, 0.9)" />
    </marker>
  `;
  svg.appendChild(defs);
  arena.appendChild(svg);

  arena.appendChild(bottomRow);

  board.appendChild(arena);

  // Toggle button: switch to all-companies overview while combat is active
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'company-view-toggle';
  toggleBtn.title = 'Show all companies';
  toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="1" fill="currentColor"/><rect x="3" y="13" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="13" width="8" height="8" rx="1" fill="currentColor"/></svg>';
  toggleBtn.onclick = () => {
    setAllCompaniesOverride(true);
    rerender();
  };
  board.appendChild(toggleBtn);

  // Radar minimap
  const selfIndex = Math.max(0, view.self.companies.findIndex(c => c.id === getFocusedCompanyId()));
  const attachRadar = () => {
    const radar = createRadar(view, selfIndex, cardPool);
    if (radar) {
      board.appendChild(radar);
      radar.addEventListener('map-radar-click', () => {
        openFullMap(view, selfIndex, cardPool, (idx) => {
          setFocusedCompanyId(view.self.companies[idx]?.id ?? null);
          setSavedFocusedCompanyId(view.self.companies[idx]?.id ?? null);
          rerender();
        });
      });
    }
  };
  if (areCoordinatesLoaded()) {
    attachRadar();
  } else {
    void loadCoordinates().then(() => rerender()).catch(() => {});
  }

  // Render combat action buttons in the bottom-right corner (same area as pass button)
  renderCombatActionButtons(viable, view.legalActions, onAction);

  // Draw arrows after DOM layout is computed (double-rAF to ensure layout is settled)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawStrikeArrows(svg, combat, iAmDefender);
    });
  });
}

// ---- Phase banner ----

/** Render the situation banner for the current combat phase. */
function renderPhaseBanner(
  combat: CombatState,
  iAmDefender: boolean,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'situation-banner';

  // Resolve the attacker's display label — a creature's race, a site
  // automatic-attack's printed creature type, or an agent's card name.
  let attackerRace = '';
  if (
    combat.attackSource.type === 'creature'
    || combat.attackSource.type === 'on-guard-creature'
    || combat.attackSource.type === 'played-auto-attack'
  ) {
    const instId = combat.attackSource.type === 'on-guard-creature'
      ? combat.attackSource.cardInstanceId
      : combat.attackSource.instanceId;
    const defId = cachedInstanceLookup(instId);
    const def = defId ? cardPool[defId as string] : undefined;
    if (def && def.cardType === 'hazard-creature' && def.race) {
      attackerRace = def.race;
    }
  } else if (combat.attackSource.type === 'automatic-attack') {
    const siteDefId = cachedInstanceLookup(combat.attackSource.siteInstanceId);
    const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
    if (siteDef && 'automaticAttacks' in siteDef) {
      const aa = (siteDef as { automaticAttacks: readonly { creatureType: string }[] }).automaticAttacks[combat.attackSource.attackIndex];
      if (aa) attackerRace = aa.creatureType;
    }
  } else if (combat.attackSource.type === 'agent') {
    const defId = cachedInstanceLookup(combat.attackSource.instanceId);
    const def = defId ? cardPool[defId as string] : undefined;
    if (def && 'name' in def) attackerRace = (def as { name: string }).name;
  } else if ((combat.attackSource.type === 'card-triggered-attack'
    || combat.attackSource.type === 'siege-attack') && combat.creatureRace) {
    attackerRace = combat.creatureRace;
  } else if (combat.attackSource.type === 'tidings-attack') {
    const company = findCompany(combat.companyId, view);
    const destSite = company
      ? ('destinationSite' in company ? company.destinationSite : company.revealedDestinationSite)
      : null;
    if (destSite) {
      const siteDefId = cachedInstanceLookup(destSite.instanceId);
      const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
      if (siteDef && 'automaticAttacks' in siteDef) {
        const aa = (siteDef as { automaticAttacks: readonly { creatureType: string }[] }).automaticAttacks[combat.attackSource.attackIndex];
        if (aa) attackerRace = aa.creatureType;
      }
    }
  }
  const raceLabel = attackerRace ? formatAttackerLabel(attackerRace) : '';
  const racePrefix = raceLabel ? `${raceLabel} \u2014 ` : '';

  let phaseText: string;
  if (combat.isCvCC) {
    // CvCC-specific phase display
    const cvccPrefix = 'Company vs Company Combat — ';
    if (combat.phase === 'assign-strikes') {
      const whose = combat.assignmentPhase === 'defender'
        ? (iAmDefender ? 'Your turn (assign untapped defenders)' : 'Defender assigns untapped characters')
        : combat.assignmentPhase === 'attacker'
          ? (!iAmDefender ? 'Your turn (pair your untapped attackers)' : 'Attacker pairs their characters')
          : combat.assignmentPhase === 'defender-any'
            ? (iAmDefender ? 'Your turn (assign remaining attackers to any character)' : 'Defender assigns remaining attackers')
            : 'Assigned';
      const pairedCount = combat.strikeAssignments.filter((a: { attackingCharacterId?: unknown }) => a.attackingCharacterId != null).length;
      phaseText = `${cvccPrefix}${whose} • ${pairedCount} of ${combat.strikesTotal} paired`;
    } else if (combat.phase === 'choose-strike-order') {
      const resolved = combat.strikeAssignments.filter((sa: { resolved: boolean }) => sa.resolved).length;
      phaseText = `${cvccPrefix}Choose next strike to resolve (${resolved} of ${combat.strikesTotal} resolved)`;
    } else if (combat.phase === 'resolve-strike') {
      const resolved = combat.strikeAssignments.filter((sa: { resolved: boolean }) => sa.resolved).length;
      const currentStrike = combat.strikeAssignments[combat.currentStrikeIndex] as { attackerTapToFight?: boolean } | undefined;
      const sub = currentStrike?.attackerTapToFight === undefined
        ? (!iAmDefender ? 'Your turn — tapping or not tapping (-3)' : 'Attacker declares tap choice')
        : (iAmDefender ? 'Your turn — tapping or not tapping (-3)' : 'Defender resolves strike');
      const excessSuffix = (combat.cvccExcessPool ?? 0) > 0 ? ` • ${combat.cvccExcessPool} × −1 to assign` : '';
      phaseText = `${cvccPrefix}Resolve Strike ${resolved + 1} of ${combat.strikesTotal} — ${sub}${excessSuffix}`;
    } else if (combat.phase === 'body-check') {
      const bctTarget = (combat as { bodyCheckTarget?: string }).bodyCheckTarget;
      const target = bctTarget === 'attacker-character' ? 'Attacking Character' : 'Defending Character';
      phaseText = `${cvccPrefix}Body Check — ${target}`;
    } else {
      phaseText = `${cvccPrefix}${combat.phase}`;
    }
  } else if (combat.phase === 'assign-strikes' && combat.assignmentPhase === 'cancel-by-tap') {
    const remaining = combat.cancelByTapRemaining ?? 0;
    phaseText = `${racePrefix}Tap a character to cancel an attack \u2014 ${remaining} cancel${remaining !== 1 ? 's' : ''} remaining`;
  } else if (combat.phase === 'assign-strikes') {
    const whose = combat.assignmentPhase === 'defender'
      ? (iAmDefender ? 'Your turn' : "Defender's turn")
      : (iAmDefender ? "Attacker's turn" : 'Your turn');
    const assigned = combat.strikeAssignments.length;
    const remaining = combat.strikesTotal - assigned;
    const strikeLabel = combat.multiAttackCount && combat.multiAttackCount > 1
      ? (() => {
        const strikesPerAttack = combat.strikesTotal / combat.multiAttackCount;
        return `${combat.multiAttackCount} attacks of ${strikesPerAttack} strike${strikesPerAttack !== 1 ? 's' : ''} each`;
      })()
      : `${combat.strikesTotal} strike${combat.strikesTotal !== 1 ? 's' : ''}`;
    phaseText = `${racePrefix}Assign ${strikeLabel} at ${combat.strikeProwess} prowess \u2014 ${whose} \u2022 ${assigned} assigned, ${remaining} remaining`;
  } else if (combat.phase === 'choose-strike-order') {
    const resolved = combat.strikeAssignments.filter(sa => sa.resolved).length;
    phaseText = `${racePrefix}Choose next strike to resolve (${resolved} of ${combat.strikesTotal} resolved)`;
  } else if (combat.phase === 'resolve-strike' && combat.attackSource.type === 'agent' && combat.agentRollTotal === undefined) {
    phaseText = `${racePrefix}Agent rolls for strike`;
  } else if (combat.phase === 'resolve-strike') {
    const resolved = combat.strikeAssignments.filter(sa => sa.resolved).length;
    const agentRollSuffix = combat.attackSource.type === 'agent' && combat.agentRollTotal !== undefined
      ? ` — agent rolled ${combat.agentRollTotal}`
      : '';
    phaseText = `${racePrefix}Resolve Strike ${resolved + 1} of ${combat.strikesTotal}${agentRollSuffix}`;
  } else if (combat.phase === 'item-salvage') {
    const itemCount = combat.salvageItems?.length ?? 0;
    phaseText = `Salvage Items \u2014 ${itemCount} item${itemCount !== 1 ? 's' : ''} available`;
  } else {
    const target = combat.bodyCheckTarget === 'creature' ? 'Creature' : 'Character';
    phaseText = `Body Check \u2014 ${target}`;
  }

  const isolatedText = withIsolatedSuffix(
    phaseText,
    combat.isolated ?? false,
    combat.isolated ? findIsolatingEventName(view, cardPool) : undefined,
  );
  banner.textContent = withDetainmentSuffix(isolatedText, combat.detainment);

  // Append roll explanations from legal actions
  const explanations = collectRollExplanations(view.legalActions);
  for (const text of explanations) {
    const line = document.createElement('div');
    line.className = 'situation-banner-detail';
    line.textContent = text;
    banner.appendChild(line);
  }

  return banner;
}

/** Extract roll explanation strings from legal actions that carry them. */
function collectRollExplanations(actions: readonly EvaluatedAction[]): string[] {
  const explanations: string[] = [];
  for (const ea of actions) {
    if (!ea.viable) continue;
    const a = ea.action;
    if ('explanation' in a && typeof (a as { explanation: string }).explanation === 'string') {
      explanations.push((a as { explanation: string }).explanation);
    }
  }
  return explanations;
}

// ---- Attacker row ----

/** Render the attacker side: creature card + stats. */
function renderAttackerRow(
  combat: CombatState,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  assignActions: AssignStrikeAction[],
  selectedCvCCAttacker: ReturnType<typeof getSelectedCvCCAttacker>,
  selectedCvCCDefender: CardInstanceId | null,
  iAmDefender: boolean,
  onAction: (action: GameAction) => void,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'combat-attacker';

  const attackerCardInstanceId = resolveAttackerCardInstanceId(combat.attackSource);
  if (attackerCardInstanceId) {
    const defId = cachedInstanceLookup(attackerCardInstanceId);
    const def = defId ? cardPool[defId as string] : undefined;
    if (def) {
      const imgPath = cardImageProxyPath(def);
      if (imgPath) {
        const img = createCardImage(defId as string, def, imgPath, 'combat-card combat-card--attacker', attackerCardInstanceId as string);
        container.appendChild(img);
      }
    }
  } else if (combat.attackSource.type === 'automatic-attack') {
    // Show the site card as the attacker
    const defId = cachedInstanceLookup(combat.attackSource.siteInstanceId);
    const def = defId ? cardPool[defId as string] : undefined;
    if (def) {
      const imgPath = cardImageProxyPath(def);
      if (imgPath) {
        const img = createCardImage(defId as string, def, imgPath, 'combat-card combat-card--attacker', combat.attackSource.siteInstanceId as string);
        container.appendChild(img);
      }
    }
  } else if (combat.attackSource.type === 'company-attack' && combat.isCvCC) {
    // CvCC: render each attacking character as their own card column (row layout)
    container.classList.add('combat-attacker--cvcc');
    const attackingCompany = findCompany(combat.attackSource.attackingCompanyId, view);
    if (attackingCompany) {
      const isAttackerMe = view.self.id === combat.attackingPlayerId;
      const attackerCharMap = isAttackerMe ? view.self.characters : view.opponent.characters;
      const attackerStrikeMap = new Map<string, { index: number; assignment: CombatState['strikeAssignments'][number] }>();
      for (let i = 0; i < combat.strikeAssignments.length; i++) {
        const sa = combat.strikeAssignments[i];
        if (sa.attackingCharacterId && !attackerStrikeMap.has(sa.attackingCharacterId as string)) {
          attackerStrikeMap.set(sa.attackingCharacterId as string, { index: i, assignment: sa });
        }
      }
      // Highlight unpaired attackers for first-click in both two-step phases:
      // - 'attacker' phase: driven by the attacker
      // - 'defender-any' phase: driven by the defender (selecting which unpaired attacker to assign)
      // - 'defender' phase: when a defender is selected, show unpaired attackers as blue targets
      const isAttackerAssignPhase = isAttackerMe && !iAmDefender
        && combat.phase === 'assign-strikes' && combat.assignmentPhase === 'attacker';
      const isDefenderAnyPhase = !isAttackerMe && iAmDefender
        && combat.phase === 'assign-strikes' && combat.assignmentPhase === 'defender-any';
      const isCvCCDefenderPhaseWithSelection = !isAttackerMe && iAmDefender
        && combat.phase === 'assign-strikes' && combat.assignmentPhase === 'defender'
        && selectedCvCCDefender !== null;
      const selectableAttackerIds = (isAttackerAssignPhase || isDefenderAnyPhase)
        ? new Set(assignActions.map(a => a.attackingCharacterId as string).filter(Boolean))
        : isCvCCDefenderPhaseWithSelection
          ? new Set(
              assignActions
                .filter(a => (a.characterId as string) === (selectedCvCCDefender as string))
                .map(a => a.attackingCharacterId as string)
                .filter(Boolean),
            )
          : new Set<string>();
      for (const charId of attackingCompany.characters) {
        const char = attackerCharMap[charId];
        if (!char) continue;
        container.appendChild(renderCvCCAttackerCharacterColumn(
          char, cardPool, combat, attackerStrikeMap,
          selectableAttackerIds, selectedCvCCAttacker,
          selectedCvCCDefender, isCvCCDefenderPhaseWithSelection, onAction,
        ));
      }
    }
  } else if (combat.attackSource.type === 'tidings-attack') {
    // Show the destination site card with Tidings of Bold Spies overlaid in the corner
    const company = findCompany(combat.companyId, view);
    const destSite = company
      ? ('destinationSite' in company ? company.destinationSite : company.revealedDestinationSite)
      : null;
    if (destSite) {
      const siteDefId = cachedInstanceLookup(destSite.instanceId);
      const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
      if (siteDef) {
        const siteImgPath = cardImageProxyPath(siteDef);
        if (siteImgPath) {
          const siteImg = createCardImage(siteDefId as string, siteDef, siteImgPath, 'combat-card combat-card--attacker', destSite.instanceId as string);
          const eventDefId = cachedInstanceLookup(combat.attackSource.eventInstanceId);
          const eventDef = eventDefId ? cardPool[eventDefId as string] : undefined;
          if (eventDef) {
            const eventImgPath = cardImageProxyPath(eventDef);
            if (eventImgPath) {
              const wrapper = document.createElement('div');
              wrapper.className = 'agent-attack-wrapper';
              wrapper.appendChild(siteImg);
              const thumb = createCardImage(eventDefId as string, eventDef, eventImgPath, 'agent-attack-thumb', combat.attackSource.eventInstanceId as string);
              thumb.style.setProperty('--agent-thumb-index', '0');
              wrapper.appendChild(thumb);
              container.appendChild(wrapper);
            } else {
              container.appendChild(siteImg);
            }
          } else {
            container.appendChild(siteImg);
          }
        }
      }
    }
  }

  return container;
}

// ---- Defender row ----

/** Render the defender side: character columns with combat-specific click handlers. */
function renderDefenderRow(
  combat: CombatState,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  assignActions: AssignStrikeAction[],
  supportActions: SupportStrikeAction[],
  chooseOrderActions: ChooseStrikeOrderAction[],
  cancelByTapActions: CancelByTapAction[],
  cancelStrikeActions: CancelStrikeAction[],
  cancelAttackActions: CancelAttackAction[],
  modifyAttackActions: ModifyAttackAction[],
  tapItemForStrikeActions: TapItemForStrikeAction[],
  faceStrikeOnTapActions: FaceStrikeOnTapAction[],
  selectedCvCCAttacker: CardInstanceId | null,
  selectedCvCCDefender: CardInstanceId | null,
  onAction: (action: GameAction) => void,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'combat-defender';

  // Find the defending company and characters
  const company = findCompany(combat.companyId, view);
  if (!company) return container;

  const iAmDefender = view.self.id === combat.defendingPlayerId;
  const charMap = iAmDefender ? view.self.characters : view.opponent.characters;

  // Two-step selection: only show defender targets once an attacker character is selected.
  // Applies to both 'attacker' phase (attacker picks) and 'defender-any' phase (defender picks).
  const isCvCCAttackerPhase = !!combat.isCvCC
    && combat.phase === 'assign-strikes'
    && ((combat.assignmentPhase === 'attacker' && view.self.id === combat.attackingPlayerId)
      || (combat.assignmentPhase === 'defender-any' && view.self.id === combat.defendingPlayerId));

  // CvCC defender phase: this player is the defender and is choosing which of their untapped
  // chars to pair with an attacker. Uses selectedCvCCDefender for the two-step flow.
  const isCvCCDefenderPhase = !!combat.isCvCC
    && iAmDefender
    && combat.phase === 'assign-strikes'
    && combat.assignmentPhase === 'defender';

  let effectiveAssignActions: AssignStrikeAction[];
  if (isCvCCAttackerPhase) {
    // Show defender targets only once an attacker char is selected
    effectiveAssignActions = selectedCvCCAttacker !== null
      ? assignActions.filter(a => (a.attackingCharacterId as string) === (selectedCvCCAttacker as string))
      : [];
  } else if (isCvCCDefenderPhase) {
    // In CvCC defender phase: defenders in the row are first-click targets (golden/green).
    // Actual assign actions are fired from the attacker row (blue targets) after defender is selected.
    // We expose no assign actions here — the character column handles the click specially.
    effectiveAssignActions = [];
  } else {
    effectiveAssignActions = assignActions;
  }

  // Build a set of assignable character IDs for quick lookup (used for golden highlight)
  // In CvCC defender phase, golden comes from a separate set derived from assign actions
  const cvccDefenderPhaseEligibleIds = isCvCCDefenderPhase
    ? new Set(assignActions.map(a => a.characterId as string))
    : new Set<string>();
  const assignableIds = new Set(effectiveAssignActions.map(a => a.characterId as string));

  // Build a set of characters that can support the current strike
  const supportableIds = new Set(supportActions.map(a => a.supportingCharacterId as string));

  // Build a set of characters that can tap to cancel an attack
  const cancelByTapIds = new Set(cancelByTapActions.map(a => a.characterId as string));

  // Build a map of canceller ID → cancel-strike action (card abilities like Fatty Bolger)
  const cancelStrikeMap = new Map<string, CancelStrikeAction>();
  for (const a of cancelStrikeActions) {
    cancelStrikeMap.set(a.cancellerInstanceId as string, a);
  }

  // Build a map of character ID → cancel-attack actions for the selected card:
  // the scout to tap (Concealment) or the named target character (Flatter a
  // Foe, Escape). Clicking the highlighted character commits that action.
  const selectedCancelAttack = getSelectedCancelAttack();
  const cancelAttackScoutMap = selectedCancelAttack
    ? groupCancelAttackActionsByScout(cancelAttackActions, selectedCancelAttack)
    : new Map<string, CancelAttackAction[]>();

  // Build a map of in-play card ID → cancel-attack action for direct tap-to-cancel
  // abilities on characters, their items (e.g. Torque of Hues), and their allies
  // (e.g. Goldberry's "tap to cancel one Wilderness attack"). Distinguished from
  // hand-card cancel-attack actions by checking whether the cardInstanceId belongs
  // to an in-play card in this company.
  const companyInPlayIds = inPlayCancelAttackIds(company.characters, charMap);
  const cancelAttackInPlayMap = new Map<string, CancelAttackAction>();
  for (const a of cancelAttackActions) {
    if (!a.scoutInstanceId && companyInPlayIds.has(a.cardInstanceId as string)) {
      cancelAttackInPlayMap.set(a.cardInstanceId as string, a);
    }
  }

  // Build a map of character ID → choose-strike-order action (for choose-strike-order phase)
  const chooseOrderMap = new Map<string, ChooseStrikeOrderAction>();
  for (const a of chooseOrderActions) {
    const sa = combat.strikeAssignments[a.strikeIndex];
    if (sa) chooseOrderMap.set(sa.characterId as string, a);
  }

  // Build a map of item-instance ID → modify-attack action (e.g. Black Arrow).
  // Keyed by the item's instanceId so click handlers on the item image can
  // fire the action directly in the pre-assignment window.
  const modifyAttackMap = new Map<string, ModifyAttackAction>();
  for (const a of modifyAttackActions) {
    modifyAttackMap.set(a.cardInstanceId as string, a);
  }

  // Build a map of item-instance ID → tap-item-for-strike action (e.g. Shield of Iron-bound Ash).
  // Keyed by cardInstanceId so the item image click handler fires during resolve-strike.
  const tapItemForStrikeMap = new Map<string, TapItemForStrikeAction>();
  for (const a of tapItemForStrikeActions) {
    tapItemForStrikeMap.set(a.cardInstanceId as string, a);
  }

  // Build a map of character ID → strike assignment info
  const strikeMap = new Map<string, { index: number; assignment: CombatState['strikeAssignments'][number] }>();
  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    // A character can appear multiple times (excess strikes), track the first
    if (!strikeMap.has(sa.characterId as string)) {
      strikeMap.set(sa.characterId as string, { index: i, assignment: sa });
    }
  }

  for (const charId of company.characters) {
    const char = charMap[charId];
    if (!char) continue;

    const col = renderCombatCharacterColumn(char, cardPool, combat, strikeMap, assignableIds, supportableIds, cancelByTapIds, cancelStrikeMap, cancelAttackScoutMap, cancelAttackInPlayMap, chooseOrderMap, modifyAttackMap, tapItemForStrikeMap, faceStrikeOnTapActions, effectiveAssignActions, supportActions, cancelByTapActions, isCvCCAttackerPhase, isCvCCDefenderPhase, cvccDefenderPhaseEligibleIds, selectedCvCCDefender, onAction);
    container.appendChild(col);
  }

  return container;
}

/** Find a company by ID across both players' data. */
function findCompany(companyId: CombatState['companyId'], view: PlayerView): Company | OpponentCompanyView | undefined {
  return (
    view.self.companies.find(c => c.id === companyId) ??
    view.opponent.companies.find(c => c.id === companyId)
  );
}

// ---- Character column for combat ----

/** Render a single character column with combat-specific highlights and click handlers. */
function renderCombatCharacterColumn(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
  strikeMap: Map<string, { index: number; assignment: CombatState['strikeAssignments'][number] }>,
  assignableIds: Set<string>,
  supportableIds: Set<string>,
  cancelByTapIds: Set<string>,
  cancelStrikeMap: Map<string, CancelStrikeAction>,
  cancelAttackScoutMap: Map<string, CancelAttackAction[]>,
  cancelAttackInPlayMap: Map<string, CancelAttackAction>,
  chooseOrderMap: Map<string, ChooseStrikeOrderAction>,
  modifyAttackMap: Map<string, ModifyAttackAction>,
  tapItemForStrikeMap: Map<string, TapItemForStrikeAction>,
  faceStrikeOnTapActions: FaceStrikeOnTapAction[],
  assignActions: AssignStrikeAction[],
  supportActions: SupportStrikeAction[],
  cancelByTapActions: CancelByTapAction[],
  isCvCCAttackerPhase: boolean,
  isCvCCDefenderPhase: boolean,
  cvccDefenderPhaseEligibleIds: Set<string>,
  selectedCvCCDefender: CardInstanceId | null,
  onAction: (action: GameAction) => void,
): HTMLElement {
  const { col, parts } = buildCombatCharacterColumn(char, cardPool);
  if (!parts) return col;
  const { wrap, inner, img, charIdStr } = parts;

  // Combat-specific styling
  const strike = strikeMap.get(charIdStr);
  const isCurrentStrike = strike !== undefined && strike.index === combat.currentStrikeIndex && !strike.assignment.resolved && combat.phase === 'resolve-strike';
  const isAssignable = assignableIds.has(charIdStr);
  const isSupportable = supportableIds.has(charIdStr);
  const isCancelByTap = cancelByTapIds.has(charIdStr);
  const cancelAttackActionsForScout = cancelAttackScoutMap.get(charIdStr);

  const chooseOrderAction = chooseOrderMap.get(charIdStr);

  const cancelAttackInPlayAction = cancelAttackInPlayMap.get(charIdStr);

  if (cancelAttackActionsForScout) {
    // Cancel-attack scout targeting: click this scout to play the selected cancel-attack card.
    // A dual-mode card (e.g. The Tormented Earth) offers more than one action for this
    // scout — open a menu so the player picks a mode instead of one being applied silently.
    img.classList.add('combat-card--assignable');
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cancelAttackActionsForScout.length > 1) {
        showCancelAttackModeTooltip(img, cancelAttackActionsForScout, cardPool, onAction);
      } else {
        clearCancelAttackSelection();
        onAction(cancelAttackActionsForScout[0]);
      }
    });
  } else if (cancelAttackInPlayAction) {
    // In-play character cancel-attack: tap this character to cancel the attack directly
    img.classList.add('combat-card--assignable');
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      onAction(cancelAttackInPlayAction);
    });
  } else if (isCancelByTap) {
    // Cancel-by-tap phase: click to tap this character and cancel an attack
    img.classList.add('combat-card--assignable');
    img.style.cursor = 'pointer';
    const action = cancelByTapActions.find(a => a.characterId === char.instanceId);
    if (action) {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction(action);
      });
    }
  } else if (chooseOrderAction) {
    // Choose-strike-order phase: click to pick this strike next
    img.classList.add('combat-card--assignable');
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      onAction(chooseOrderAction);
    });
  } else if (isCvCCDefenderPhase && cvccDefenderPhaseEligibleIds.has(charIdStr) && !strike) {
    // CvCC defender phase: this char can be selected as the "first click" defender.
    const isThisDefSelected = selectedCvCCDefender !== null && (selectedCvCCDefender as string) === charIdStr;
    if (isThisDefSelected) {
      // Already selected — show green; clicking deselects
      img.classList.add('combat-card--cvcc-selected');
    } else if (selectedCvCCDefender === null) {
      // No defender selected yet — show golden (assignable) to invite first click
      img.classList.add('combat-card--assignable');
    }
    // (When another defender is selected, this char shows no special highlight)
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isThisDefSelected) {
        clearSelectedCvCCDefender();
      } else {
        setSelectedCvCCDefender(char.instanceId);
      }
      rerender();
    });
  } else if (isAssignable) {
    // In CvCC attacker phase, use blue (supportable) to signal "second target"
    if (isCvCCAttackerPhase) {
      img.classList.add('combat-card--supportable');
    } else {
      img.classList.add('combat-card--assignable');
    }
    img.style.cursor = 'pointer';
    const action = assignActions.find(a => a.characterId === char.instanceId);
    if (action) {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        clearSelectedCvCCAttacker();
        onAction(action);
      });
    }
  } else if ((isSupportable || cancelStrikeMap.has(charIdStr)) && combat.phase === 'resolve-strike') {
    img.classList.add('combat-card--supportable');
    img.style.cursor = 'pointer';
    const supportAction = supportActions.find(a => a.supportingCharacterId === char.instanceId);
    const cancelAction = cancelStrikeMap.get(charIdStr);
    // Cancel-strike always opens a confirmation menu so the player can see what
    // strike they're canceling. Support-only is invoked directly on click.
    if (cancelAction) {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        showCombatChoiceTooltip(img, supportAction, cancelAction, onAction);
      });
    } else if (supportAction) {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction(supportAction);
      });
    }
  }

  if (strike) {
    if (strike.assignment.resolved) {
      const result = strikeResultDisplay(strike.assignment.result);
      if (result === 'success') img.classList.add('combat-card--strike-success');
      else if (result === 'wounded') img.classList.add('combat-card--strike-wounded');
      else if (result === 'eliminated') img.classList.add('combat-card--strike-eliminated');
    } else if (isCurrentStrike) {
      img.classList.add('combat-card--current-strike');
    } else {
      img.classList.add('combat-card--strike-assigned');
    }
  }

  inner.appendChild(img);

  // Stats badge — prowess/body. One-off bonuses against the current strike
  // (e.g. a tapped Shield of Iron-bound Ash) live on the strike assignment,
  // not in effectiveStats — fold them in for the character facing it, so
  // raising the shield visibly changes the number.
  const strikeBonus = strike && !strike.assignment.resolved
    ? ((strike.assignment as { strikeProwessBonus?: number }).strikeProwessBonus ?? 0)
    : 0;
  const badge = document.createElement('div');
  badge.className = 'char-stats-badge';
  badge.textContent = `${char.effectiveStats.prowess + strikeBonus}/${char.effectiveStats.body}`;
  inner.appendChild(badge);

  // Excess strikes indicator
  if (strike && strike.assignment.excessStrikes > 0) {
    const excessBadge = document.createElement('div');
    excessBadge.className = 'combat-excess-badge';
    excessBadge.textContent = `\u2212${strike.assignment.excessStrikes}`;
    excessBadge.title = `${strike.assignment.excessStrikes} excess strike${strike.assignment.excessStrikes !== 1 ? 's' : ''} (-${strike.assignment.excessStrikes} prowess)`;
    inner.appendChild(excessBadge);
  }

  // Strike result overlay icon
  if (strike?.assignment.resolved && strike.assignment.result) {
    const displayResult = strikeResultDisplay(strike.assignment.result);
    const overlay = document.createElement('div');
    overlay.className = 'combat-result-overlay';
    if (displayResult === 'success') {
      overlay.textContent = '\u2714'; // checkmark
      overlay.classList.add('combat-result-overlay--success');
    } else if (displayResult === 'wounded') {
      overlay.textContent = '\u2620'; // skull and crossbones — wounded
      overlay.classList.add('combat-result-overlay--wounded');
    } else if (displayResult === 'eliminated') {
      overlay.textContent = '\u2716'; // heavy X — eliminated
      overlay.classList.add('combat-result-overlay--eliminated');
    }
    inner.appendChild(overlay);
  }

  wrap.appendChild(inner);
  col.appendChild(wrap);

  // Items, allies, and hazards shown below — hazards (e.g. permanent corruption
  // cards like Lure of the Senses) stay attached during combat and must remain
  // visible to avoid confusion about the character's state.
  const items = [...char.items, ...char.allies, ...char.hazards];
  const hazardIds = new Set(char.hazards.map(h => h.instanceId as string));
  if (items.length > 0) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    for (const item of items) {
      const itemEl = createCardImageFromDefId(item.definitionId, cardPool, 'company-card company-card--item', item.instanceId as string);
      if (!itemEl) continue;
      if (item.status === CardStatus.Tapped) itemEl.classList.add('company-card--tapped');
      else if (item.status === CardStatus.Inverted) itemEl.classList.add('company-card--wounded');

      // Hazards are display-only in combat — skip combat click handlers and strike styling.
      if (hazardIds.has(item.instanceId as string)) {
        attachments.appendChild(withItemCpBadge(itemEl, item.instanceId as string));
        continue;
      }

      // Allies participate in combat: assign-strike, choose-strike-order, support, and status styling
      const allyIdStr = item.instanceId as string;
      itemEl.dataset.combatCharId = allyIdStr;

      const allyStrike = strikeMap.get(allyIdStr);
      const allyChooseOrder = chooseOrderMap.get(allyIdStr);
      const modifyAction = modifyAttackMap.get(allyIdStr);
      const tapForStrikeAction = tapItemForStrikeMap.get(allyIdStr);
      const faceStrikeAction = resolveFaceStrikeOnTapAction(faceStrikeOnTapActions, allyIdStr);

      const allyCancelAttackInPlay = cancelAttackInPlayMap.get(allyIdStr);

      if (modifyAction) {
        // Item has a usable modify-attack ability (e.g. Black Arrow): click to tap
        // and apply the modifier to the current attack.
        itemEl.classList.add('combat-card--assignable');
        itemEl.style.cursor = 'pointer';
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          onAction(modifyAction);
        });
      } else if (tapForStrikeAction) {
        // Item can be tapped for a prowess bonus against the current strike
        // (e.g. Shield of Iron-bound Ash: +1 prowess).
        itemEl.classList.add('combat-card--assignable');
        itemEl.style.cursor = 'pointer';
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          onAction(tapForStrikeAction);
        });
      } else if (faceStrikeAction) {
        // Item can be tapped to let its bearer face a strike regardless of the
        // attack's normal capabilities and the bearer's status (Bow of Alatar).
        itemEl.classList.add('combat-card--assignable');
        itemEl.style.cursor = 'pointer';
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          onAction(faceStrikeAction);
        });
      } else if (allyCancelAttackInPlay) {
        // In-play ally cancel-attack: tap this ally to cancel the attack directly
        // (e.g. Goldberry's "tap to cancel one attack keyed to Wilderness").
        itemEl.classList.add('combat-card--assignable');
        itemEl.style.cursor = 'pointer';
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          onAction(allyCancelAttackInPlay);
        });
      } else if (assignableIds.has(allyIdStr) && combat.phase === 'assign-strikes') {
        itemEl.classList.add('combat-card--assignable');
        itemEl.style.cursor = 'pointer';
        const assignAction = assignActions.find(a => a.characterId === item.instanceId);
        if (assignAction) {
          itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(assignAction);
          });
        }
      } else if (allyChooseOrder) {
        itemEl.classList.add('combat-card--assignable');
        itemEl.style.cursor = 'pointer';
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation();
          onAction(allyChooseOrder);
        });
      } else if ((supportableIds.has(allyIdStr) || cancelStrikeMap.has(allyIdStr)) && combat.phase === 'resolve-strike') {
        itemEl.classList.add('combat-card--supportable');
        itemEl.style.cursor = 'pointer';
        const supportAction = supportActions.find(a => a.supportingCharacterId === item.instanceId);
        const cancelAction = cancelStrikeMap.get(allyIdStr);
        if (supportAction && cancelAction) {
          itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            showCombatChoiceTooltip(itemEl, supportAction, cancelAction, onAction);
          });
        } else if (cancelAction) {
          itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(cancelAction);
          });
        } else if (supportAction) {
          itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(supportAction);
          });
        }
      }

      if (allyStrike) {
        const isAllyCurrentStrike = allyStrike.index === combat.currentStrikeIndex && !allyStrike.assignment.resolved && combat.phase === 'resolve-strike';
        if (allyStrike.assignment.resolved) {
          const allyResult = strikeResultDisplay(allyStrike.assignment.result);
          if (allyResult === 'success') itemEl.classList.add('combat-card--strike-success');
          else if (allyResult === 'wounded') itemEl.classList.add('combat-card--strike-wounded');
          else if (allyResult === 'eliminated') itemEl.classList.add('combat-card--strike-eliminated');
        } else if (isAllyCurrentStrike) {
          itemEl.classList.add('combat-card--current-strike');
        } else {
          itemEl.classList.add('combat-card--strike-assigned');
        }
      }

      attachments.appendChild(withItemCpBadge(itemEl, allyIdStr));
    }
    col.appendChild(attachments);
  }

  return col;
}

/**
 * Build the shared scaffolding of a combat character column: the column
 * element, the card image, its wrapper, and the tap/wound styling that every
 * column applies before adding its own combat-specific decoration.
 *
 * Both combat column renderers — the defending side (full interaction: strike
 * assignment, support, cancel-by-tap, …) and the CvCC attacking side
 * (selection only) — opened with an identical block of this.
 *
 * @returns `parts` is null when the character's definition or proxy image is
 * unavailable, in which case the caller returns the bare `col` — the same
 * early-out both renderers did inline.
 */
function buildCombatCharacterColumn(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
): {
  col: HTMLElement;
  parts: {
    wrap: HTMLElement;
    inner: HTMLElement;
    img: HTMLImageElement;
    charIdStr: string;
  } | null;
} {
  const charIdStr = char.instanceId as string;

  const col = document.createElement('div');
  col.className = 'character-column';
  col.dataset.combatCharId = charIdStr;

  const img = createCardImageFromDefId(char.definitionId, cardPool, 'company-card', charIdStr);
  if (!img) return { col, parts: null };

  // Character card wrapper
  const wrap = document.createElement('div');
  wrap.className = 'character-card-wrap';

  const hasAttachments = char.items.length > 0 || char.allies.length > 0 || char.hazards.length > 0;

  const inner = document.createElement('div');
  inner.className = 'character-card-inner';
  if (char.status === CardStatus.Tapped) {
    inner.classList.add('character-card-inner--tapped');
    wrap.classList.add('character-card-wrap--tapped');
  } else if (char.status === CardStatus.Inverted) {
    inner.classList.add('character-card-inner--wounded');
    if (hasAttachments) img.classList.add('company-card--faded-top');
  } else {
    if (hasAttachments) img.classList.add('company-card--faded');
  }

  return { col, parts: { wrap, inner, img, charIdStr } };
}

/** Render a single attacker character column for CvCC. */
function renderCvCCAttackerCharacterColumn(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
  combat: CombatState,
  attackerStrikeMap: Map<string, { index: number; assignment: CombatState['strikeAssignments'][number] }>,
  selectableAttackerIds: Set<string>,
  selectedAttackerId: CardInstanceId | null,
  selectedCvCCDefender: CardInstanceId | null,
  isCvCCDefenderPhaseWithSelection: boolean,
  onAction: (action: GameAction) => void,
): HTMLElement {
  const { col, parts } = buildCombatCharacterColumn(char, cardPool);
  if (!parts) return col;
  const { wrap, inner, img, charIdStr } = parts;
  const strike = attackerStrikeMap.get(charIdStr);
  const isCurrentStrike = strike !== undefined && strike.index === combat.currentStrikeIndex && !strike.assignment.resolved && combat.phase === 'resolve-strike';

  const isSelected = selectedAttackerId !== null && (selectedAttackerId as string) === charIdStr;
  const isSelectable = selectableAttackerIds.has(charIdStr);

  // CvCC defender phase: when a defender is selected, unpaired attackers are blue "second targets"
  const isDefenderPhaseTarget = isCvCCDefenderPhaseWithSelection && isSelectable;

  if (strike) {
    if (strike.assignment.resolved && strike.assignment.attackerResult) {
      if (strike.assignment.attackerResult === 'success') img.classList.add('combat-card--strike-success');
      else if (strike.assignment.attackerResult === 'wounded') img.classList.add('combat-card--strike-wounded');
      else if (strike.assignment.attackerResult === 'eliminated') img.classList.add('combat-card--strike-eliminated');
    } else if (isCurrentStrike) {
      img.classList.add('combat-card--current-strike');
    } else if (strike.assignment.attackingCharacterId) {
      img.classList.add('combat-card--strike-assigned');
    }
  } else if (isDefenderPhaseTarget) {
    // Blue: second target in CvCC defender phase two-step flow
    img.classList.add('combat-card--supportable');
  } else if (isSelected) {
    img.classList.add('combat-card--cvcc-selected');
  } else if (isSelectable) {
    img.classList.add('combat-card--assignable');
  }

  if (isDefenderPhaseTarget) {
    // Click fires the assign action pairing selectedCvCCDefender ↔ this attacker
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedCvCCDefender !== null) {
        const assignAction: AssignStrikeAction = {
          type: 'assign-strike',
          player: combat.defendingPlayerId,
          characterId: selectedCvCCDefender,
          attackingCharacterId: char.instanceId,
        };
        clearSelectedCvCCDefender();
        onAction(assignAction);
      }
    });
  } else if (isSelectable || isSelected) {
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isSelected) {
        clearSelectedCvCCAttacker();
      } else {
        setSelectedCvCCAttacker(char.instanceId);
      }
      rerender();
    });
  }

  inner.appendChild(img);

  const badge = document.createElement('div');
  badge.className = 'char-stats-badge';
  badge.textContent = `${char.effectiveStats.prowess}/${char.effectiveStats.body}`;
  inner.appendChild(badge);

  if (strike?.assignment.resolved && strike.assignment.attackerResult) {
    const overlay = document.createElement('div');
    overlay.className = 'combat-result-overlay';
    if (strike.assignment.attackerResult === 'success') {
      overlay.textContent = '✔';
      overlay.classList.add('combat-result-overlay--success');
    } else if (strike.assignment.attackerResult === 'wounded') {
      overlay.textContent = '☠';
      overlay.classList.add('combat-result-overlay--wounded');
    } else {
      overlay.textContent = '✖';
      overlay.classList.add('combat-result-overlay--eliminated');
    }
    inner.appendChild(overlay);
  }

  wrap.appendChild(inner);
  col.appendChild(wrap);

  const items = [...char.items, ...char.allies, ...char.hazards];
  if (items.length > 0) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    for (const item of items) {
      const itemEl = createCardImageFromDefId(item.definitionId, cardPool, 'company-card company-card--item', item.instanceId as string);
      if (!itemEl) continue;
      if (item.status === CardStatus.Tapped) itemEl.classList.add('company-card--tapped');
      else if (item.status === CardStatus.Inverted) itemEl.classList.add('company-card--wounded');
      attachments.appendChild(withItemCpBadge(itemEl, item.instanceId as string));
    }
    col.appendChild(attachments);
  }

  return col;
}

// ---- SVG strike arrows ----

/**
 * Draw SVG arrows from the attacker card to each assigned defender character.
 * Uses getBoundingClientRect() on the DOM elements to compute arrow endpoints.
 */
function drawStrikeArrows(svg: SVGSVGElement, combat: CombatState, iAmDefender: boolean): void {
  const arena = svg.closest('.combat-arena');
  if (!arena) return;

  const arenaRect = arena.getBoundingClientRect();
  svg.setAttribute('width', String(arenaRect.width));
  svg.setAttribute('height', String(arenaRect.height));
  svg.style.width = arenaRect.width + 'px';
  svg.style.height = arenaRect.height + 'px';

  // For CvCC each strike has a specific attacking character; fall back to a
  // single attacker element for creature/agent/automatic attacks.
  const singleAttackerEl = combat.isCvCC
    ? null
    : (arena.querySelector('.combat-card--attacker') ?? arena.querySelector('.combat-attacker'));

  let singleAttackerX = 0;
  let singleAttackerY = 0;
  if (singleAttackerEl) {
    const r = singleAttackerEl.getBoundingClientRect();
    singleAttackerX = r.left + r.width / 2 - arenaRect.left;
    singleAttackerY = r.top + r.height / 2 - arenaRect.top;
  }

  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    const charEl = arena.querySelector(`[data-combat-char-id="${sa.characterId}"]`);
    if (!charEl) continue;

    // Find the card image: characters wrap it in a column div, but allies/items
    // render data-combat-char-id directly on the .company-card image itself.
    const cardEl = resolveCardElement(charEl);
    if (!cardEl) continue;

    // Skip assignments without a paired attacker (should not occur after the reservation
    // model was removed, but guard defensively to avoid broken arrows).
    if (combat.isCvCC && !sa.attackingCharacterId) {
      continue;
    }

    let attackerX: number;
    let attackerY: number;
    if (combat.isCvCC && sa.attackingCharacterId) {
      const atkEl = arena.querySelector(`[data-combat-char-id="${sa.attackingCharacterId}"]`);
      if (!atkEl) continue;
      const atkCardEl = resolveCardElement(atkEl);
      if (!atkCardEl) continue;
      const atkRect = atkCardEl.getBoundingClientRect();
      attackerX = atkRect.left + atkRect.width / 2 - arenaRect.left;
      // When I'm the defender, attackers are on top → use bottom of attacker card
      // When I'm the attacker, attackers are on bottom → use top of attacker card
      attackerY = iAmDefender
        ? atkRect.bottom - arenaRect.top
        : atkRect.top - arenaRect.top;
    } else {
      attackerX = singleAttackerX;
      attackerY = singleAttackerY;
    }

    const charRect = cardEl.getBoundingClientRect();
    const charX = charRect.left + charRect.width / 2 - arenaRect.left;
    const charY = iAmDefender
      ? charRect.top - arenaRect.top       // defender on bottom → arrow to top
      : charRect.bottom - arenaRect.top;    // defender on top → arrow to bottom

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(attackerX));
    line.setAttribute('y1', String(attackerY));
    line.setAttribute('x2', String(charX));
    line.setAttribute('y2', String(charY));
    line.classList.add('combat-arrow');

    // Style based on resolution status
    const isCurrent = i === combat.currentStrikeIndex && !sa.resolved && combat.phase === 'resolve-strike';
    if (sa.resolved) {
      line.classList.add('combat-arrow--resolved');
      if (sa.result === 'success') {
        line.setAttribute('marker-end', 'url(#combat-arrowhead-success)');
        line.classList.add('combat-arrow--success');
      } else {
        line.setAttribute('marker-end', 'url(#combat-arrowhead-wound)');
        line.classList.add('combat-arrow--wound');
      }
    } else if (isCurrent) {
      line.classList.add('combat-arrow--active');
      line.setAttribute('marker-end', 'url(#combat-arrowhead)');
    } else {
      line.setAttribute('marker-end', 'url(#combat-arrowhead)');
    }

    svg.appendChild(line);
  }
}

// ---- Combat action buttons (bottom-right, same area as pass button) ----

/** Combat action types that get rendered as buttons (not handled by card clicks). */
const BUTTON_ACTION_TYPES = new Set(['resolve-strike', 'body-check-roll', 'agent-strike-roll', 'allocate-cvcc-excess']);

/**
 * Render combat action buttons stacked above the pass button in the
 * bottom-right corner, reusing the existing enter-site-btn styling.
 *
 * Besides the viable actions, tutorial-gated button actions are rendered
 * too — disabled, with the gate's reason as tooltip — so the player sees
 * the normal choice (e.g. tap vs. stay untapped) even when the script
 * prescribes one side of it.
 */
function renderCombatActionButtons(
  viable: GameAction[],
  evaluated: readonly EvaluatedAction[],
  onAction: (action: GameAction) => void,
): void {
  // Remove any previously rendered combat action buttons
  for (const old of document.querySelectorAll('.combat-visual-btn')) old.remove();

  const buttonEvals = evaluated.filter(ea => BUTTON_ACTION_TYPES.has(ea.action.type)
    && (ea.viable === true
      || ('reason' in ea && typeof ea.reason === 'string' && ea.reason.startsWith('Tutorial'))));
  const passBtn = document.getElementById('pass-btn');
  const parent = passBtn?.parentElement;
  if (!parent) return;

  // The engine only offers the "stay untapped" (-3) resolve-strike option for an
  // untapped character (CoE 3.iv.3). When it is present, the character is
  // untapped and the tap-to-fight option genuinely taps it; when it is absent
  // the character is already tapped/wounded and cannot tap, so labels must
  // reflect that. Compute this once from the full action set.
  const hasStayUntappedOption = viable.some(
    a => a.type === 'resolve-strike' && !a.tapToFight,
  ) || buttonEvals.some(ea => ea.action.type === 'resolve-strike' && !ea.action.tapToFight);

  for (const ea of buttonEvals) {
    const btn = document.createElement('button');
    btn.className = 'enter-site-btn combat-visual-btn';
    btn.textContent = combatButtonLabel(ea.action, hasStayUntappedOption);
    if (ea.viable === true) {
      btn.addEventListener('click', () => onAction(ea.action));
    } else {
      btn.disabled = true;
      if ('reason' in ea && typeof ea.reason === 'string') btn.title = ea.reason;
    }
    parent.appendChild(btn);
  }
}

/**
 * Show a tooltip letting the player pick a mode for a dual-mode cancel-attack
 * card (e.g. The Tormented Earth: "Cancels the attack or gives the attack -3
 * prowess, your choice"). Without this, the scout-click handler would have to
 * pick one of the two actions on its own — silently denying the outright
 * cancel the card's text explicitly grants as a choice.
 */
function showCancelAttackModeTooltip(
  anchor: HTMLElement,
  actions: readonly CancelAttackAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const cardDefId = cachedInstanceLookup(actions[0].cardInstanceId);
  const cardDef = cardDefId ? cardPool[cardDefId as string] : undefined;
  const cancelEffect = (cardDef as { effects?: readonly CardEffect[] } | undefined)?.effects?.find(
    (e): e is Extract<CardEffect, { type: 'cancel-attack' }> => e.type === 'cancel-attack',
  );

  const items: TooltipMenuItem[] = actions.map(action => ({
    label: action.mode === 'reduce-prowess'
      ? `Reduce attack prowess by ${cancelEffect?.prowessPenalty ?? '?'}`
      : 'Cancel attack',
    onClick: () => {
      clearCancelAttackSelection();
      onAction(action);
    },
  }));

  showTooltipMenu(anchor, items);
}

// ---- Combat choice tooltip ----

/**
 * Show a tooltip letting the player choose between supporting a strike (+1 prowess)
 * and canceling it outright (e.g. Fatty Bolger's ability). When only one of the
 * two options is available, the tooltip still opens so the player can see and
 * confirm the action — making cancel-strike abilities discoverable even when
 * the canceller cannot also support (e.g. because they have a strike assigned).
 */
function showCombatChoiceTooltip(
  anchor: HTMLElement,
  supportAction: SupportStrikeAction | undefined,
  cancelAction: CancelStrikeAction,
  onAction: (action: GameAction) => void,
): void {
  const items: TooltipMenuItem[] = [];
  if (supportAction) {
    items.push({ label: 'Tap for +1 Support', onClick: () => onAction(supportAction) });
  }
  items.push({ label: 'Tap to Cancel Strike', onClick: () => onAction(cancelAction) });

  showTooltipMenu(anchor, items);
}

// ---- Item salvage panel ----

/**
 * Render the item-salvage panel between the combat rows. Shows each
 * salvageable item as a clickable card; clicking an item opens a tooltip
 * with a button per eligible recipient character (CoE rule 3.I.2).
 */
function renderSalvagePanel(
  combat: CombatState,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  salvageActions: readonly SalvageItemAction[],
  onAction: (action: GameAction) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'combat-salvage-panel';

  const label = document.createElement('div');
  label.className = 'combat-salvage-label';
  label.textContent = 'Salvage — click an item, then choose a recipient:';
  panel.appendChild(label);

  const itemsRow = document.createElement('div');
  itemsRow.className = 'combat-salvage-items';

  const items = combat.salvageItems ?? [];
  for (const item of items) {
    const def = cardPool[item.definitionId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const itemEl = createCardImage(
      item.definitionId as string,
      def,
      imgPath,
      'company-card company-card--item combat-card--assignable',
      item.instanceId as string,
    );
    itemEl.style.cursor = 'pointer';

    const recipientActions = salvageActions.filter(a => a.itemInstanceId === item.instanceId);
    itemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      showSalvageRecipientTooltip(itemEl, recipientActions, view, cardPool, onAction);
    });

    itemsRow.appendChild(itemEl);
  }

  panel.appendChild(itemsRow);
  return panel;
}

/**
 * Show a tooltip letting the defender pick which unwounded character
 * receives the selected salvaged item.
 */
function showSalvageRecipientTooltip(
  anchor: HTMLElement,
  recipientActions: readonly SalvageItemAction[],
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const items = recipientActions.map((action): TooltipMenuItem => {
    const char = view.self.characters[action.recipientCharacterId];
    const charDef = char ? cardPool[char.definitionId as string] : undefined;
    const name = charDef && 'name' in charDef ? (charDef as { name: string }).name : (action.recipientCharacterId as string);
    return { label: `Transfer to ${name}`, onClick: () => onAction(action) };
  });

  showTooltipMenu(anchor, items, { placement: 'under' });
}

// ---- Helpers ----

const RACE_LABELS: Record<string, string> = {
  dunadan: 'Dúnadan',
  'awakened-plant': 'Awakened Plant',
  'pukel-creature': 'Pûkel-creature',
};

/**
 * Format an attacker label for the situation banner.
 *
 * The banner names whatever identifies the attacker, which is not always a
 * race: a hazard creature contributes its canonical {@link Race}, a site
 * automatic-attack its printed `creatureType` label ("Orcs", "Gas"), and an
 * agent its card name. Only the canonical races get a lookup in
 * {@link RACE_LABELS}; anything else is simply capitalized. Hence `string`
 * rather than `Race` — this is display text, not a race identifier.
 */
function formatAttackerLabel(label: string): string {
  return RACE_LABELS[label] ?? label.charAt(0).toUpperCase() + label.slice(1);
}
