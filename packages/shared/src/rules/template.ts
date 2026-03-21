/**
 * @module rules/template
 *
 * Simple Mustache-style template renderer for rule failure messages.
 * Replaces `{{path.to.value}}` placeholders with values resolved from
 * a context object, using the same dot-path convention as the condition matcher.
 */

/**
 * Resolves a dot-separated path against a nested object.
 * Returns `undefined` if any segment is missing.
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

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
