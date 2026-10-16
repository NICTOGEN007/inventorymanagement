import type { Role } from '@ims/shared';

declare global {
  namespace Express {
    interface Request {
      /** The signed-in user, set by the `authenticate` middleware. */
      user?: {
        id: string;
        name: string;
        email: string;
        role: Role;
      };
    }
  }
}

export {};
