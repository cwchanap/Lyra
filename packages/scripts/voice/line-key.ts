/**
 * The expression every character config must define (enforced by the asset
 * config loader). The compiler fills it in for lines authored without an
 * expression tag, so it carries no delivery intent of its own.
 */
export const DEFAULT_EXPRESSION = "standard";

export type LineKeyInput = {
  speaker: string;
  text: string;
  expression?: string | null | undefined;
};

/**
 * Normalizes an emitted or stored expression for keying: the default
 * expression and a missing portrait both mean "no specific delivery".
 */
export function keyExpression(
  expression: string | null | undefined,
): string | null {
  if (expression === undefined || expression === null) return null;
  return expression === DEFAULT_EXPRESSION ? null : expression;
}

/**
 * Translation-memory key for one spoken line: speaker, exact emitted Chinese
 * text, and the non-default expression. The same key always maps to the same
 * translation (and later the same voice clip), wherever the line appears.
 */
export function localeLineKey(input: LineKeyInput): string {
  return JSON.stringify([
    input.speaker,
    keyExpression(input.expression),
    input.text,
  ]);
}
