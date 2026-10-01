'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, Check, KeyRound, Save, ShieldAlert, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Manage your own account: display name and password.
 *
 * Both go through `/api/account*` rather than calling `supabase.auth` from
 * here. Not for security — the browser client could do either with the same
 * token — but because the server is where the rules live: the name is
 * normalised in one place, and the password change verifies the current one
 * first, which the client-side call does not.
 */

const MIN_PASSWORD = 10;

/** Module scope, or every keystroke remounts the input and focus goes with it. */
function Section({
  icon: Icon, title, description, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Icon aria-hidden className="size-4 text-primary" />
          {title}
        </CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const fmt = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : '—');

export function AccountForm({
  email, name: initialName, createdAt, lastSignInAt,
}: {
  email: string;
  name: string;
  createdAt: string | null;
  lastSignInAt: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  /**
   * The value actually stored, which is not always what was typed — the server
   * collapses whitespace. Tracked separately because `initialName` only seeds
   * `useState` once: after a save, `router.refresh()` hands down a new prop
   * that the state ignores, so comparing against the prop left Save enabled
   * and the field showing the un-normalised text.
   */
  const [saved, setSaved] = useState(initialName);
  const [savingName, setSavingName] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const nameDirty = name.trim() !== saved.trim();

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      // Show what was stored, not what was typed.
      setName(body.account.name ?? '');
      setSaved(body.account.name ?? '');
      toast.success(body.account.name
        ? `Display name set to ${body.account.name}`
        : 'Display name cleared — your email will be shown instead');
      // The header and every owner dropdown read this, so re-render the server
      // components rather than leaving the old name on screen.
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return toast.error('The two new passwords do not match');
    setSavingPassword(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current, password: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      toast.success('Password changed');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Section
        icon={UserRound}
        title="Display name"
        description="Shown instead of your email address in the header, the Owner column and every owner dropdown. Leave it empty to be shown as your email."
      >
        <form onSubmit={saveName} className="flex flex-wrap items-end gap-2">
          <div className="grid min-w-[240px] flex-1 gap-2">
            <Label htmlFor="display-name">Name</Label>
            <Input
              id="display-name" value={name} maxLength={64}
              placeholder={email.split('@')[0]}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={savingName || !nameDirty}>
            <Save className="mr-1.5 size-3.5" />
            {savingName ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </Section>

      <Section
        icon={KeyRound}
        title="Password"
        description={`Your current password is required, so a borrowed browser tab cannot lock you out of your own account. At least ${MIN_PASSWORD} characters.`}
      >
        <form onSubmit={savePassword} className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password" type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password" type="password" autoComplete="new-password"
                value={next} onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Repeat new password</Label>
              <Input
                id="confirm-password" type="password" autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
              />
              {confirm.length > 0 && (
                <p className={next === confirm
                  ? 'flex items-center gap-1 text-[11.5px] text-emerald-700 dark:text-emerald-300'
                  : 'text-[11.5px] text-amber-700 dark:text-amber-300'}>
                  {next === confirm
                    ? <><Check aria-hidden className="size-3" /> Matches</>
                    : 'Does not match'}
                </p>
              )}
            </div>
          </div>
          <div>
            <Button
              type="submit"
              disabled={savingPassword || !current || next.length < MIN_PASSWORD || next !== confirm}
            >
              <KeyRound className="mr-1.5 size-3.5" />
              {savingPassword ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </form>
      </Section>

      <Section
        icon={AtSign}
        title="Email address"
        description="Not editable here, and that is deliberate rather than unfinished."
      >
        <div className="grid gap-2">
          <Input value={email} readOnly aria-label="Email address" className="font-mono text-[12.5px]" />
          <div className="flex gap-2 rounded-r-md border border-l-[3px] border-border border-l-amber-600 dark:border-l-amber-400 bg-secondary/60 p-2.5">
            <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[12px] leading-relaxed text-foreground">
              Lead ownership is stored <b>as an email address</b>, so changing
              yours would orphan every company assigned to you — the rows would
              keep pointing at an address that no longer belongs to anyone. They
              would still be visible, marked <i>not an account</i>, and would
              have to be reassigned by hand. Nothing here does that yet, which
              is why the field is read-only rather than merely discouraged.
            </p>
          </div>
        </div>
      </Section>

      <Section
        icon={UserRound}
        title="This account"
        description="Read-only facts, useful mainly when something looks wrong."
      >
        <dl className="grid gap-1 text-[12.5px]">
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-muted-foreground">Created</dt>
            <dd>{fmt(createdAt)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 shrink-0 text-muted-foreground">Last sign-in</dt>
            <dd>{fmt(lastSignInAt)}</dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
