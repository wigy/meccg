/**
 * @module rules/template
 *
 * Simple Mustache-style template renderer for rule failure messages.
 * Replaces `{{path.to.value}}` placeholders with values resolved from
 * a context object, using the same dot-path convention as the condition matcher.
 */

import { resolvePath } from '../path-resolver.js';

/**
 * Renders a Mustache-style template by replacing `{{path}}` placeholders
 * with values from the context.
 *
 * Missing values are rendered as `"???"` to make template errors visible
 * rather than silently producing empty strings.
 *
 * @example
 * renderTemplate("{{card.name}} has mind {{card.mind}}", { card: { name: "Gimli", mind: 6 } })
 * // → "Gimli has mind 6"
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const value = resolvePath(context, path.trim());
    if (value === undefined || value === null) return '???';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '???';
  });
}
