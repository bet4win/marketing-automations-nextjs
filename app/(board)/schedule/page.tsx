export const metadata = { title: 'Schedule · Lanyard' };

/**
 * Renders nothing on purpose.
 *
 * The board is in the layout so that navigating between the three views does
 * not remount it and refetch everything. This page exists to give the view a
 * URL and a title; `LeadDesk` reads which view is active from the pathname.
 */
export default function Page() {
  return null;
}
