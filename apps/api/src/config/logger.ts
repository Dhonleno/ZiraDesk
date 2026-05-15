import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: [
      'accessToken',
      'token',
      'password',
      'credentials',
      'phoneNumber',
      'phone',
      '*.accessToken',
      '*.credentials',
      '*.password',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});
