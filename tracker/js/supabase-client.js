import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
