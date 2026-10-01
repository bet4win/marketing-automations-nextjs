import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AccountForm } from '@/components/account-form';

export const metadata = { title: 'Account · Lanyard' };

/**
 * Your own account. Rendered on the server so the fields arrive filled in
 * rather than flashing empty and then populating — the values come from the
 * session that already had to be read to guard the route.
 */
export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name, meta.user_name]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Back to the board
      </Link>

      <h1 className="mb-1 text-lg font-semibold">Account</h1>
      <p className="mb-6 text-[12.5px] text-muted-foreground">
        Signed in as {user.email}
      </p>

      <AccountForm
        email={user.email ?? ''}
        name={name?.trim() ?? ''}
        createdAt={user.created_at ?? null}
        lastSignInAt={user.last_sign_in_at ?? null}
      />
    </main>
  );
}
