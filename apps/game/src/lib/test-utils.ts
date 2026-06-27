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
