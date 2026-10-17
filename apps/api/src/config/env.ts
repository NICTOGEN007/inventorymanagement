import { z } from 'zod';

// Load apps/api/.env when present (Node >= 21.7). Real environment variables always win.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the process environment.
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string()
    .min(1)
    .default('mongodb://localhost:27017/inventory?replicaSet=rs0&directConnection=true'),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Secret for signing access tokens. Must be long and random in production. */
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
    .optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** Send the refresh cookie over HTTPS only. Defaults to true in production. */
  COOKIE_SECURE: z.stringbool().optional(),
  /**
   * `strict` works when the web app and API share a site (Vite proxy, nginx, one domain).
   * Use `none` (with HTTPS) only if they are deployed on different sites.
   */
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  /** Google AI Studio key for the assistant. Without it the assistant is off; all else works. */
  GEMINI_API_KEY: z
    .string()
    .trim()
    .transform((v) => v || undefined)
    .optional(),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
});

/** Used only outside production so the app runs without setup. Never use it for real data. */
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-do-not-use-in-production';

const resolvedSchema = envSchema
  .refine((e) => e.COOKIE_SAME_SITE !== 'none' || e.COOKIE_SECURE !== false, {
    message: 'COOKIE_SAME_SITE=none requires COOKIE_SECURE=true (browsers reject it otherwise)',
    path: ['COOKIE_SAME_SITE'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.JWT_ACCESS_SECRET !== undefined, {
    message:
      'JWT_ACCESS_SECRET is required in production (generate one with: openssl rand -hex 32)',
    path: ['JWT_ACCESS_SECRET'],
  })
  .transform((e) => ({
    ...e,
    JWT_ACCESS_SECRET: e.JWT_ACCESS_SECRET ?? DEV_JWT_SECRET,
    COOKIE_SECURE: e.COOKIE_SECURE ?? e.NODE_ENV === 'production',
  }));

export type Env = z.infer<typeof resolvedSchema>;

function loadEnv(): Env {
  const parsed = resolvedSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:\n' + z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProduction = env.NODE_ENV === 'production';
