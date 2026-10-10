// Pinned to a specific, verified-published version (checked against the
// real npm registry, not guessed — see tests/README.md's "Dependency
// reproducibility" note) rather than the floating "@2" tag, so a new
// supabase-js release can't silently change this app's behaviour on the
// next page load. Bump deliberately: check `npm view @supabase/supabase-js
// version`, then update this string and re-run the test suite.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

if (SUPABASE_URL.startsWith("YOUR_")) {
  document.addEventListener("DOMContentLoaded", () => {
    const banner = document.createElement("div");
    banner.style.cssText =
      "background:#c0392b;color:#fff;padding:12px 20px;font-family:sans-serif;font-size:14px;text-align:center;";
    banner.textContent =
      "Site Tracker is not configured yet — set SUPABASE_URL and SUPABASE_ANON_KEY in tracker/js/config.js (see tracker/README.md).";
    document.body.prepend(banner);
  });
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
