import { createHmac, timingSafeEqual } from 'node:crypto';

// Call only on the trusted backend. Never send the bot token to the Mini App.
export function verifyTelegramUser(initData, botToken, now = Date.now()) {
  if (!botToken) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  if (typeof initData !== 'string' || initData.length > 16384) return null;
  const params = new URLSearchParams(initData);
  if (new Set(params.keys()).size !== params.size) return null;
  const hash = params.get('hash');
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) return null;
  params.delete('hash');
  const lines = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, value]) => name + '=' + value);
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(lines.join('\n')).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const age = Math.floor(now / 1000) - Number(params.get('auth_date'));
  if (!Number.isSafeInteger(age) || age < -30 || age > 300) return null;
  try {
    const user = JSON.parse(params.get('user'));
    return Number.isSafeInteger(user?.id) && user.id > 0 ? String(user.id) : null;
  } catch {
    return null;
  }
}
