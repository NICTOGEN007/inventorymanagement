import type { Role } from './constants.js';

/** Shapes of API responses shared by the server and the web client. */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  /** Short-lived JWT for the Authorization header; keep it in memory only. */
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: UserDto;
}
