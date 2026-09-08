/**
 * Carrying stored preferences across the Lead Desk → Lanyard rename.
 *
 * Nine keys were namespaced `leaddesk.` — column widths, both drawer widths,
 * the filter rail, the calendar, the selected event, the per-event view state
 * and the theme. Renaming the constants alone would have been silent data
 * loss: every one of them is read with a fallback, so a missing key looks
 * exactly like a first visit. Someone who had dragged their panels and hidden
 * six columns would have found the defaults back and nothing to explain it.
 *
 * A prefix copy rather than nine per-key fallbacks, because the per-event
 * `leaddesk.view.<eventId>` keys are unbounded — there is no list of them to
 * enumerate — and because a key added later inherits the migration for free.
 */

export const STORAGE_PREFIX = 'lanyard.';

const LEGACY_PREFIX = 'leaddesk.';

/**
 * Runs in a blocking script in `<head>`, ahead of the theme script.
 *
 * It has to beat two things to the storage: the theme boot script, which now
 * reads `lanyard.theme`, and every component whose `useState` initializer
 * reads a key lazily during the first render. A `useEffect` would lose both
 * races and migrate the keys just after everything had already defaulted.
 *
 * Old keys are copied, not moved. Rolling a deploy back is most likely in the
 * hours right after it ships, which is exactly when deleting them would strand
 * people on the previous build with their preferences gone. The `=== null`
 * guard makes the copy idempotent, so leaving them costs a few reads per load
 * and nothing else.
 */
export const STORAGE_BOOT_SCRIPT = `
try {
  var keys = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (k && k.indexOf('${LEGACY_PREFIX}') === 0) keys.push(k);
  }
  for (var j = 0; j < keys.length; j++) {
    var to = '${STORAGE_PREFIX}' + keys[j].slice(${LEGACY_PREFIX.length});
    if (localStorage.getItem(to) === null) {
      localStorage.setItem(to, localStorage.getItem(keys[j]));
    }
  }
} catch (e) {}
`.trim();
