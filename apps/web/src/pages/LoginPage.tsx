import { zodResolver } from '@hookform/resolvers/zod';
import { can, loginSchema, type LoginInput } from '@ims/shared';
import { Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { homePathFor } from '@/auth/guards';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { useTheme } from '@/lib/theme';

/** Demo accounts created by `npm run seed`. Hide with VITE_DEMO_LOGINS=false. */
const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@stocksmart.test', password: 'Admin@123' },
  { role: 'Manager', email: 'manager@stocksmart.test', password: 'Manager@123' },
  { role: 'Cashier', email: 'cashier@stocksmart.test', password: 'Cashier@123' },
] as const;
const SHOW_DEMO = import.meta.env.VITE_DEMO_LOGINS !== 'false';

export function LoginPage() {
  const { status, user, login } = useAuth();
  const { theme, toggle } = useTheme();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  // After a successful sign-in (or if already signed in), go where the user was heading.
  if (status === 'authenticated' && user) {
    return <Navigate to={from ?? homePathFor(can(user.role, 'reports:read'))} replace />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : 'Could not reach the server. Is the API running?',
      );
    }
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <button
        type="button"
        onClick={toggle}
        className="absolute top-4 right-4 rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-slate-800"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>

      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto size-12" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Sign in to StockSmart</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Inventory & sales management
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {serverError && <ErrorAlert>{serverError}</ErrorAlert>}
            <Field label="Email" error={errors.email?.message}>
              <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              {(control) => (
                <div className="relative">
                  <Input
                    {...control}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="pr-10"
                    {...form.register('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-600"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              )}
            </Field>
            <Button type="submit" className="w-full" loading={isSubmitting}>
              Sign in
            </Button>
          </form>
        </Card>

        {SHOW_DEMO && (
          <Card className="mt-4 p-4">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
              Demo accounts
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <Button
                  key={account.email}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    form.setValue('email', account.email, { shouldValidate: true });
                    form.setValue('password', account.password, { shouldValidate: true });
                  }}
                >
                  {account.role}
                </Button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
