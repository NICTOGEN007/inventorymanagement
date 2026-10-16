import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link
        to="/"
        className="mt-4 inline-block text-indigo-600 hover:underline dark:text-indigo-400"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
