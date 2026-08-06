/**
 * @module tooltip-menu
 *
 * Shared builder for the small dark "action tooltip" menus used throughout
 * the game UI (character actions, granted actions, combat choices, agent
 * actions, hand-card disambiguation). Centralizes the backdrop, button and
 * positioning scaffolding that was previously repeated at every call site.
 */

/** One selectable entry in a tooltip menu. */
export interface TooltipMenuItem {
  label: string;
  /** Invoked after the menu has been dismissed. */
  onClick: () => void;
}

/**
 * Where to place the tooltip relative to its anchor element:
 * - `over` — horizontally centered, at the anchor's top edge (default)
 * - `under` — horizontally centered, at the anchor's bottom edge
 * - `under-left` — left-aligned, just below the anchor
 * - `auto` — measured against the viewport: above the anchor when it fits,
 *   otherwise below, otherwise clamped to the bottom edge. Auto placement
 *   uses a click-outside listener instead of a backdrop so the first click
 *   elsewhere in the UI is not swallowed.
 */
export type TooltipPlacement = 'over' | 'under' | 'under-left' | 'auto';

/** Remove any open action tooltip and its backdrop from the DOM. */
export function dismissTooltip(): void {
  document.querySelector('.char-action-tooltip')?.remove();
  document.querySelector('.char-action-backdrop')?.remove();
}

/** Create a tooltip menu button; the click handler stops propagation. */
export function tooltipButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'char-action-tooltip__btn';
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/**
 * Show a tooltip menu near an anchor element. Replaces any tooltip that is
 * already open; shows nothing when `items` is empty. Each item click
 * dismisses the menu before running its handler.
 */
export function showTooltipMenu(
  anchor: HTMLElement,
  items: readonly TooltipMenuItem[],
  options?: {
    placement?: TooltipPlacement;
    /** Extra setup applied to the tooltip element (e.g. dataset attributes). */
    decorate?: (tooltip: HTMLElement) => void;
  },
): void {
  dismissTooltip();
  if (items.length === 0) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'char-action-tooltip';
  options?.decorate?.(tooltip);
  for (const item of items) {
    tooltip.appendChild(tooltipButton(item.label, () => {
      dismissTooltip();
      item.onClick();
    }));
  }

  const rect = anchor.getBoundingClientRect();
  tooltip.style.position = 'fixed';
  const placement = options?.placement ?? 'over';

  if (placement === 'auto') {
    // Append off-screen first so the tooltip can be measured.
    tooltip.style.left = '-9999px';
    tooltip.style.top = '-9999px';
    document.body.appendChild(tooltip);

    const tipRect = tooltip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top =
      tipRect.height + 4 <= rect.top
        ? rect.top - tipRect.height - 4
        : rect.bottom + 4 + tipRect.height <= vh
          ? rect.bottom + 4
          : Math.max(4, vh - tipRect.height - 4);
    const left = Math.max(4, Math.min(rect.left, vw - tipRect.width - 4));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    // Click-outside to dismiss (no backdrop, so the click still lands).
    const dismiss = (e: MouseEvent): void => {
      if (!tooltip.contains(e.target as Node)) {
        dismissTooltip();
        document.removeEventListener('click', dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
    return;
  }

  // Modal backdrop that blocks interaction and dismisses on click.
  const backdrop = document.createElement('div');
  backdrop.className = 'char-action-backdrop';
  backdrop.onclick = () => dismissTooltip();
  document.body.appendChild(backdrop);

  if (placement === 'under-left') {
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 4}px`;
  } else {
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${placement === 'under' ? rect.bottom : rect.top}px`;
  }
  document.body.appendChild(tooltip);

  // Clamp into the viewport: an anchor near a screen edge (e.g. a character
  // card packed against the right edge on a narrow tablet) would otherwise
  // push the menu partly or fully off-screen, leaving its buttons untappable.
  const tipRect = tooltip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  tooltip.style.left = `${Math.max(4, Math.min(tipRect.left, vw - tipRect.width - 4))}px`;
  tooltip.style.top = `${Math.max(4, Math.min(tipRect.top, vh - tipRect.height - 4))}px`;
}

/**
 * Show a tooltip menu anchored at the mouse position, used for hand-card
 * disambiguation (short-event targets, hazard keying). Uses the
 * chain-target classes; clicking the backdrop dismisses the menu.
 */
export function showCursorTooltipMenu(event: MouseEvent, items: readonly TooltipMenuItem[]): void {
  document.querySelector('.chain-target-backdrop')?.remove();
  if (items.length === 0) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'chain-target-backdrop';
  backdrop.addEventListener('click', () => backdrop.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'chain-target-tooltip';
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;

  for (const item of items) {
    tooltip.appendChild(tooltipButton(item.label, () => {
      backdrop.remove();
      item.onClick();
    }));
  }

  backdrop.appendChild(tooltip);
  document.body.appendChild(backdrop);
}
