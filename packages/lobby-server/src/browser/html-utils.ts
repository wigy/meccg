/**
 * @module html-utils
 *
 * Small HTML helpers shared by the lobby browser UI modules.
 */

/**
 * Escapes the HTML-significant characters `&`, `<`, `>`, and `"` so that
 * untrusted text can be safely interpolated into both element content and
 * double-quoted attribute values.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
