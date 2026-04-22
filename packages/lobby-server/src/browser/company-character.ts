/**
 * @module company-character
 *
 * Renders a single character column: the character card image with status
 * transforms (tapped/wounded), stats/mind/DI badges, and a row of
 * attachments (items, allies, hazards, followers with their own items).
 */

import type {
  CardDefinition,
  CardInstanceId,
  CharacterInPlay,
} from '@meccg/shared';
import { cardImageProxyPath, isCharacterCard, isItemCard, CardStatus } from '@meccg/shared';
import { createCardImage } from './render-utils.js';

/**
 * Render a single character column: character card + items stacked below.
 * Applies tapped/wounded transforms based on character status.
 */
export function renderCharacterColumn(
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
  isTitleCharacter: boolean,
  charMap?: Readonly<Record<string, CharacterInPlay>>,
  influenceClick?: { cls: string; handler: (e: Event) => void },
  influenceClickBuilder?: (id: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
  itemClickBuilder?: (itemInstId: CardInstanceId, charInstId: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
  hazardClickBuilder?: (hazardInstId: CardInstanceId) => { cls: string; handler: (e: Event) => void } | undefined,
): HTMLElement {
  const col = document.createElement('div');
  col.className = 'character-column';
  col.dataset.instanceId = char.instanceId as string;

  const def = cardPool[char.definitionId as string];
  if (!def) return col;
  const imgPath = cardImageProxyPath(def);
  if (!imgPath) return col;

  // Character card wrapper (for positioning badge)
  const wrap = document.createElement('div');
  wrap.className = 'character-card-wrap';

  const hasFollowers = charMap != null && char.followers.length > 0;
  const hasAttachments = char.items.length > 0 || char.allies.length > 0 || char.hazards.length > 0 || hasFollowers;
  const img = createCardImage(char.definitionId as string, def, imgPath, 'company-card', char.instanceId as string);

  // Inner wrapper rotates both card image and badges together
  const inner = document.createElement('div');
  inner.className = 'character-card-inner';
  if (char.status === CardStatus.Tapped) {
    inner.classList.add('character-card-inner--tapped');
    wrap.classList.add('character-card-wrap--tapped');
    if (hasAttachments) wrap.classList.add('character-card-wrap--has-attachments');
  } else if (char.status === CardStatus.Inverted) {
    inner.classList.add('character-card-inner--wounded');
    if (hasAttachments) img.classList.add('company-card--faded-top');
  } else {
    if (hasAttachments) img.classList.add('company-card--faded');
  }
  inner.appendChild(img);

  // Stats badge
  const badge = document.createElement('div');
  badge.className = 'char-stats-badge';
  badge.textContent = `${char.effectiveStats.prowess}/${char.effectiveStats.body}`;
  inner.appendChild(badge);

  // Mind badge (left edge, above DI)
  if (isCharacterCard(def) && def.mind !== null) {
    const mindBadge = document.createElement('div');
    mindBadge.className = 'char-mind-badge';
    mindBadge.textContent = String(def.mind);
    inner.appendChild(mindBadge);
  }

  // Direct influence badge (left edge, middle) — only shown when DI > 0
  if (char.effectiveStats.directInfluence > 0) {
    const diBadge = document.createElement('div');
    diBadge.className = 'char-di-badge';
    diBadge.textContent = String(char.effectiveStats.directInfluence);
    inner.appendChild(diBadge);
  }

  wrap.appendChild(inner);

  // Influence move highlight and click handler
  if (influenceClick) {
    if (influenceClick.cls) img.classList.add(influenceClick.cls);
    img.style.cursor = 'pointer';
    img.addEventListener('click', influenceClick.handler);
  }

  col.appendChild(wrap);

  // Items, allies, and followers — shown side by side in one row
  const allAttachments = [...char.items, ...char.allies, ...char.hazards];
  if (allAttachments.length > 0 || hasFollowers) {
    const attachments = document.createElement('div');
    attachments.className = 'character-attachments';
    for (const att of allAttachments) {
      const attDef = cardPool[att.definitionId as string];
      if (!attDef) continue;
      const attImg = cardImageProxyPath(attDef);
      if (!attImg) continue;
      const attEl = createCardImage(att.definitionId as string, attDef, attImg, 'company-card company-card--item', att.instanceId as string);
      if (att.status === CardStatus.Tapped) {
        attEl.classList.add('company-card--tapped');
      }
      const isItem = char.items.some(i => i.instanceId === att.instanceId);
      const isHazard = char.hazards.some(h => h.instanceId === att.instanceId);
      // Granted-action click handler (items like Cram or hazards like corruption checks)
      const grantedClick = (isItem || isHazard) && hazardClickBuilder
        ? hazardClickBuilder(att.instanceId) : undefined;
      if (grantedClick) {
        if (grantedClick.cls) attEl.classList.add(grantedClick.cls);
        attEl.style.cursor = 'pointer';
        attEl.addEventListener('click', grantedClick.handler);
      } else if (isItem && itemClickBuilder) {
        // Item transfer click handler (only when no granted action takes priority)
        const itemClick = itemClickBuilder(att.instanceId, char.instanceId);
        if (itemClick) {
          if (itemClick.cls) attEl.classList.add(itemClick.cls);
          attEl.style.cursor = 'pointer';
          attEl.addEventListener('click', itemClick.handler);
        }
      }
      // Wrap item in a container for CP badge positioning
      if (isItemCard(attDef) && attDef.corruptionPoints > 0) {
        const itemWrap = document.createElement('div');
        itemWrap.className = 'item-card-wrap';
        itemWrap.appendChild(attEl);
        const cpBadge = document.createElement('div');
        cpBadge.className = 'item-cp-badge';
        cpBadge.textContent = `${attDef.corruptionPoints} CP`;
        itemWrap.appendChild(cpBadge);
        attachments.appendChild(itemWrap);
      } else {
        attachments.appendChild(attEl);
      }
    }
    // Followers rendered as overlapping cards like items, with their own items below
    if (hasFollowers) {
      for (const followerId of char.followers) {
        const follower = charMap[followerId as string];
        if (!follower) continue;
        const fDef = cardPool[follower.definitionId as string];
        if (!fDef) continue;
        const fImg = cardImageProxyPath(fDef);
        if (!fImg) continue;

        // Wrap follower + its items in a mini-column
        const followerCol = document.createElement('div');
        followerCol.className = 'follower-column';

        const followerHasItems = follower.items.length > 0 || follower.allies.length > 0 || follower.hazards.length > 0;
        const fWrap = document.createElement('div');
        fWrap.className = 'character-card-wrap';
        const fEl = createCardImage(follower.definitionId as string, fDef, fImg, 'company-card company-card--follower', follower.instanceId as string);

        const fInner = document.createElement('div');
        fInner.className = 'character-card-inner';
        if (follower.status === CardStatus.Tapped) {
          fInner.classList.add('character-card-inner--tapped');
          fWrap.classList.add('character-card-wrap--tapped');
        } else if (follower.status === CardStatus.Inverted) {
          fInner.classList.add('character-card-inner--wounded');
          if (followerHasItems) fEl.classList.add('company-card--faded-top');
        } else {
          if (followerHasItems) fEl.classList.add('company-card--faded');
        }
        const followerInfluenceClick = influenceClickBuilder?.(followerId);
        if (followerInfluenceClick) {
          if (followerInfluenceClick.cls) fEl.classList.add(followerInfluenceClick.cls);
          fEl.style.cursor = 'pointer';
          fEl.addEventListener('click', followerInfluenceClick.handler);
        }
        fInner.appendChild(fEl);

        // Follower stats badge
        const fStatsBadge = document.createElement('div');
        fStatsBadge.className = 'char-stats-badge';
        fStatsBadge.textContent = `${follower.effectiveStats.prowess}/${follower.effectiveStats.body}`;
        fInner.appendChild(fStatsBadge);

        // Follower mind badge
        if (isCharacterCard(fDef) && fDef.mind !== null) {
          const fMindBadge = document.createElement('div');
          fMindBadge.className = 'char-mind-badge';
          fMindBadge.textContent = String(fDef.mind);
          fInner.appendChild(fMindBadge);
        }

        // Follower direct influence badge — only shown when DI > 0
        if (follower.effectiveStats.directInfluence > 0) {
          const fDiBadge = document.createElement('div');
          fDiBadge.className = 'char-di-badge';
          fDiBadge.textContent = String(follower.effectiveStats.directInfluence);
          fInner.appendChild(fDiBadge);
        }

        fWrap.appendChild(fInner);

        followerCol.appendChild(fWrap);

        // Follower's own items, allies, and hazards
        const followerAttachments = [...follower.items, ...follower.allies, ...follower.hazards];
        if (followerAttachments.length > 0) {
          const fAttRow = document.createElement('div');
          fAttRow.className = 'character-attachments';
          for (const fAtt of followerAttachments) {
            const fAttDef = cardPool[fAtt.definitionId as string];
            if (!fAttDef) continue;
            const fAttImg = cardImageProxyPath(fAttDef);
            if (!fAttImg) continue;
            const fAttEl = createCardImage(fAtt.definitionId as string, fAttDef, fAttImg, 'company-card company-card--item', fAtt.instanceId as string);
            if (fAtt.status === CardStatus.Tapped) {
              fAttEl.classList.add('company-card--tapped');
            }
            const fIsItem = follower.items.some(i => i.instanceId === fAtt.instanceId);
            const fIsHazard = follower.hazards.some(h => h.instanceId === fAtt.instanceId);
            // Granted-action click handler for follower items and hazards
            const fGrantedClick = (fIsItem || fIsHazard) && hazardClickBuilder
              ? hazardClickBuilder(fAtt.instanceId) : undefined;
            if (fGrantedClick) {
              if (fGrantedClick.cls) fAttEl.classList.add(fGrantedClick.cls);
              fAttEl.style.cursor = 'pointer';
              fAttEl.addEventListener('click', fGrantedClick.handler);
            } else if (fIsItem && itemClickBuilder) {
              // Item transfer click handler (only when no granted action takes priority)
              const fItemClick = itemClickBuilder(fAtt.instanceId, follower.instanceId);
              if (fItemClick) {
                if (fItemClick.cls) fAttEl.classList.add(fItemClick.cls);
                fAttEl.style.cursor = 'pointer';
                fAttEl.addEventListener('click', fItemClick.handler);
              }
            }
            // Wrap item in a container for CP badge positioning
            if (isItemCard(fAttDef) && fAttDef.corruptionPoints > 0) {
              const fItemWrap = document.createElement('div');
              fItemWrap.className = 'item-card-wrap';
              fItemWrap.appendChild(fAttEl);
              const fCpBadge = document.createElement('div');
              fCpBadge.className = 'item-cp-badge';
              fCpBadge.textContent = `${fAttDef.corruptionPoints} CP`;
              fItemWrap.appendChild(fCpBadge);
              fAttRow.appendChild(fItemWrap);
            } else {
              fAttRow.appendChild(fAttEl);
            }
          }
          followerCol.appendChild(fAttRow);
        }

        attachments.appendChild(followerCol);
      }
    }
    col.appendChild(attachments);
  }

  return col;
}
