# Notes for working on this repo

- The product is one file: `src/connect2-gear-presets.user.js`, a Tampermonkey userscript with no build step and `@grant none`. Keep it a single self-contained file.
- Bump `@version` in the userscript header for every change pushed to `main`; installed copies only auto-update when it increases.
- Run `npm test` before committing. Tests load the script into `test/fixtures/select-resource.html` with jsdom and simulate Connect2's postback reloads by reloading the fixture with shared `localStorage`.
- Connect2 is ASP.NET WebForms: Add-to-basket buttons are positional (`resourceRpt$ctlNN$bookBtn`) and post back the whole page. Identify items by `data-id` / `resourcedetail.aspx?id=`, never by button ID.
- The script must never finish a booking or send credentials anywhere. It only clicks Connect2's own buttons in the user's logged-in tab and calls Connect2's own same-origin JSON endpoints. Date-range runs act only on the Select resource and Select time steps; the furthest they go is pressing Next into Terms & Conditions. The user accepts terms, verifies, and completes every booking.
- The repo is public. Any new fixture from the live site must be scrubbed of the student's name, `__VIEWSTATE`, `__EVENTVALIDATION`, `__RequestVerificationToken`, and the form's `hash=` before committing.
- Fixtures saved from a browser with the script installed contain an empty `<div id="c2presets-host">`; strip it.
