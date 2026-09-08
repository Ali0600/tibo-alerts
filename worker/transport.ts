import webpush from 'web-push';
import nodemailer from 'nodemailer';
import type { Delivery } from '../core/types';
import { validatePush, normalizeEmail } from '../core/security';
export type SendResult = {
  outcome: 'sent' | 'retry' | 'unknown' | 'invalid' | 'permanent' | 'expired';
  providerId?: string;
};
export async function sendDelivery(
  delivery: Delivery,
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<SendResult> {
  if (delivery.expiresAt <= now) return { outcome: 'expired' };
  if (delivery.channel === 'push') {
    try {
      const subscription = validatePush(delivery.destination.push);
      const details = webpush.generateRequestDetails(
        subscription,
        JSON.stringify({
          id: delivery.id,
          title: delivery.subject,
          body:
            delivery.text.split('\n\n')[1]?.slice(0, 200) || delivery.subject,
          url: delivery.url,
          tag: delivery.tag,
          expiresAt: delivery.expiresAt,
        }),
        {
          vapidDetails: {
            subject: env.VAPID_SUBJECT!,
            publicKey: env.VAPID_PUBLIC_KEY!,
            privateKey: env.VAPID_PRIVATE_KEY!,
          },
          contentEncoding: 'aes128gcm',
          TTL: Math.max(1, Math.floor((delivery.expiresAt - now) / 1000)),
          urgency: 'high',
        },
      );
      const response = await fetcher(details.endpoint, {
        method: 'POST',
        headers: details.headers,
        body: new Uint8Array(details.body).buffer,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      await response.body?.cancel();
      if (response.status === 404 || response.status === 410)
        return { outcome: 'invalid' };
      if (response.status === 429) return { outcome: 'retry' };
      if (response.status >= 200 && response.status < 300)
        return { outcome: 'sent' };
      return { outcome: response.status >= 500 ? 'unknown' : 'permanent' };
    } catch (error) {
      return {
        outcome:
          error instanceof Error &&
          (error.name === 'AbortError' ||
            error.name === 'TimeoutError' ||
            error instanceof TypeError)
            ? 'unknown'
            : 'permanent',
      };
    }
  }
  const email = normalizeEmail(delivery.destination.email);
  if (env.EMAIL_PROVIDER === 'smtp') {
    if (
      !env.SMTP_HOST ||
      !env.SMTP_USER ||
      !env.SMTP_PASSWORD ||
      !env.EMAIL_FROM
    )
      return { outcome: 'permanent' };
    const port = Number(env.SMTP_PORT || 587);
    if (![465, 587].includes(port)) return { outcome: 'permanent' };
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
    try {
      const result = await transport.sendMail({
        from: { name: 'Tibo Alerts', address: normalizeEmail(env.EMAIL_FROM) },
        to: email,
        subject: delivery.subject,
        text: delivery.text,
        messageId: `<${delivery.attemptId}@${new URL(delivery.url).hostname}>`,
        ...(delivery.unsubscribeUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${delivery.unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            }
          : {}),
      });
      return result.accepted?.length
        ? { outcome: 'sent', providerId: result.messageId }
        : { outcome: 'permanent' };
    } catch {
      return { outcome: 'unknown' };
    } finally {
      transport.close();
    }
  }
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM) return { outcome: 'permanent' };
  try {
    const response = await fetcher('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Tibo Alerts', email: normalizeEmail(env.EMAIL_FROM) },
        to: [{ email }],
        subject: delivery.subject,
        textContent: delivery.text,
        headers: {
          idempotencyKey: delivery.attemptId,
          ...(delivery.unsubscribeUrl
            ? {
                'List-Unsubscribe': `<${delivery.unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              }
            : {}),
        },
        tags: ['reset-alert'],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 429) {
      await response.body?.cancel();
      return { outcome: 'retry' };
    }
    if (response.status !== 201) {
      await response.body?.cancel();
      return { outcome: response.status >= 500 ? 'unknown' : 'permanent' };
    }
    const data = (await response.json()) as { messageId?: unknown };
    if (typeof data.messageId !== 'string' || data.messageId.length > 255)
      return { outcome: 'unknown' };
    return { outcome: 'sent', providerId: data.messageId };
  } catch {
    return { outcome: 'unknown' };
  }
}
