# Notes for working on this repo

- The product is Better Checkout, one file: `src/better-checkout.user.js`, a Tampermonkey userscript with no build step and `@grant none`. Keep it a single self-contained file.
- Bump `@version` in the userscript header for every change pushed to `main`; installed copies only auto-update when it increases.
- Run `npm test` before committing. Tests load the script into the pages in `test/fixtures/` (Select resource, Select time, and Select time after a rejected Update) with jsdom and simulate Connect2's postback reloads by reloading the fixture with shared `localStorage`.
- Connect2 is ASP.NET WebForms: Add-to-basket buttons are positional (`resourceRpt$ctlNN$bookBtn`) and post back the whole page. Identify items by `data-id` / `resourcedetail.aspx?id=`, never by button ID.
- The script must never finish a booking or send credentials anywhere. It only clicks Connect2's own buttons in the user's logged-in tab and calls Connect2's own same-origin JSON endpoints. Date-range runs act only on the Select resource and Select time steps; the furthest they go is pressing Next into Terms & Conditions. The user accepts terms, verifies, and completes every booking.
- The repo is public. Any new fixture from the live site must be scrubbed of the student's name, `__VIEWSTATE`, `__EVENTVALIDATION`, `__RequestVerificationToken`, and the form's `hash=` before committing.
- Fixtures saved from a browser with the script installed contain an empty `<div id="c2presets-host">`; strip it.
- The step log (`log()`) and problem report must never include the student's name, the page's hidden fields (`__VIEWSTATE`, `__EVENTVALIDATION`, `__RequestVerificationToken`), or cookies. Gear names, item ids, dates and Connect2's messages are fine.
- The script is meant to be handed to classmates: user-facing text should be plain language, and new controls should be obvious without reading the README.
- Look: ink (#17181d), white, and camera-tape yellow (#ffcf33) as the only accent, with the clapperboard-slate logo and slate stripes. Everything added to Connect2's page carries the logo. Blue stays Connect2's; green/amber/red only mean available / partly available / not available. Tokens are `C` at the top of the script.
- Interface words: "Equipment Presets" (section) / "preset", "backup" (code: alternate/option), "dates" (code: ranges), and "available" / "not available" / "partly available" (never "free"). Keep the code names so stored data keeps working; keep the interface words consistent.
