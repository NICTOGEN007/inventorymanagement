import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';

export function ForbiddenPage() {
  return (
    <div className="py-16 text-center">
      <ShieldAlert className="mx-auto size-10 text-amber-500" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold">You don't have access to this page</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Ask an administrator if you need it for your work.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Go to your home page
      </Link>
    </div>
  );
}
