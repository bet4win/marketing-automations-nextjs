import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // ingest/ is Python and supabase/ is SQL; neither belongs in the bundle.
  typedRoutes: true,

  /**
   * `/` is not a view of its own.
   *
   * The three tabs are real routes, so the root has nothing to render. Done
   * here rather than as a page that calls `redirect()`: this is a routing
   * concern, it resolves before any rendering, and it leaves no component
   * whose whole body is one redirect. Bookmarks on `/` keep working.
   *
   * Not permanent — which view is the landing page is a product decision that
   * may change, and a 308 would be cached by browsers past that decision.
   */
  async redirects() {
    return [{ source: '/', destination: '/companies', permanent: false }];
  },
};

export default nextConfig;
