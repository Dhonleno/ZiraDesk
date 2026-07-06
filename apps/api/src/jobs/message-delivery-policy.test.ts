import { describe, expect, it } from 'vitest';
import {
  buildFinalMetaFailureReason,
  CAMPAIGN_MESSAGE_ATTEMPTS,
  getProcessorAttemptLimit,
  isLastProcessorAttempt,
  isPublicTestTemplate,
  isRetryableMetaError,
} from './message-delivery-policy.js';

describe('message delivery policy', () => {
  it('retries only transient Meta failures', () => {
    expect(isRetryableMetaError(429, 131058)).toBe(true);
    expect(isRetryableMetaError(503, null)).toBe(true);
    expect(isRetryableMetaError(400, 131016)).toBe(true);
    expect(isRetryableMetaError(400, 131058)).toBe(false);
    expect(isRetryableMetaError(400, 132001)).toBe(false);
  });

  it('detects the last processor attempt', () => {
    expect(isLastProcessorAttempt({ attemptsMade: 0, opts: { attempts: 3 } })).toBe(false);
    expect(isLastProcessorAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(true);
    expect(isLastProcessorAttempt({
      attemptsMade: CAMPAIGN_MESSAGE_ATTEMPTS - 2,
      opts: { attempts: CAMPAIGN_MESSAGE_ATTEMPTS },
    })).toBe(false);
    expect(isLastProcessorAttempt({
      attemptsMade: CAMPAIGN_MESSAGE_ATTEMPTS - 1,
      opts: { attempts: CAMPAIGN_MESSAGE_ATTEMPTS },
    })).toBe(true);
    expect(isLastProcessorAttempt({ attemptsMade: 0, opts: {} })).toBe(true);
    expect(getProcessorAttemptLimit({ attemptsMade: 0, opts: {} })).toBe(1);
  });

  it('describes an exhausted transient Meta failure without hiding its code', () => {
    expect(buildFinalMetaFailureReason({
      fallback: 'An unexpected error has occurred.',
      retryable: true,
      errorCode: 2,
      attempts: CAMPAIGN_MESSAGE_ATTEMPTS,
    })).toBe(
      'A Meta permaneceu temporariamente indisponível após 5 tentativas (código 2). Tente novamente mais tarde.',
    );
    expect(buildFinalMetaFailureReason({
      fallback: 'Invalid parameter',
      retryable: false,
      errorCode: 100,
      attempts: 1,
    })).toBe('Invalid parameter');
  });

  it('identifies the Meta public test template', () => {
    expect(isPublicTestTemplate('hello_world')).toBe(true);
    expect(isPublicTestTemplate(' Hello_World ')).toBe(true);
    expect(isPublicTestTemplate('boas_vindas')).toBe(false);
  });
});
