/**
 * Throws a structured error when an async test callback rejects.
 * Use inside `.then(..., (e) => reportAsyncTestFailure(name, e))` chains
 * so unhandled rejections surface as named failures instead of silent passes.
 */
export function reportAsyncTestFailure(
  testName: string,
  error: unknown,
): never {
  throw new Error(`${testName} failed`, { cause: error });
}

/**
 * Extract a CSS rule's declaration block from component source.
 *
 * Asserts on literal source text, so a Prettier reformat or whitespace
 * change can break assertions without any behavioral change. Prefer e2e
 * `toHaveCSS` assertions against real computed styles where coverage
 * allows; this helper exists because jsdom cannot compute styles reliably
 * enough for layout-critical checks.
 *
 * Unlike a naive `{([^}]*)}` regex, this balances brace depth so a rule
 * using native CSS nesting (e.g. `.foo { color: red; &:hover { ... } }`)
 * returns its full declaration block instead of truncating at the first
 * nested `}`. The entire selector is regex-escaped before constructing the
 * RegExp, so selectors containing metacharacters like `[data-state]` or
 * `:is(.a,.b)` are matched literally; the first match wins, matching the
 * previous per-file helpers. A selector that is a substring of another
 * selector followed by `{` would still false-match the same way the old
 * helpers did, so prefer the most specific selector available (e.g.
 * `.scene-surface` over `surface`).
 */
export function cssRule(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startMatch = new RegExp(`${escapedSelector}\\s*\\{`).exec(source);
  if (!startMatch || startMatch.index === undefined) return "";
  const openIndex = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = openIndex;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  if (depth !== 0) return "";
  return source.slice(openIndex, i - 1);
}
