import { SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLogModel, SessionModel, UserModel } from '../src/models/index.js';
import { signAccessToken } from '../src/modules/auth/tokens.js';
import { createUser, login, PASSWORD, refreshCookieFrom } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

describe('POST /api/auth/login', () => {
  it('signs in and sets a secure refresh cookie', async () => {
    const app = createApp();
    const user = await createUser('manager');
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email.toUpperCase(), password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      expiresIn: 900,
      user: { email: user.email, role: 'manager' },
    });
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('ims_refresh='),
    )!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);

    expect((await UserModel.findById(user._id))?.lastLoginAt).toBeInstanceOf(Date);
    expect(await AuditLogModel.countDocuments({ action: 'auth.login' })).toBe(1);
    // Only the hash of the refresh token is stored.
    const session = await SessionModel.findOne({ user: user._id });
    expect(session?.tokenHash).toHaveLength(64);
    expect(cookie).not.toContain(session!.tokenHash);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const app = createApp();
    const user = await createUser();
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'Nope12345' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Nope12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('refuses deactivated accounts', async () => {
    const app = createApp();
    const user = await createUser('cashier', { isActive: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('validates the request body', async () => {
    const res = await request(createApp()).post('/api/auth/login').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('locks out an account after 10 failed attempts, without counting successes', async () => {
    const app = createApp();
    const user = await createUser();
    await login(app, user.email); // a success does not count towards the limit
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'Wrong1234' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    // Other accounts from the same IP are unaffected.
    const other = await createUser();
    await login(app, other.email);
  });
});

describe('access tokens', () => {
  it('authenticates /me with a bearer token', async () => {
    const app = createApp();
    const user = await createUser('cashier');
    const { bearer } = await login(app, user.email);
    const res = await request(app).get('/api/auth/me').set('Authorization', bearer);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: String(user._id), role: 'cashier' });
  });

  it('rejects missing, malformed, tampered, foreign and expired tokens', async () => {
    const app = createApp();
    const user = await createUser();
    const { accessToken } = await login(app, user.email);
    const me = (auth?: string) => {
      const req = request(app).get('/api/auth/me');
      return auth ? req.set('Authorization', auth) : req;
    };

    expect((await me()).body.error.code).toBe('UNAUTHORIZED');
    expect((await me('Basic abc')).status).toBe(401);
    expect((await me('Bearer not.a.jwt')).body.error.code).toBe('TOKEN_INVALID');

    const [header, payload, signature] = accessToken.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
        role: 'admin',
        sub: 'x',
      }),
    ).toString('base64url');
    expect((await me(`Bearer ${header}.${forgedPayload}.${signature}`)).body.error.code).toBe(
      'TOKEN_INVALID',
    );

    const foreign = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user._id))
      .setIssuer('stocksmart-api')
      .setAudience('stocksmart-web')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('some-other-secret-that-is-long-enough-123'));
    expect((await me(`Bearer ${foreign}`)).body.error.code).toBe('TOKEN_INVALID');

    const expired = await signAccessToken({ userId: String(user._id), role: 'admin' }, -10);
    expect((await me(`Bearer ${expired}`)).body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('stops working as soon as the account is deactivated', async () => {
    const app = createApp();
    const user = await createUser('cashier');
    const { bearer } = await login(app, user.email);
    await UserModel.updateOne({ _id: user._id }, { isActive: false });
    const res = await request(app).get('/api/auth/me').set('Authorization', bearer);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const app = createApp();
    const user = await createUser();
    const { cookie } = await login(app, user.email);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(String(user._id));
    const next = refreshCookieFrom(res);
    expect(next).not.toBe(cookie);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    // The new token works again; the old one has been used up.
    expect((await request(app).post('/api/auth/refresh').set('Cookie', next)).status).toBe(200);
  });

  it('tells a racing second request to retry, without ending the session', async () => {
    const app = createApp();
    const { cookie } = await login(app, (await createUser()).email);
    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    const second = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('REFRESH_RACE');
    expect(second.headers['set-cookie']).toBeUndefined(); // keeps the newer cookie
    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', refreshCookieFrom(first))).status,
    ).toBe(200);
  });

  it('revokes the whole session family when an old token is replayed', async () => {
    const app = createApp();
    const user = await createUser();
    const { cookie: stolen } = await login(app, user.email);
    const legit = refreshCookieFrom(
      await request(app).post('/api/auth/refresh').set('Cookie', stolen),
    );
    // Pretend the rotation happened a minute ago, past the race grace period.
    await SessionModel.updateMany(
      { revokedReason: 'rotated' },
      { revokedAt: new Date(Date.now() - 60_000) },
    );

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', stolen);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_REUSED');
    // The legitimate holder is signed out too, so the attacker's copy is worthless.
    const after = await request(app).post('/api/auth/refresh').set('Cookie', legit);
    expect(after.body.error.code).toBe('REFRESH_INVALID');
    expect(await SessionModel.countDocuments({ revokedReason: 'reuse' })).toBe(1);
  });

  it('rejects missing, unknown and expired refresh tokens', async () => {
    const app = createApp();
    expect((await request(app).post('/api/auth/refresh')).body.error.code).toBe('REFRESH_MISSING');
    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', 'ims_refresh=made-up')).body.error
        .code,
    ).toBe('REFRESH_INVALID');

    const { cookie } = await login(app, (await createUser()).email);
    await SessionModel.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', cookie)).body.error.code,
    ).toBe('REFRESH_INVALID');
  });

  it('refuses to refresh for a deactivated account', async () => {
    const app = createApp();
    const user = await createUser('cashier');
    const { cookie } = await login(app, user.email);
    await UserModel.updateOne({ _id: user._id }, { isActive: false });
    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const app = createApp();
    const { cookie } = await login(app, (await createUser()).email);
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(
      /ims_refresh=;.*Expires=Thu, 01 Jan 1970/,
    );
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('succeeds even without a session', async () => {
    expect((await request(createApp()).post('/api/auth/logout')).status).toBe(204);
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password and signs out other devices only', async () => {
    const app = createApp();
    const user = await createUser('cashier');
    const laptop = await login(app, user.email);
    const phone = await login(app, user.email);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', laptop.bearer)
      .set('Cookie', laptop.cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'NewSecret99' });
    expect(res.status).toBe(204);

    expect((await request(app).post('/api/auth/refresh').set('Cookie', laptop.cookie)).status).toBe(
      200,
    );
    expect((await request(app).post('/api/auth/refresh').set('Cookie', phone.cookie)).status).toBe(
      401,
    );
    await login(app, user.email, 'NewSecret99');
    const old = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(old.status).toBe(401);
  });

  it('requires the correct current password and a strong new one', async () => {
    const app = createApp();
    const user = await createUser();
    const { bearer } = await login(app, user.email);
    const send = (body: object) =>
      request(app).post('/api/auth/change-password').set('Authorization', bearer).send(body);

    const wrong = await send({ currentPassword: 'Wrong1234', newPassword: 'NewSecret99' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_PASSWORD');
    expect((await send({ currentPassword: PASSWORD, newPassword: 'weak' })).body.error.code).toBe(
      'VALIDATION_ERROR',
    );
  });
});
