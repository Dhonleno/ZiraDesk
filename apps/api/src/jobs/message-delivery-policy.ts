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

export function isRetryableMetaError(httpStatus: number, errorCode: number | null): boolean {
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return true;
  return errorCode !== null && RETRYABLE_META_ERROR_CODES.has(errorCode);
}

export function isLastProcessorAttempt(job: {
  attemptsMade: number;
  opts: { attempts?: number };
}): boolean {
  const maxAttempts = job.opts.attempts && job.opts.attempts > 0 ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= maxAttempts;
}

export function isPublicTestTemplate(templateName: string | null | undefined): boolean {
  return templateName?.trim().toLowerCase() === 'hello_world';
}
