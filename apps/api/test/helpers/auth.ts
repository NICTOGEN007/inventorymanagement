import type { Role } from '@ims/shared';
import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { UserModel } from '../../src/models/index.js';
import { hashPassword } from '../../src/utils/password.js';

export const PASSWORD = 'Secret2026';

let counter = 0;

export async function createUser(
  role: Role = 'admin',
  overrides: { isActive?: boolean; email?: string } = {},
) {
  counter += 1;
  return UserModel.create({
    name: `Test ${role} ${counter}`,
    email: overrides.email ?? `${role}${counter}@example.com`,
    role,
    isActive: overrides.isActive ?? true,
    passwordHash: await hashPassword(PASSWORD),
  });
}

/** The `name=value` part of the refresh cookie from a response, for sending back. */
export function refreshCookieFrom(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((c) => c.startsWith('ims_refresh='));
  expect(cookie, 'refresh cookie should be set').toBeDefined();
  return cookie!.split(';')[0]!;
}

export async function login(app: Express, email: string, password = PASSWORD) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return {
    accessToken: res.body.accessToken as string,
    cookie: refreshCookieFrom(res),
    bearer: `Bearer ${res.body.accessToken as string}`,
  };
}

/** Creates a user of the given role and signs them in. */
export async function signedIn(app: Express, role: Role = 'admin') {
  const user = await createUser(role);
  return { user, ...(await login(app, user.email)) };
}
