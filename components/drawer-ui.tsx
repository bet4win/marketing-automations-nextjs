'use client';

import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

/**
 * Any icon that takes a className. Deliberately looser than `LucideIcon`, so
 * the hand-rolled brand marks in brand-icons.tsx are accepted alongside lucide's
 * forwardRef components.
 */
export type IconType = ComponentType<{ className?: string }>;

/**
 * Building blocks for the detail panes.
 *
 * Two rules here are load-bearing rather than decorative, both from measuring
 * the theme's own tokens against WCAG AA on `--card`:
 *
 *   text-muted-foreground        5.39:1   passes
 *   text-muted-foreground/70     3.28:1   fails
 *   text-muted-foreground/60     2.74:1   fails
 *
 * So **no opacity modifier is ever applied to text** — dimmer text is achieved
 * by using the muted token, never by fading the foreground one. And the
 * smallest type is 11px, used only for uppercase section labels; body values
 * are 13px. The previous pane ran to 10px at 60% opacity, which is roughly
 * half the contrast AA asks for.
 */

/** A titled group with an icon, separated by a rule rather than whitespace. */
export function Panel({
  icon: Icon, title, action, children, className,
}: {
  icon?: IconType;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-t border-border py-3.5 first:border-t-0 first:pt-0', className)}>
      <header className="mb-2 flex items-center gap-2">
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** Label/value pair. The label is a real <dt>, so screen readers pair them. */
export function Field({
  icon: Icon, label, children, mono,
}: {
  icon?: IconType;
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="grid grid-cols-[1.1rem_5.5rem_1fr] items-baseline gap-x-2 gap-y-0 py-[3px]">
      <span className="flex items-center justify-center pt-px">
        {Icon && <Icon aria-hidden className="size-3.5 text-muted-foreground" />}
      </span>
      <dt className="text-[12px] leading-5 text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words text-[13px] leading-5 text-foreground',
        mono && 'font-mono text-[12px]')}>
        {empty ? <span className="text-muted-foreground">—</span> : children}
      </dd>
    </div>
  );
}

/**
 * A callout. `tone` picks the accent stripe; every combination was checked
 * against the card background, and the text itself stays on the foreground or
 * muted token rather than the accent colour, which is what keeps it readable.
 */
export function Note({
  tone = 'info', icon: Icon, children,
}: {
  tone?: 'info' | 'warn' | 'data';
  icon?: IconType;
  children: React.ReactNode;
}) {
  const stripe = {
    info: 'border-l-sky-600 dark:border-l-sky-400',
    warn: 'border-l-amber-600 dark:border-l-amber-400',
    data: 'border-l-violet-600 dark:border-l-violet-400',
  }[tone];
  return (
    <div className={cn(
      'flex gap-2 rounded-r-md border border-l-[3px] border-border bg-secondary/60 p-2.5',
      stripe)}
    >
      {Icon && <Icon aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />}
      <p className="text-[12.5px] leading-relaxed text-foreground">{children}</p>
    </div>
  );
}

/** A row that links out, sized as a proper 32px target rather than a line of text. */
export function LinkTile({
  icon: Icon, label, sub, href, hint, title, onClick,
}: {
  icon?: IconType;
  label: string;
  sub?: string;
  href?: string;
  hint?: string;
  title?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-foreground">{label}</span>
        {sub && <span className="block truncate text-[11.5px] text-muted-foreground">{sub}</span>}
      </span>
      {hint && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
          {hint}
        </span>
      )}
    </>
  );
  const cls = 'flex w-full items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2 text-left hover:border-primary hover:bg-secondary';

  if (onClick) {
    return <button type="button" onClick={onClick} title={title} className={cls}>{inner}</button>;
  }
  return (
    <a href={href} target={href?.startsWith('http') ? '_blank' : undefined}
       rel="noopener" title={title} className={cls}>
      {inner}
    </a>
  );
}

/** Compact icon link, for the social row. */
export function IconLink({
  icon: Icon, href, label,
}: { icon: IconType; href: string; label: string }) {
  return (
    <a
      href={href} target="_blank" rel="noopener" title={label} aria-label={label}
      className="flex size-8 items-center justify-center rounded-md border border-border bg-secondary/40 text-muted-foreground hover:border-primary hover:text-primary"
    >
      <Icon aria-hidden className="size-4" />
    </a>
  );
}
