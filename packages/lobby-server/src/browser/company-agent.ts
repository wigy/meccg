/**
 * @module company-agent
 *
 * Renders agent hazards as one-character "virtual company" blocks in the
 * all-companies overview. Each agent has a character card (face-down image
 * when unrevealed) and a site card (plus a fan of older face-down sites for
 * agents that have moved while face-down).
 *
 * Self agents (`AgentInPlay`) can have action handlers wired to a tooltip
 * menu. Opponent agents (`OpponentAgentView`) are display-only, showing only
 * the number of sites the agent has accumulated.
 *
 * See the agents implementation plan at `specs/2026-04-22-agents-plan.md`
 * §3.2–3.3 and CoE rules §4 for the full agent rules.
 */

import type {
  PlayerView,
  CardDefinition,
  GameAction,
  AgentInPlay,
  OpponentAgentView,
  RevealAgentAction,
  AgentMoveAction,
  CompanyId,
} from '@meccg/shared';
import { cardImageProxyPath, CardStatus, isCharacterCard, isSiteCard } from '@meccg/shared';
import { getCachedInstanceLookup } from './company-view-state.js';
import { showTooltipMenu, type TooltipMenuItem } from './tooltip-menu.js';

// ---- Tooltip for agent actions ----

/**
 * Show a tooltip near the clicked agent block with all available agent actions.
 * Actions include reveal, move, move-back, return-home, heal, untap,
 * turn-face-down, and key-creatures.
 */
function showAgentActionTooltip(
  anchor: HTMLElement,
  agentId: CompanyId,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
  revealActions: RevealAgentAction[],
  moveActions: AgentMoveAction[],
  otherActions: readonly GameAction[],
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();

  const items: TooltipMenuItem[] = [];
  const addBtn = (label: string, action: GameAction): void => {
    items.push({ label, onClick: () => onAction(action) });
  };

  // Reveal actions
  for (const a of revealActions) {
    if (a.homeSiteInstanceId) {
      const siteDefId = cachedInstanceLookup(a.homeSiteInstanceId);
      const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
      const siteName = siteDef?.name ?? 'home site';
      addBtn(`Reveal at ${siteName}`, a);
    } else {
      addBtn('Reveal Agent (no home site — will discard)', a);
    }
  }

  // Move actions — group as "Move" label with site name
  for (const a of moveActions) {
    const siteDefId = cachedInstanceLookup(a.destinationSiteInstanceId);
    const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
    const siteName = siteDef ? siteDef.name : a.destinationSiteInstanceId as string;
    addBtn(`Move to ${siteName}`, a);
  }

  // Other actions with human-readable labels
  for (const a of otherActions) {
    let label: string;
    if (a.type === 'agent-move-back') {
      label = 'Move Back';
    } else if (a.type === 'agent-return-home') {
      const rh = a as { type: 'agent-return-home'; homeSiteInstanceId?: { toString(): string } };
      if (rh.homeSiteInstanceId) {
        const siteDefId = cachedInstanceLookup(rh.homeSiteInstanceId as Parameters<typeof cachedInstanceLookup>[0]);
        const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
        label = `Return to ${siteDef?.name ?? 'home'}`;
      } else {
        label = 'Return Home';
      }
    } else if (a.type === 'agent-heal') {
      label = 'Heal Agent';
    } else if (a.type === 'agent-untap') {
      label = 'Untap Agent';
    } else if (a.type === 'agent-turn-face-down') {
      label = 'Turn Face-Down';
    } else if (a.type === 'agent-key-creatures') {
      label = 'Key Creatures to Site';
    } else if (a.type === 'agent-discard-return-to-origin') {
      label = 'Discard: Return Company to Origin';
    } else {
      label = a.type;
    }
    addBtn(label, a);
  }

  showTooltipMenu(anchor, items, {
    placement: 'auto',
    decorate: (tooltip) => { tooltip.dataset.agentTooltip = agentId as string; },
  });
}

// ---- Site stack fan ----

/**
 * Render the site area for an agent: all sites in the stack shown as a
 * staircase fan (left and down), with the current (last) site shown face-up
 * if the agent is revealed, or face-down otherwise. Prior sites are always
 * face-down. All cards carry data-card-id so the zoom panel can show the
 * real site on hover.
 */
function renderAgentSiteArea(
  agent: AgentInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const area = document.createElement('div');
  area.className = 'company-site-area agent-site-area';

  if (agent.siteStack.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'agent-site-placeholder';
    placeholder.textContent = 'Home';
    area.appendChild(placeholder);
    return area;
  }

  const cachedInstanceLookup = getCachedInstanceLookup();
  const n = agent.siteStack.length;
  const step = 1; // rem offset per card (left and down)
  // Site card dimensions follow --card-table-height * scale; width is ~0.7× height.
  const scaleExpr = 'var(--card-table-height) * var(--company-scale, 1)';
  const fan = document.createElement('div');
  fan.className = 'agent-site-stack';
  fan.style.width = `calc(${scaleExpr} * 0.7 + ${(n - 1) * step}rem)`;
  fan.style.height = `calc(${scaleExpr} + ${(n - 1) * step}rem)`;

  for (let i = 0; i < n; i++) {
    const entry = agent.siteStack[i];
    const isLast = i === n - 1;
    const defId = cachedInstanceLookup(entry.instanceId);
    const def = defId ? cardPool[defId as string] : undefined;

    const img = document.createElement('img');
    img.className = `company-card company-card--site agent-site-stack__card`;
    img.style.zIndex = String(i);
    // Current card (last) at lower-left; older cards peek upper-right.
    img.style.left = `${(n - 1 - i) * step}rem`;
    img.style.top = `${i * step}rem`;

    if (isLast && agent.revealed && def && isSiteCard(def)) {
      const imgPath = cardImageProxyPath(def);
      img.src = imgPath ?? '/images/site-back.jpg';
    } else {
      img.src = '/images/site-back.jpg';
    }
    img.alt = def?.name ?? 'Face-down site';
    if (defId) {
      img.dataset.cardId = defId as string;
      img.dataset.instanceId = entry.instanceId as string;
    }
    fan.appendChild(img);
  }

  area.appendChild(fan);
  return area;
}

// ---- Self agent block ----

/**
 * Render a full `AgentInPlay` block for the hazard player's own agent.
 * Includes the site stack fan, current site, and character card (face-down
 * when the agent is unrevealed). Wires agent actions to a tooltip.
 */
export function renderAgentBlock(
  agent: AgentInPlay,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
  options?: {
    /** Pre-collected reveal-agent actions for this agent. */
    revealActions?: RevealAgentAction[];
    /** Pre-collected agent-move actions for this agent. */
    moveActions?: AgentMoveAction[];
    /** Pre-collected other agent actions (heal/untap/face-down/key-creatures/etc.). */
    otherActions?: readonly GameAction[];
    /** Select-company action targeting this agent (M/H select step). */
    selectAction?: GameAction;
  },
): HTMLElement {
  const cachedInstanceLookup = getCachedInstanceLookup();

  const block = document.createElement('div');
  block.className = 'company-block';
  block.dataset.companyId = agent.id as string;

  // Dim the block if the agent has already acted or was played this turn
  const isInactive = agent.remainingActions <= 0 && !options?.selectAction;
  if (isInactive) block.classList.add('company-block--inactive');

  // Name label — always show character name (self agents are fully visible to us)
  const nameEl = document.createElement('div');
  nameEl.className = 'company-name company-name--self';
  const charDefId = cachedInstanceLookup(agent.character.instanceId);
  const charDef = charDefId ? cardPool[charDefId as string] : undefined;
  const charName = charDef && isCharacterCard(charDef) ? charDef.name : 'Agent';
  const currentSite = agent.siteStack[agent.siteStack.length - 1];
  if (currentSite) {
    const siteDefId = cachedInstanceLookup(currentSite.instanceId);
    const siteDef = siteDefId ? cardPool[siteDefId as string] : undefined;
    const sitePart = siteDef ? `at ${siteDef.name}` : `(${agent.siteStack.length} sites)`;
    nameEl.textContent = agent.revealed ? `${charName} ${sitePart}` : `${charName} (Face-down) ${sitePart}`;
  } else {
    nameEl.textContent = agent.revealed ? `${charName} at Home` : `${charName} (Face-down) at Home`;
  }
  block.appendChild(nameEl);

  // Cards row: site area + character column
  const row = document.createElement('div');
  row.className = 'company-row';

  // Site area (fan of prior sites + current site)
  row.appendChild(renderAgentSiteArea(agent, cardPool));

  // Character column
  const col = document.createElement('div');
  col.className = 'character-column';
  col.dataset.instanceId = agent.character.instanceId as string;

  const wrap = document.createElement('div');
  wrap.className = 'character-card-wrap';

  const inner = document.createElement('div');
  inner.className = 'character-card-inner';

  // Apply tapped/wounded transform
  if (agent.character.status === CardStatus.Tapped) {
    inner.classList.add('character-card-inner--tapped');
    wrap.classList.add('character-card-wrap--tapped');
  } else if (agent.character.status === CardStatus.Inverted) {
    inner.classList.add('character-card-inner--wounded');
  }

  const img = document.createElement('img');
  // Self agents: identity is always known regardless of revealed state
  const imgPath = charDef ? cardImageProxyPath(charDef) : null;
  img.src = agent.revealed ? (imgPath ?? '/images/card-back.jpg') : '/images/card-back.jpg';
  img.alt = charName;
  if (charDefId) img.dataset.cardId = charDefId as string;
  img.dataset.instanceId = agent.character.instanceId as string;
  img.className = 'company-card';
  // Hover tooltip: show character identity and current stats
  const { prowess, body, directInfluence } = agent.character.effectiveStats;
  const statusStr = agent.character.status === CardStatus.Tapped ? ' [Tapped]'
    : agent.character.status === CardStatus.Inverted ? ' [Wounded]' : '';
  const revealedStr = agent.revealed ? '' : ' (Face-down)';
  img.title = `${charName}${revealedStr}${statusStr}\nProwess: ${prowess}  Body: ${body}  DI: ${directInfluence}`;

  inner.appendChild(img);
  wrap.appendChild(inner);
  col.appendChild(wrap);
  row.appendChild(col);
  block.appendChild(row);

  // Wire up action handlers
  const revealActions = options?.revealActions ?? [];
  const moveActions = options?.moveActions ?? [];
  const otherActions = options?.otherActions ?? [];
  const hasActions = revealActions.length > 0 || moveActions.length > 0 || otherActions.length > 0;

  if (options?.selectAction) {
    // Select-company mode: whole block is a click target
    block.classList.add('company-block--target');
    block.onclick = (e) => {
      e.stopPropagation();
      onAction(options.selectAction!);
    };
  } else if (hasActions) {
    // Show agent action tooltip on click
    block.classList.add('company-block--clickable');
    block.onclick = (e) => {
      e.stopPropagation();
      showAgentActionTooltip(
        block, agent.id, cardPool, onAction,
        revealActions, moveActions, otherActions,
      );
    };
  }

  return block;
}

// ---- Opponent agent block ----

/**
 * Render an `OpponentAgentView` block (display-only) for the resource
 * player's view of the opponent's agent. Shows a card-back for unrevealed
 * agents or the character front for revealed ones. Displays the number of
 * accumulated sites as a badge when the agent has moved while face-down.
 */
export function renderOpponentAgentBlock(
  agent: OpponentAgentView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const cachedInstanceLookup = getCachedInstanceLookup();

  const block = document.createElement('div');
  block.className = 'company-block';
  block.dataset.companyId = agent.id as string;

  if (agent.actedThisTurn) block.classList.add('company-block--inactive');

  // Name label
  const nameEl = document.createElement('div');
  nameEl.className = 'company-name company-name--opponent';
  if (agent.revealed && agent.characterInstanceId) {
    const charDefId = cachedInstanceLookup(agent.characterInstanceId);
    const charDef = charDefId ? cardPool[charDefId as string] : undefined;
    const charName = charDef && isCharacterCard(charDef) ? charDef.name : 'Agent';
    nameEl.textContent = `${charName} (Revealed)`;
  } else {
    nameEl.textContent = agent.siteStackSize > 1
      ? `Face-down Agent (${agent.siteStackSize} sites)`
      : 'Face-down Agent';
  }
  block.appendChild(nameEl);

  // Cards row: character card only (sites are hidden from resource player)
  const row = document.createElement('div');
  row.className = 'company-row';

  // Site area placeholder — show count of hidden site cards
  const siteArea = document.createElement('div');
  siteArea.className = 'company-site-area agent-site-area';
  if (agent.siteStackSize > 0) {
    const nOpp = Math.min(agent.siteStackSize, 4);
    const stepOpp = 1;
    const scaleExprOpp = 'var(--card-table-height) * var(--company-scale, 1)';
    const stack = document.createElement('div');
    stack.className = 'agent-site-stack';
    stack.style.width = `calc(${scaleExprOpp} * 0.7 + ${(nOpp - 1) * stepOpp}rem)`;
    stack.style.height = `calc(${scaleExprOpp} + ${(nOpp - 1) * stepOpp}rem)`;
    for (let i = 0; i < nOpp; i++) {
      const back = document.createElement('img');
      back.src = '/images/site-back.jpg';
      back.alt = 'Hidden site';
      back.className = 'company-card company-card--site agent-site-stack__card';
      back.style.zIndex = String(i);
      back.style.left = `${(nOpp - 1 - i) * stepOpp}rem`;
      back.style.top = `${i * stepOpp}rem`;
      stack.appendChild(back);
    }
    siteArea.appendChild(stack);
  }
  row.appendChild(siteArea);

  // Character column: face-down or revealed
  const col = document.createElement('div');
  col.className = 'character-column';

  const wrap = document.createElement('div');
  wrap.className = 'character-card-wrap';

  const inner = document.createElement('div');
  inner.className = 'character-card-inner';

  const img = document.createElement('img');
  if (agent.revealed && agent.characterInstanceId) {
    const charDefId = cachedInstanceLookup(agent.characterInstanceId);
    const charDef = charDefId ? cardPool[charDefId as string] : undefined;
    const imgPath = charDef ? cardImageProxyPath(charDef) : null;
    img.src = imgPath ?? '/images/card-back.jpg';
    img.alt = charDef?.name ?? 'Agent';
    if (charDefId) img.dataset.cardId = charDefId as string;
    img.dataset.instanceId = agent.characterInstanceId as string;
  } else {
    img.src = '/images/card-back.jpg';
    img.alt = 'Face-down agent';
  }
  img.className = 'company-card';

  inner.appendChild(img);
  wrap.appendChild(inner);
  col.appendChild(wrap);
  row.appendChild(col);
  block.appendChild(row);

  return block;
}
