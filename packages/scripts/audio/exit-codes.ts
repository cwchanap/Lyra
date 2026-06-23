/**
 * Exit codes for the audio CLI tools.
 *
 * Each code is a distinct integer so CI pipelines and shell scripts can branch
 * on the failure category without parsing stderr:
 *
 * - {@link SUCCESS_EXIT_CODE} — command completed without error
 * - {@link FAILURE_EXIT_CODE} — generic runtime failure (generation error,
 *   plan write-back failure, orphaned output)
 * - {@link DIAGNOSTIC_EXIT_CODE} — usage error, or plan/catalog validation
 *   produced diagnostics that the user must fix before proceeding
 * - {@link PAYMENT_REQUIRED_EXIT_CODE} — ElevenLabs signalled a billing/credit
 *   problem; the user must top up credit or enable API billing before retrying
 */
export const SUCCESS_EXIT_CODE = 0 as const;

export const FAILURE_EXIT_CODE = 1 as const;

export const DIAGNOSTIC_EXIT_CODE = 2 as const;

export const PAYMENT_REQUIRED_EXIT_CODE = 3 as const;
