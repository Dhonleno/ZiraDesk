import { createHmac, timingSafeEqual } from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

type FastifyRequestWithRawBody = FastifyRequest & {
  rawBody?: Buffer;
};

export async function verifyMetaSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const signatureHeader = request.headers['x-hub-signature-256'];
  const signature = typeof signatureHeader === 'string' ? signatureHeader : undefined;

  if (!signature) {
    void reply.status(401).send({
      success: false,
      error: { code: 'MISSING_SIGNATURE', message: 'Missing x-hub-signature-256 header' },
    });
    return;
  }

  const appSecret = process.env['META_APP_SECRET'];
  if (!appSecret) {
    request.log.error('META_APP_SECRET not configured');
    void reply.status(500).send({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Webhook secret not configured' },
    });
    return;
  }

  const rawBody = (request as FastifyRequestWithRawBody).rawBody;
  if (!rawBody) {
    void reply.status(400).send({
      success: false,
      error: { code: 'MISSING_BODY', message: 'Raw body unavailable' },
    });
    return;
  }

  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (
    signatureBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    request.log.warn({ signature }, 'Invalid Meta webhook signature');
    void reply.status(401).send({
      success: false,
      error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' },
    });
  }
}
