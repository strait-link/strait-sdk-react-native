import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createStrait, type StraitRuntime, type KeyValueStore } from '../src/index.js';
import { sha256Hex, userIdField, USER_ID_MAX } from '../src/core.js';

// Contract B27 (shared-spec ADR 0009, engine ADR 0110): setUserId(id) after the app's own sign-in; later
// events carry it on the app.event webhook. Emails and phone numbers are hashed on the device.

const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
  it.each(['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(200), 'josé@example.com', '日本語', '\u{1F600}x'])('equals node crypto for %#', (s) => {
    expect(sha256Hex(s)).toBe(node(s));
  });
});

describe('userIdField', () => {
  it('keeps an opaque id, trimmed', () => {
    expect(userIdField('  user_4821 ')).toEqual({ userId: 'user_4821', userIdHashed: false });
  });
  it('hashes an email, lower-cased and trimmed', () => {
    expect(userIdField(' Priya@Example.COM ')).toEqual({ userId: node('priya@example.com'), userIdHashed: true });
  });
  it('hashes a phone number as its digits', () => {
    expect(userIdField('+91 98765-43210')).toEqual({ userId: node('919876543210'), userIdHashed: true });
  });
  it('drops empty, too long, control characters and non-strings', () => {
    for (const bad of [null, undefined, 42, '', '   ', 'x'.repeat(USER_ID_MAX + 1), 'a\nb']) expect(userIdField(bad)).toBeNull();
    expect(userIdField('x'.repeat(USER_ID_MAX))).toEqual({ userId: 'x'.repeat(USER_ID_MAX), userIdHashed: false });
  });
});

let t = 1_800_000_000_000;
function runtime(): StraitRuntime {
  return {
    platform: () => 'android',
    collectDevice: () => ({ screenWidth: 411, pixelRatio: 2.625, language: 'en', timezone: 'Asia/Kolkata' }),
    getInstallReferrer: async () => null,
    getInitialURL: async () => null,
    onURL: () => () => undefined,
    onAppState: () => () => undefined,
    now: () => t,
  };
}
function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>([['strait.deferredChecked', '1']]);
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}
async function make(route: number | 'offline' = 202) {
  const events: any[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    if (new URL(url).pathname === '/v1/event') events.push(JSON.parse(String(init!.body)));
    if (route === 'offline') throw new TypeError('Network request failed');
    return { ok: route < 400, status: route, json: async () => ({}) } as Response;
  }) as unknown as typeof globalThis.fetch;
  const s = store();
  const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://links.test', runtime: runtime(), fetch, storage: s });
  await strait.start();
  return { strait, events, s };
}

describe('setUserId (B27)', () => {
  it('events after setUserId carry it; setUserId(null) stops it', async () => {
    const { strait, events } = await make();
    await strait.trackEvent('open_cart');
    strait.setUserId('user_4821');
    await strait.trackEvent('purchase');
    strait.setUserId(null);
    await strait.trackEvent('after_logout');
    expect(events[0]).not.toHaveProperty('userId');
    expect(events[1]).toMatchObject({ event: 'purchase', userId: 'user_4821', userIdHashed: false });
    expect(events[2]).not.toHaveProperty('userId');
    expect(events[2]).not.toHaveProperty('userIdHashed');
  });

  it('an email never leaves the device: only its hash is sent, and only the hash is queued', async () => {
    const { strait, events, s } = await make('offline');
    strait.setUserId('Priya@Example.com');
    await strait.trackEvent('purchase');
    expect(events[0]).toMatchObject({ userId: node('priya@example.com'), userIdHashed: true });
    expect(JSON.stringify(events[0])).not.toContain('Priya');
    expect(s.data.get('strait.pendingOpens')).toContain(node('priya@example.com'));
    expect(s.data.get('strait.pendingOpens')).not.toMatch(/priya/i);
  });

  it('the id at the time of the event is the one sent, even when the event is sent later', async () => {
    const { strait, s } = await make('offline');
    strait.setUserId('user_1');
    await strait.trackEvent('purchase');
    strait.setUserId('user_2');
    expect(JSON.parse(s.data.get('strait.pendingOpens')!)[0]).toMatchObject({ userId: 'user_1' });
  });

  it('opting out clears it; setUserId while off is ignored; back on sends nothing until set again', async () => {
    const { strait, events } = await make();
    strait.setUserId('user_4821');
    await strait.setEnabled(false);
    strait.setUserId('user_9');
    await strait.setEnabled(true);
    await strait.trackEvent('purchase');
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('userId');
  });

  it('the id when trackEvent is called is the one sent, even if setUserId runs before the event goes out', async () => {
    const { strait, events } = await make();
    strait.setUserId('user_1');
    const p = strait.trackEvent('purchase');
    strait.setUserId(null);
    await p;
    strait.setUserId('user_2');
    const q = strait.trackEvent('refund');
    strait.setUserId('user_3');
    await q;
    expect(events.find((e) => e.event === 'purchase')).toMatchObject({ userId: 'user_1' });
    expect(events.find((e) => e.event === 'refund')).toMatchObject({ userId: 'user_2' });
  });

  it('a bad value clears the previous id instead of sending it', async () => {
    const { strait, events } = await make();
    strait.setUserId('user_1');
    strait.setUserId('x'.repeat(USER_ID_MAX + 1));
    await strait.trackEvent('purchase');
    expect(events[0]).not.toHaveProperty('userId');
  });
});

describe('setUserId before start (B27)', () => {
  it('a stored opt-out drops an id set before the switch was read', async () => {
    const s = store();
    s.data.set('strait.enabled', '0');
    const events: any[] = [];
    const fetch = (async (_u: string, init?: RequestInit) => (events.push(JSON.parse(String(init!.body))), { ok: true, status: 202, json: async () => ({}) })) as unknown as typeof globalThis.fetch;
    const strait = createStrait({ publishableKey: 'st_pub_test_x', endpoint: 'https://links.test', runtime: runtime(), fetch, storage: s });
    strait.setUserId('user_4821');
    await new Promise((r) => setTimeout(r, 0));
    await strait.setEnabled(true);
    await strait.trackEvent('purchase');
    const sent = events.filter((e) => e.event === 'purchase');
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('userId');
  });
});
