/**
 * @module dialog
 *
 * Lightweight in-app modal dialog used in place of the browser's native
 * `alert()` / `confirm()`. The native dialogs are unstyled, blocking, and
 * jarring against the rest of the UI; these match the look of the existing
 * bug-report and feature-request modals.
 */

/**
 * Show a modal alert with an OK button. Returns a promise that resolves
 * when the user dismisses the dialog (OK button, Enter, or Escape).
 */
export function showAlert(message: string): Promise<void> {
  return new Promise<void>((resolve) => {
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

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    actions.appendChild(okBtn);
    dialog.appendChild(actions);

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      modal.remove();
      resolve();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };

    okBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);

    okBtn.focus();
  });
}

/** Optional button label overrides for {@link showConfirm}. */
export interface ConfirmOptions {
  readonly okLabel?: string;
  readonly cancelLabel?: string;
}

/**
 * Show a modal confirmation dialog with OK and Cancel buttons. Resolves
 * to `true` if the user confirms, `false` if they cancel (Cancel button,
 * backdrop click, or Escape). Enter confirms.
 */
export function showConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
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

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'app-dialog-btn-cancel';
    cancelBtn.textContent = options.cancelLabel ?? 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.textContent = options.okLabel ?? 'OK';
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    const finish = (result: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      modal.remove();
      resolve(result);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };

    okBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    backdrop.addEventListener('click', () => finish(false));
    document.addEventListener('keydown', onKey, true);

    okBtn.focus();
  });
}
