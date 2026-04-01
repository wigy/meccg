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
} from '@meccg/shared';
import { cardImageProxyPath, viableActions, CardStatus, buildInstanceLookup } from '@meccg/shared';
import type { CardInstanceId, CardDefinitionId } from '@meccg/shared';
import { createCardImage } from './render-utils.js';

/** Cached instance-to-definition lookup, updated each time the view changes. */
let cachedInstanceLookup: ((id: CardInstanceId) => CardDefinitionId | undefined) = () => undefined;

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

  // Build attacker row and defender row
  const attackerRow = renderAttackerRow(combat, view, cardPool);
  const defenderRow = renderDefenderRow(combat, view, cardPool, assignActions, supportActions, chooseOrderActions, onAction);

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

  // Render combat action buttons in the bottom-right corner (same area as pass button)
  renderCombatActionButtons(viable, cardPool, onAction);

  // Draw arrows after DOM layout is computed (double-rAF to ensure layout is settled)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      drawStrikeArrows(svg, combat, iAmDefender);
    });
  });
}

// ---- Phase banner ----

/** Render the combat phase heading and status info. */
function renderPhaseBanner(
  combat: CombatState,
  iAmDefender: boolean,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'combat-phase-banner';

  // Resolve attacker race from card definition or auto-attack creature type
  let attackerRace = '';
  if (combat.attackSource.type === 'creature') {
    const defId = cachedInstanceLookup(combat.attackSource.instanceId);
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
  }
  const raceLabel = attackerRace ? formatRace(attackerRace) : '';
  const racePrefix = raceLabel ? `${raceLabel} \u2014 ` : '';

  let phaseText: string;
  if (combat.phase === 'assign-strikes') {
    const whose = combat.assignmentPhase === 'defender'
      ? (iAmDefender ? 'Your turn' : "Defender's turn")
      : (iAmDefender ? "Attacker's turn" : 'Your turn');
    const assigned = combat.strikeAssignments.length;
    const remaining = combat.strikesTotal - assigned;
    phaseText = `${racePrefix}Assign ${combat.strikesTotal} strike${combat.strikesTotal !== 1 ? 's' : ''} at ${combat.strikeProwess} prowess \u2014 ${whose} \u2022 ${assigned} assigned, ${remaining} remaining`;
  } else if (combat.phase === 'choose-strike-order') {
    const resolved = combat.strikeAssignments.filter(sa => sa.resolved).length;
    phaseText = `${racePrefix}Choose next strike to resolve (${resolved} of ${combat.strikesTotal} resolved)`;
  } else if (combat.phase === 'resolve-strike') {
    const resolved = combat.strikeAssignments.filter(sa => sa.resolved).length;
    phaseText = `${racePrefix}Resolve Strike ${resolved + 1} of ${combat.strikesTotal}`;
  } else {
    const target = combat.bodyCheckTarget === 'creature' ? 'Creature' : 'Character';
    phaseText = `Body Check \u2014 ${target}`;
  }

  banner.textContent = phaseText;
  return banner;
}

// ---- Attacker row ----

/** Render the attacker side: creature card + stats. */
function renderAttackerRow(
  combat: CombatState,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'combat-attacker';

  if (combat.attackSource.type === 'creature') {
    const defId = cachedInstanceLookup(combat.attackSource.instanceId);
    const def = defId ? cardPool[defId as string] : undefined;
    if (def) {
      const imgPath = cardImageProxyPath(def);
      if (imgPath) {
        const img = createCardImage(defId as string, def, imgPath, 'combat-card combat-card--attacker', combat.attackSource.instanceId as string);
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
  onAction: (action: GameAction) => void,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'combat-defender';

  // Find the defending company and characters
  const company = findCompany(combat.companyId, view);
  if (!company) return container;

  const iAmDefender = view.self.id === combat.defendingPlayerId;
  const charMap = iAmDefender ? view.self.characters : view.opponent.characters;

  // Build a set of assignable character IDs for quick lookup
  const assignableIds = new Set(assignActions.map(a => a.characterId as string));

  // Build a set of characters that can support the current strike
  const supportableIds = new Set(supportActions.map(a => a.supportingCharacterId as string));

  // Build a map of character ID → choose-strike-order action (for choose-strike-order phase)
  const chooseOrderMap = new Map<string, ChooseStrikeOrderAction>();
  for (const a of chooseOrderActions) {
    const sa = combat.strikeAssignments[a.strikeIndex];
    if (sa) chooseOrderMap.set(sa.characterId as string, a);
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
    const char = charMap[charId as string];
    if (!char) continue;

    const col = renderCombatCharacterColumn(char, cardPool, combat, strikeMap, assignableIds, supportableIds, chooseOrderMap, assignActions, supportActions, onAction);
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
  chooseOrderMap: Map<string, ChooseStrikeOrderAction>,
  assignActions: AssignStrikeAction[],
  supportActions: SupportStrikeAction[],
  onAction: (action: GameAction) => void,
): HTMLElement {
  const col = document.createElement('div');
  col.className = 'character-column';
  col.dataset.combatCharId = char.instanceId as string;

  const def = cardPool[char.definitionId as string];
  if (!def) return col;
  const imgPath = cardImageProxyPath(def);
  if (!imgPath) return col;

  // Character card wrapper
  const wrap = document.createElement('div');
  wrap.className = 'character-card-wrap';

  const hasAttachments = char.items.length > 0 || char.allies.length > 0;
  const img = createCardImage(char.definitionId as string, def, imgPath, 'company-card', char.instanceId as string);

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

  // Combat-specific styling
  const charIdStr = char.instanceId as string;
  const strike = strikeMap.get(charIdStr);
  const isCurrentStrike = strike !== undefined && strike.index === combat.currentStrikeIndex && !strike.assignment.resolved && combat.phase === 'resolve-strike';
  const isAssignable = assignableIds.has(charIdStr);
  const isSupportable = supportableIds.has(charIdStr);

  const chooseOrderAction = chooseOrderMap.get(charIdStr);

  if (chooseOrderAction) {
    // Choose-strike-order phase: click to pick this strike next
    img.classList.add('combat-card--assignable');
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      onAction(chooseOrderAction);
    });
  } else if (isAssignable) {
    img.classList.add('combat-card--assignable');
    img.style.cursor = 'pointer';
    const action = assignActions.find(a => a.characterId === char.instanceId);
    if (action) {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction(action);
      });
    }
  } else if (isSupportable && combat.phase === 'resolve-strike') {
    img.classList.add('combat-card--supportable');
    img.style.cursor = 'pointer';
    const action = supportActions.find(a => a.supportingCharacterId === char.instanceId);
    if (action) {
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        onAction(action);
      });
    }
  }

  if (strike) {
    if (strike.assignment.resolved) {
      const result = strike.assignment.result;
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

  // Stats badge — prowess/body
  const badge = document.createElement('div');
  badge.className = 'char-stats-badge';
  badge.textContent = `${char.effectiveStats.prowess}/${char.effectiveStats.body}`;
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
    const overlay = document.createElement('div');
    overlay.className = 'combat-result-overlay';
    if (strike.assignment.result === 'success') {
      overlay.textContent = '\u2714'; // checkmark
      overlay.classList.add('combat-result-overlay--success');
    } else if (strike.assignment.result === 'wounded') {
      overlay.textContent = '\u2620'; // skull and crossbones — wounded
      overlay.classList.add('combat-result-overlay--wounded');
    } else {
      overlay.textContent = '\u2716'; // heavy X — eliminated
      overlay.classList.add('combat-result-overlay--eliminated');
    }
    inner.appendChild(overlay);
  }

  wrap.appendChild(inner);
  col.appendChild(wrap);

  // Items and allies shown below
  const items = [...char.items, ...char.allies];
  if (items.length > 0) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    for (const item of items) {
      const itemDef = cardPool[item.definitionId as string];
      if (!itemDef) continue;
      const itemImg = cardImageProxyPath(itemDef);
      if (!itemImg) continue;
      const itemEl = createCardImage(item.definitionId as string, itemDef, itemImg, 'company-card company-card--item', item.instanceId as string);
      if (item.status === CardStatus.Tapped) itemEl.classList.add('company-card--tapped');

      // Ally support: highlight and click handler
      const allyIdStr = item.instanceId as string;
      if (supportableIds.has(allyIdStr) && combat.phase === 'resolve-strike') {
        itemEl.classList.add('combat-card--supportable');
        itemEl.style.cursor = 'pointer';
        const supportAction = supportActions.find(a => a.supportingCharacterId === item.instanceId);
        if (supportAction) {
          itemEl.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(supportAction);
          });
        }
      }

      attachments.appendChild(itemEl);
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

  // Find the attacker card element; fall back to the attacker container
  const attackerEl = arena.querySelector('.combat-card--attacker') ?? arena.querySelector('.combat-attacker');
  if (!attackerEl) return;

  const attackerRect = attackerEl.getBoundingClientRect();
  // Arrow starts from the center of the attacker card/container
  const attackerX = attackerRect.left + attackerRect.width / 2 - arenaRect.left;
  const attackerY = attackerRect.top + attackerRect.height / 2 - arenaRect.top;

  for (let i = 0; i < combat.strikeAssignments.length; i++) {
    const sa = combat.strikeAssignments[i];
    const charEl = arena.querySelector(`[data-combat-char-id="${sa.characterId}"]`);
    if (!charEl) continue;

    // Find the card image inside the character column
    const cardEl = charEl.querySelector('.company-card');
    if (!cardEl) continue;

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
const BUTTON_ACTION_TYPES = new Set(['resolve-strike', 'body-check-roll']);

/**
 * Render combat action buttons stacked above the pass button in the
 * bottom-right corner, reusing the existing enter-site-btn styling.
 */
function renderCombatActionButtons(
  viable: GameAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  // Remove any previously rendered combat action buttons
  for (const old of document.querySelectorAll('.combat-visual-btn')) old.remove();

  const buttonActions = viable.filter(a => BUTTON_ACTION_TYPES.has(a.type));
  const passBtn = document.getElementById('pass-btn');
  const parent = passBtn?.parentElement;
  if (!parent) return;

  // Stack buttons above the pass button, each offset upward
  for (let i = 0; i < buttonActions.length; i++) {
    const action = buttonActions[i];
    const btn = document.createElement('button');
    btn.className = 'enter-site-btn combat-visual-btn';
    btn.style.bottom = `${5.4 + i * 3.4}rem`;
    btn.textContent = combatButtonLabel(action);
    btn.addEventListener('click', () => onAction(action));
    parent.appendChild(btn);
  }
}

/** Short label for combat action buttons in the visual view. */
function combatButtonLabel(action: GameAction): string {
  if (action.type === 'resolve-strike') {
    return action.tapToFight ? 'Tapped' : 'Untapped';
  }
  if (action.type === 'body-check-roll') return 'Body Check';
  if (action.type === 'pass') return 'Pass';
  return action.type;
}

// ---- Helpers ----

const RACE_LABELS: Record<string, string> = {
  dunadan: 'Dúnadan',
  'awakened-plant': 'Awakened Plant',
  'pukel-creature': 'Pûkel-creature',
};

/** Format a race enum value into a display name. */
function formatRace(race: string): string {
  return RACE_LABELS[race] ?? race.charAt(0).toUpperCase() + race.slice(1);
}
