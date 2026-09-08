/**
 * Reference data would not load.
 *
 * Its own component because all three view routes need it and the cause is
 * almost always the same one: a table that has policies but no grants. Saying
 * so here saves the next person the hour it cost the first time.
 */
export function BoardError({ message }: { message: string }) {
  return (
    <main className="grid h-dvh place-items-center p-6">
      <div className="max-w-md rounded-lg border border-amber-300/60 dark:border-amber-900/60 bg-card p-4 text-sm">
        <p className="mb-2 font-medium">Could not load reference data</p>
        <p className="text-muted-foreground">{message}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          A 403 here means the signed-in role has no GRANT on the table —
          policies alone are not enough. Check the grants migration applied.
        </p>
      </div>
    </main>
  );
}
