import { describe, expect, it } from 'vitest';
import {
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
    expect(isLastProcessorAttempt({ attemptsMade: 0, opts: {} })).toBe(true);
  });

  it('identifies the Meta public test template', () => {
    expect(isPublicTestTemplate('hello_world')).toBe(true);
    expect(isPublicTestTemplate(' Hello_World ')).toBe(true);
    expect(isPublicTestTemplate('boas_vindas')).toBe(false);
  });
});
