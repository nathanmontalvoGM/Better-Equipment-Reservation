# Better Checkout

A friendlier way to book gear on MTSU's Connect2 equipment checkout (`mtsu.getconnect2.com`).

- **See what's free for your dates** right on the equipment list, and hide everything that isn't.
- **Save the gear you use as a gear list**, with backups for items that might be taken, and add it all to your basket in one click.
- **Book several dates in a row.** Better Checkout adds the gear and fills in the times. You finish each booking.

Everything Better Checkout adds to Connect2 carries its slate logo, so you can always tell it apart from Connect2 itself.

Better Checkout works inside your own signed-in Connect2 tab and only presses Connect2's own buttons. It never sees your password, never sends anything anywhere except Connect2, and never completes a booking for you: it stops at Terms & Conditions, and you accept the terms, verify, and complete each booking yourself.

## Install

1. Install the free [Tampermonkey](https://www.tampermonkey.net/) extension for Chrome, Edge, or Firefox.
   - **Chrome only:** open `chrome://extensions`, click **Details** under Tampermonkey, and turn on **Allow User Scripts**. Without this, nothing happens.
2. Open this link: **[Install Better Checkout](https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/better-checkout.user.js)**. Tampermonkey shows an install page; click **Install**.
3. In Connect2, open **Book by Category → Media Arts Equipment**. The Better Checkout panel appears in the bottom-right corner.

Updates install themselves. To get one right away: Tampermonkey menu → **Utilities** → **Check for userscript updates**.

## Use it

1. **Pick your dates.** Press **Pick your dates** above the equipment list and set when you'll pick up and return the gear.
2. **See what's free.** Every item now says whether it's free for your dates. Turn on **Only show gear that's free** to hide the rest.
3. **Save your gear.** In the panel, press **New gear list**, then **+ Save to list** under each item you use. **Edit** → **+ Backup** adds stand-ins for an item that might be taken.
4. **Book.** Press **Book these dates**. Better Checkout adds your gear, fills in the times, and stops at Terms & Conditions for you to finish.

If someone shares a gear list with you, open their link while signed in to Connect2 and press OK.

## What each part does

### Dates

When you'll pick up and return gear. Each entry becomes one booking (Connect2 allows up to 3 days).

- **+ Add dates** adds another. **Edit** changes one; moving the pickup date moves the return date with it. **×** removes one.
- **The selected dates (●)** are what the equipment list and your gear list show availability for. Click other dates to switch.
- **Partly free gear**: when an item is free for only part of your dates, it says exactly when ("Free Wed 11/4 8 AM → Thu 11/5 12 PM") with **Use these dates**, and **Undo** if you change your mind. When your whole list would fit narrower times, the Dates section offers those too.
- **Warnings** for dates in the past, overlapping dates, a return before pickup, and bookings over 3 days.

Connect2's own **Availability** box only took whole days and contradicted Better Checkout, so it's replaced by a small box showing your dates with **Change dates**. Dates you had set there are carried over once.

### Gear list

The gear you check out every time.

- Each item shows whether it's free for your dates. If nothing in a slot is free, **Find something similar** suggests gear that is, and **Add as backup** keeps it for next time.
- Item notes that sound like rules ("without prior permission") show as ⚠ warnings.
- **Edit** shows **+ Save to list** on the equipment list, **+ Backup**, **×**, **Rename**, and **Delete list**. Gear your account can't book shows **Can't book**.
- **Book these dates** (or **Book both dates** / **Book all 3 dates**) makes one booking per date. Before adding anything it checks every date, and it stops to ask about anything that doesn't fit: use something similar, add it anyway, or leave it out. If Connect2 rejects a time, the panel shows Connect2's reasons and suggested times as buttons. When Connect2 shows **Complete**, the next booking is one click away, and after the last one the run ends by itself.
- **Add to basket only** adds one of each item for your dates without booking.

### Share and help

- **Share "…"** copies a link that adds your gear list for anyone with Better Checkout. They should be signed in to Connect2 before opening it.
- **Export lists / Import lists** move all your gear lists as text, for example to another computer.
- **Scan equipment list** pages through the whole list once, so **Find something similar** can search all of it.
- **Copy problem report**: when something goes wrong, press this and send the text to whoever gave you Better Checkout. It lists what Better Checkout did and found, and never includes your name or login.

## Good to know

- Availability is checked for your selected dates only: your gear list first, then the items on the page you're viewing. Results are kept for 30 minutes ("Checked 12 min ago. **Refresh**"), and anything older than 5 minutes is checked again before adding or booking.
- "Find something similar" matches names (brand, focal length, kind of gear), not real knowledge of gear. You always choose; nothing is swapped without you.
- Swapping an item after Connect2 rejects a booking means going Back, emptying your basket, and pressing **Redo**. Better Checkout doesn't edit your basket.
- A closure in the middle of your dates (like a lunch hour) isn't checked ahead of time; Connect2 catches it when you set the times.
- The Complete page is recognized by its title or by being the last step. If a booking run doesn't notice it, press **Copy problem report** on that page and send it in.
- Built for MTSU's Media Arts equipment. Other categories should work, and gear lists warn when used outside the category they were made in.

## For developers

```sh
npm install
npm test
```

The product is one file, [`src/better-checkout.user.js`](src/better-checkout.user.js), a Tampermonkey userscript with no build step. `test/run.js` loads it into saved, scrubbed copies of Connect2's pages (`test/fixtures/`) with jsdom, fakes Connect2's availability answers in the same shape as the real ones, and simulates Connect2's page reloads. It can't cover the live site, so try real changes on Connect2 with a small gear list and an empty basket.

How it fits together:

- **Connect2** is an ASP.NET WebForms app: every **Add to basket** is a full-page postback, and button IDs depend on an item's position. Gear lists store each item's stable resource ID (`data-id`), and adding runs as a small queue in `localStorage` that survives the reloads, searching by name when an item isn't on the current page.
- **Availability** comes from the JSON endpoints Connect2's own page uses (`/wizard/freetime/checkdaterangeforresource`), which answer per pair of dates with "collect from" / "return by" limits. Better Checkout compares those with your pickup and return times.
- **Booking runs** are a second state machine: basket → Create booking → times filled → hand-off at Terms & Conditions → Complete. They only ever act on the Select resource and Select time steps.
- **Internal names** still say `preset` and `c2presets` (storage keys, element IDs) so existing data carries over. In the interface they're gear lists.

Release: bump `@version` in the script header for every change pushed to `main`; installed copies only update when it goes up.

When Connect2 changes a page, save it (**Save Page As → Webpage, HTML only**), scrub the student's name, `__VIEWSTATE`, `__EVENTVALIDATION`, `__RequestVerificationToken`, and the form's `hash=`, remove any `<div id="c2presets-host">` left by an installed copy, and replace the fixture.
