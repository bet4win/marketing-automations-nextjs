/**
 * The Lanyard mark: a cord loop tapering to an open hook.
 *
 * Inlined rather than pointed at `app/icon.svg`, because that file is consumed
 * by Next's metadata convention and served at a hashed URL — there is no stable
 * path to put in an `<img src>`. Inlining also lets it take `currentColor`, so
 * one component covers both themes instead of two files that have to be kept in
 * step with the token block.
 *
 * Geometry is the favicon's, deliberately: two forms, no swivel eye. The eye is
 * sub-pixel below about 24px and this renders at 20. The loop's sides are
 * convex on purpose — straight converging legs read as a funnel, not as cord.
 *
 * `aria-hidden` because the wordmark beside it already says "Lanyard", and a
 * screen reader announcing the name twice is noise.
 */
export function LanyardMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16 17C13 15 5.5 13.5 5.5 9.3C5.5 4.5 10.5 2.5 16 2.5C21.5 2.5 26.5 4.5 26.5 9.3C26.5 13.5 19 15 16 17Z" />
      <path d="M16 17L16 17.8A5.5 5.5 0 1 0 21.5 23.3" />
    </svg>
  );
}
