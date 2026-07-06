const RETRYABLE_META_ERROR_CODES = new Set([
  1,
  2,
  4,
  17,
  341,
  80007,
  130429,
  131000,
  131016,
]);

export const CAMPAIGN_MESSAGE_ATTEMPTS = 5;
export const CAMPAIGN_MESSAGE_BACKOFF_DELAY_MS = 10_000;

export function isRetryableMetaError(httpStatus: number, errorCode: number | null): boolean {
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return true;
  return errorCode !== null && RETRYABLE_META_ERROR_CODES.has(errorCode);
}

export function getProcessorAttemptLimit(job: {
  attemptsMade: number;
  opts: { attempts?: number };
}): number {
  return job.opts.attempts && job.opts.attempts > 0 ? job.opts.attempts : 1;
}

export function isLastProcessorAttempt(job: {
  attemptsMade: number;
  opts: { attempts?: number };
}): boolean {
  return job.attemptsMade + 1 >= getProcessorAttemptLimit(job);
}

export function buildFinalMetaFailureReason(input: {
  fallback: string;
  retryable: boolean;
  errorCode: number | null;
  attempts: number;
}): string {
  if (!input.retryable) return input.fallback;

  const codeSuffix = input.errorCode === null ? '' : ` (código ${input.errorCode})`;
  return `A Meta permaneceu temporariamente indisponível após ${input.attempts} tentativas${codeSuffix}. Tente novamente mais tarde.`;
}

export function isPublicTestTemplate(templateName: string | null | undefined): boolean {
  return templateName?.trim().toLowerCase() === 'hello_world';
}
