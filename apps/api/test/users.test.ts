import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditLogModel, SessionModel } from '../src/models/index.js';
import { updateUser } from '../src/modules/users/service.js';
import { createUser, login, PASSWORD, signedIn } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

describe('/api/users access control', () => {
  it('requires sign-in', async () => {
    expect((await request(createApp()).get('/api/users')).status).toBe(401);
  });

  it('is admin-only', async () => {
    const app = createApp();
    for (const role of ['manager', 'cashier'] as const) {
      const { bearer } = await signedIn(app, role);
      const res = await request(app).get('/api/users').set('Authorization', bearer);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('takes effect immediately when a role changes', async () => {
    const app = createApp();
    const { user, bearer } = await signedIn(app, 'admin');
    await createUser('admin'); // keep another admin around
    await user.updateOne({ role: 'manager' });
    expect((await request(app).get('/api/users').set('Authorization', bearer)).status).toBe(403);
  });
});

describe('managing users', () => {
  it('lists, filters and searches users without password hashes', async () => {
    const app = createApp();
    const { bearer } = await signedIn(app, 'admin');
    await createUser('cashier', { email: 'priya@example.com' });
    await createUser('cashier', { isActive: false });

    const all = await request(app).get('/api/users').set('Authorization', bearer);
    expect(all.body.data).toHaveLength(3);
    expect(JSON.stringify(all.body)).not.toContain('passwordHash');

    const cashiers = await request(app)
      .get('/api/users?role=cashier&status=active')
      .set('Authorization', bearer);
    expect(cashiers.body.data).toHaveLength(1);
    const search = await request(app).get('/api/users?search=PRIYA').set('Authorization', bearer);
    expect(search.body.data.map((u: { email: string }) => u.email)).toEqual(['priya@example.com']);
    // Regex characters in a search are treated literally.
    expect(
      (await request(app).get('/api/users?search=.*').set('Authorization', bearer)).body.data,
    ).toHaveLength(0);
    expect(
      (await request(app).get('/api/users?role=owner').set('Authorization', bearer)).status,
    ).toBe(400);
  });

  it('creates users who can then sign in', async () => {
    const app = createApp();
    const { bearer } = await signedIn(app, 'admin');
    const res = await request(app).post('/api/users').set('Authorization', bearer).send({
      name: 'Rahul Gowda',
      email: 'Rahul@Example.com',
      role: 'cashier',
      password: 'Cashier2026',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'rahul@example.com',
      role: 'cashier',
      isActive: true,
    });
    await login(app, 'rahul@example.com', 'Cashier2026');
    expect(await AuditLogModel.countDocuments({ action: 'user.create' })).toBe(1);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const app = createApp();
    const { bearer } = await signedIn(app, 'admin');
    const existing = await createUser('cashier');
    const dup = await request(app)
      .post('/api/users')
      .set('Authorization', bearer)
      .send({ name: 'Dup', email: existing.email, role: 'cashier', password: 'Cashier2026' });
    expect(dup.status).toBe(409);
    const weak = await request(app)
      .post('/api/users')
      .set('Authorization', bearer)
      .send({ name: 'Weak', email: 'weak@example.com', role: 'cashier', password: 'password' });
    expect(weak.status).toBe(400);
  });

  it('changes roles and names', async () => {
    const app = createApp();
    const { bearer } = await signedIn(app, 'admin');
    const cashier = await createUser('cashier');
    const res = await request(app)
      .patch(`/api/users/${cashier._id}`)
      .set('Authorization', bearer)
      .send({ role: 'manager', name: 'Promoted Person' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'manager', name: 'Promoted Person' });
  });

  it('signs a user out everywhere when deactivated', async () => {
    const app = createApp();
    const { bearer } = await signedIn(app, 'admin');
    const cashier = await createUser('cashier');
    const session = await login(app, cashier.email);

    const res = await request(app)
      .patch(`/api/users/${cashier._id}`)
      .set('Authorization', bearer)
      .send({ isActive: false });
    expect(res.body.user.isActive).toBe(false);
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', session.bearer)).status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', session.cookie)).status,
    ).toBe(401);
    expect(await SessionModel.countDocuments({ user: cashier._id, revokedAt: null })).toBe(0);
  });

  it('stops admins from demoting or deactivating themselves', async () => {
    const app = createApp();
    const { user, bearer } = await signedIn(app, 'admin');
    for (const body of [{ role: 'cashier' }, { isActive: false }]) {
      const res = await request(app)
        .patch(`/api/users/${user._id}`)
        .set('Authorization', bearer)
        .send(body);
      expect(res.status).toBe(400);
    }
    // Renaming yourself is fine.
    expect(
      (
        await request(app)
          .patch(`/api/users/${user._id}`)
          .set('Authorization', bearer)
          .send({ name: 'Me' })
      ).status,
    ).toBe(200);
  });

  it('never removes the last active admin', async () => {
    const onlyAdmin = await createUser('admin');
    const someoneElse = await createUser('manager');
    await expect(
      updateUser(String(someoneElse._id), String(onlyAdmin._id), { role: 'manager' }),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    await createUser('admin');
    await expect(
      updateUser(String(someoneElse._id), String(onlyAdmin._id), { role: 'manager' }),
    ).resolves.toMatchObject({
      role: 'manager',
    });
  });

  it('resets a password and ends existing sessions', async () => {
    const app = createApp();
    const { bearer } = await signedIn(app, 'admin');
    const cashier = await createUser('cashier');
    const session = await login(app, cashier.email);

    const res = await request(app)
      .post(`/api/users/${cashier._id}/reset-password`)
      .set('Authorization', bearer)
      .send({ password: 'Fresh2026' });
    expect(res.status).toBe(200);
    expect(
      (await request(app).post('/api/auth/refresh').set('Cookie', session.cookie)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: cashier.email, password: PASSWORD })
      ).status,
    ).toBe(401);
    await login(app, cashier.email, 'Fresh2026');
  });

  it('returns 404 for unknown or malformed ids', async () => {
    const app = createApp();
    const { bearer } = await signedIn(app, 'admin');
    expect(
      (await request(app).get('/api/users/507f1f77bcf86cd799439011').set('Authorization', bearer))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get('/api/users/not-an-id').set('Authorization', bearer)).status,
    ).toBe(404);
  });
});
