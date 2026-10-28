'use client';

import { useEffect, useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';

/**
 * How long to wait for a reply before a lead you own gets a "No reply yet"
 * follow-up (user_settings). Saving also records the browser's timezone, so
 * the hourly job counts days on your calendar.
 */

const WAITS = [3, 5, 7, 10, 14];
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function FollowUpSettings() {
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    void supabase.from('user_settings').select('no_reply_days').maybeSingle()
      .then(({ data }) => setDays((data?.no_reply_days as number | undefined) ?? 5));
  }, [supabase]);

  const save = async (next: number) => {
    setDays(next);
    const { error } = await supabase.from('user_settings')
      .upsert({ no_reply_days: next, timezone: browserZone() }, { onConflict: 'user_id' });
    if (error) toast.error(`Could not save: ${error.message}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Timer aria-hidden className="size-4 text-primary" />
          Follow-ups
        </CardTitle>
        <CardDescription className="text-[12.5px] leading-relaxed">
          When your message goes unanswered, the lead gets a &ldquo;No reply yet&rdquo; follow-up, unless it already has
          a next action. Their reply clears it. What is due shows in Today on the board.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {days === null ? (
          <p className="text-[12.5px] text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="no-reply-days" className="text-[12.5px] font-normal">Chase after</Label>
            <select id="no-reply-days" value={days} onChange={(e) => void save(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-transparent px-2 text-[12.5px]">
              {WAITS.map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <span className="text-[12px] text-muted-foreground">without a reply</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
