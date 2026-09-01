/**
 * @module dialog
 *
 * Lightweight in-app modal dialog used in place of the browser's native
 * `alert()` / `confirm()`. The native dialogs are unstyled, blocking, and
 * jarring against the rest of the UI; these match the look of the existing
 * bug-report and feature-request modals.
 */

/** One dialog action button; `value` is what the dialog resolves to. */
interface DialogButton<T> {
  readonly label: string;
  readonly value: T;
  readonly className?: string;
}

/**
 * Build and show a modal dialog with a message and action buttons.
 * Resolves with the clicked button's value; Enter and Escape resolve with
 * `keys.enter` / `keys.escape` (backdrop click counts as Escape). The
 * button matching `keys.enter` receives initial focus.
 */
function showDialog<T>(
  message: string,
  buttons: ReadonlyArray<DialogButton<T>>,
  keys: { enter: T; escape: T },
): Promise<T> {
  return new Promise<T>((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'app-dialog';

    const backdrop = document.createElement('div');
    backdrop.className = 'app-dialog-backdrop';
    modal.appendChild(backdrop);

    const dialog = document.createElement('div');
    dialog.className = 'app-dialog-box';

    const msg = document.createElement('p');
    msg.className = 'app-dialog-message';
    msg.textContent = message;
    dialog.appendChild(msg);

    const finish = (result: T) => {
      document.removeEventListener('keydown', onKey, true);
      modal.remove();
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(e.key === 'Enter' ? keys.enter : keys.escape);
      }
    };

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    let focusBtn: HTMLButtonElement | undefined;
    for (const button of buttons) {
      const btn = document.createElement('button');
      if (button.className) btn.className = button.className;
      btn.textContent = button.label;
      btn.addEventListener('click', () => finish(button.value));
      actions.appendChild(btn);
      if (button.value === keys.enter) focusBtn = btn;
    }
    dialog.appendChild(actions);

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    backdrop.addEventListener('click', () => finish(keys.escape));
    document.addEventListener('keydown', onKey, true);

    focusBtn?.focus();
  });
}

/**
 * Show a modal alert with an OK button. Returns a promise that resolves
 * when the user dismisses the dialog (OK button, Enter, or Escape).
 */
export function showAlert(message: string): Promise<void> {
  return showDialog<void>(
    message,
    [{ label: 'OK', value: undefined }],
    { enter: undefined, escape: undefined },
  );
}

/** Optional button label overrides for {@link showConfirm}. */
export interface ConfirmOptions {
  readonly okLabel?: string;
  readonly cancelLabel?: string;
  /**
   * For actions that are hard or impossible to undo (e.g. conceding a
   * game): Cancel gets initial focus instead of OK, and Enter cancels
   * instead of confirming. Without this, a stray Enter keypress — the same
   * key players habitually use to advance through the game — silently
   * confirms the destructive action instead of dismissing the dialog. See
   * bug report 974d2bb0d9d0fa9a: a concede fired 98ms after the player's
   * last unrelated action, far too fast to be a deliberate click-through of
   * this dialog. Escape always cancels either way.
   */
  readonly destructive?: boolean;
}

/**
 * Show a modal confirmation dialog with OK and Cancel buttons. Resolves
 * to `true` if the user confirms, `false` if they cancel (Cancel button,
 * backdrop click, or Escape). Enter confirms, unless `options.destructive`
 * is set, in which case Enter cancels (see {@link ConfirmOptions.destructive}).
 */
export function showConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const enterValue = !options.destructive;
  return showDialog(
    message,
    [
      { label: options.cancelLabel ?? 'Cancel', value: false, className: 'app-dialog-btn-cancel' },
      { label: options.okLabel ?? 'OK', value: true },
    ],
    { enter: enterValue, escape: false },
  );
}
