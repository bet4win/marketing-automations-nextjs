'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { LogOut, Moon, Settings, Sun } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initials } from '@/lib/owners';
import { currentTheme, setTheme, type Theme } from '@/lib/theme';

/**
 * Who you are signed in as, and what you can do about it.
 *
 * Replaces a bare email address next to a Sign out button. That took the widest
 * item in the header for the least useful information, and put an irreversible
 * action one stray click away from the export and floorplan buttons beside it.
 */
export function UserMenu({ email, name }: { email: string; name: string | null }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const label = name ?? email;

  /**
   * Read after mount, not during render.
   *
   * The boot script may already have removed the `dark` class, so the class on
   * `<html>` and what the server rendered can legitimately differ. Reading it
   * in render would make this component hydrate against the wrong value; an
   * effect runs once the DOM is real.
   */
  const [theme, setThemeState] = useState<Theme>('dark');
  useEffect(() => setThemeState(currentTheme()), []);

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  const signOut = async () => {
    setSigningOut(true);
    // The existing POST route, so there is one place that ends a session
    // rather than a second client-side path that has to be kept in step.
    await fetch('/auth/signout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account — signed in as ${label}`}
        title={label}
        className="flex size-8 items-center justify-center rounded-full border border-border bg-secondary/60 text-[11px] font-semibold text-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* Initials rather than an icon: with more than one person in the tool,
            the point of the avatar is telling you *which* account is active. */}
        {initials(label)}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5">
          <p className="truncate text-[12.5px] font-medium text-foreground">{label}</p>
          {/* Only once. With no name set the label *is* the address, and
              printing it twice reads like a rendering bug. When a name is set
              the address still earns its line: it is the value stored against
              every lead you own, so it is what matters when reconciling who
              is who. */}
          {name && (
            <p className="truncate text-[11.5px] text-muted-foreground">{email}</p>
          )}
          {!name && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              No display name set — you appear as your email everywhere.
            </p>
          )}
        </div>

        <DropdownMenuSeparator />

        {/* `asChild` so this stays a real anchor and can be middle-clicked or
            opened in a new tab. The cast is needed because Radix's Slot erases
            Link's route generic, so typed routes cannot see the literal — it
            still typechecks as a plain <Link>, which is what proves the path
            is real. */}
        <DropdownMenuItem asChild>
          <Link href={'/account' as Route} className="cursor-pointer">
            <Settings aria-hidden className="size-3.5" />
            Account settings
          </Link>
        </DropdownMenuItem>

        {/* `preventDefault` keeps the menu open: the whole point of this item
            is seeing the theme change, and a menu that vanishes at the moment
            it happens makes you reopen it to check. */}
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); flip(); }}
          className="cursor-pointer"
        >
          {theme === 'dark'
            ? <Sun aria-hidden className="size-3.5" />
            : <Moon aria-hidden className="size-3.5" />}
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          // Radix closes the menu before `onSelect` finishes, so the click is
          // not lost to the unmount.
          onSelect={signOut}
          disabled={signingOut}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut aria-hidden className="size-3.5" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
