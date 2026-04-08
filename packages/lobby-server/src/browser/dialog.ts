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
