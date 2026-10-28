import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AccountForm } from '@/components/account-form';
import { ConnectedAccounts } from '@/components/connected-accounts';
import { FollowUpSettings } from '@/components/follow-up-settings';
import { availableProviders } from '@/lib/integrations/available';

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
    // Its own scroll area: the root layout pins <body> to the viewport with
    // overflow hidden, which the board needs and this page does not.
    <div className="h-dvh overflow-y-auto">
      <main className="mx-auto w-full max-w-[100rem] px-6 py-8">
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

        {/* Cards flow into balanced columns: one on a phone, two on a laptop,
            three on a wide screen, so the page fits without scrolling. What
            Lanyard does for you comes first; who you are after. */}
        <div className="gap-4 lg:columns-2 2xl:columns-3 [&_[data-slot=card]]:mb-4 [&_[data-slot=card]]:break-inside-avoid">
          {/* It reads the query string (a provider callback's outcome). */}
          <Suspense fallback={null}>
            <ConnectedAccounts available={availableProviders()} />
          </Suspense>
          <FollowUpSettings />
          <AccountForm
            email={user.email ?? ''}
            name={name?.trim() ?? ''}
            createdAt={user.created_at ?? null}
            lastSignInAt={user.last_sign_in_at ?? null}
            className="contents"
          />
        </div>
      </main>
    </div>
  );
}
