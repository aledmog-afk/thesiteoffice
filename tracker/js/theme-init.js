// Applies the saved colour scheme (see Settings → Appearance,
// tracker/settings.html) to <html> BEFORE app.css is requested, so a
// returning user with "Dark"/"Ocean"/"Forest" picked never sees a
// flash of the default scheme on load. A classic script (no
// type="module", no async/defer) loaded as the very first thing in
// <head> — the DOM parser blocks on it and runs it in document order,
// before any <link rel="stylesheet"> below it is even requested.
//
// Deliberately NOT an ES module: a module's execution is deferred
// until after the document is parsed, which is exactly the flash this
// file exists to prevent. Kept tiny and dependency-free for the same
// reason — it can't import the shared getTheme()/setTheme() helpers
// in tracker/js/app.js (also used by settings.html once the page is
// interactive) without becoming a module itself. The localStorage key
// name ("theme") and the "no value or 'default' means the default
// scheme" rule are the one piece of shared contract between the two
// files — keep them in sync if either changes.
(function () {
  try {
    var theme = localStorage.getItem("theme");
    if (theme && theme !== "default") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (e) {
    // Storage blocked (private browsing, locked-down browser settings,
    // etc.) — fall back to the default scheme rather than throwing and
    // breaking the rest of the page.
  }
})();
