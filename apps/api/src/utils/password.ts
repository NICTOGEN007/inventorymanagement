import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

// Lower cost in tests keeps the suite fast; 12 rounds is the production recommendation.
const ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
