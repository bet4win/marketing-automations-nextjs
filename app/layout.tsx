import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import { STORAGE_BOOT_SCRIPT } from '@/lib/storage';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lanyard',
  description: 'Leads, deals and distribution reach for iGaming sales',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /* `dark` here is the default, and the script below is what lets a stored
       preference win before anything paints. `suppressHydrationWarning`
       because that script legitimately changes the class the server sent, and
       React would otherwise report the mismatch it was written to cause. */
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Both are module constants with nothing interpolated into them — no
            request data, no user input, so there is nothing here to inject.
            Order matters: the migration has to land `lanyard.theme` before the
            theme script reads it, or a stored light preference flashes dark
            once on the first load after the rename. */}
        <script dangerouslySetInnerHTML={{ __html: STORAGE_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="h-dvh overflow-hidden antialiased">
        {children}
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
