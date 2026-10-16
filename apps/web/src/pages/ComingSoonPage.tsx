export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        This module is planned. See docs/PLAN.md for the roadmap.
      </p>
    </div>
  );
}
