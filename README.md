# Better Equipment Reservation

A browser userscript for MTSU's Connect2 equipment checkout (`mtsu.getconnect2.com`). It saves the gear you reserve every week as presets, adds a whole preset to your basket in one click, checks a preset's availability for your dates, and books a preset across several shoot days.

It runs inside your own logged-in Connect2 tab and only clicks Connect2's own buttons for you. It never stores your password and never talks to anything except Connect2. It never finishes a booking for you: it stops before Terms & Conditions, and you accept the terms, verify, and complete each booking yourself.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge). In Chrome, open the extension's **Details** page and turn on **Allow User Scripts**.
2. Open the [raw script](https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/connect2-gear-presets.user.js). Tampermonkey shows an install page; click **Install**.
3. Open **Book by Category → Media Arts Equipment** in Connect2. A "Gear presets" panel appears in the bottom-right corner.

Installing from the raw link means Tampermonkey picks up new versions automatically, as long as `@version` in the script header goes up.

## Use

- **New**: name a preset, then click **+ Preset** next to each item you want. Each pick becomes a *slot*, one thing you need. Use Connect2's search box or page through the list to find items.
- **+ alt**: on a slot in the panel, adds interchangeable units to it. Click **+ Alt** on each one in the list (for example Arri Kit #3 and #4 as backups for Kit #1), in the order you'd want them, then **Done**.
- **Can't book**: items your account isn't allowed to book show this instead of **+ Preset** and can't be added. Item notes that sound like a rule ("without prior permission", "training required") show as ⚠ warnings in the preset.
- **Add all to basket**: adds one unit per slot. If you've set dates first (Availability box → **Go**), each slot uses its first unit that's free for those dates. Without dates it uses your first choice, and only falls back to an alternate if the first can't be booked or found. Every add reloads the page (that's how Connect2 works), so expect a few seconds of flicker. The summary lists any swaps and anything it couldn't add.
- **Check availability**: set **Collect** and **Return** in Connect2's Availability box, press **Go**, then press this. Each slot's units are checked in order until a free one turns up, including units not on the current page.
- **Book over shoot days**: open this section under a preset, press **+ Day** for each shoot day, and set pickup and return times. A return time at or before the pickup time means the gear comes back the next day (a night shoot). With **Merge back-to-back days** on, consecutive days become one booking, up to Connect2's 3-day maximum. The list shows the bookings that will be made, with warnings for past dates, overlaps, or bookings over the limit. **Book N bookings** then, for each booking:
  1. adds the preset to your basket, using a free unit in each slot for that booking's own dates;
  2. presses **Create booking**, fills in the pickup and return times, and presses **Update**;
  3. presses **Next** to Terms & Conditions and stops. You finish Terms, Special Requests, Verify, and Complete;
  4. back on **Book by Category → Media Arts Equipment**, the panel offers **Start booking 2 of N** (or **Redo**).

  If Connect2 rejects the times (cage closed, an item unavailable, over the limit), the script stops on that page and says why, so you can adjust and continue by hand.
- **Stop / Resume**: stops an add in progress. Items already added stay in your basket.
- **Export / Import**: presets live only in the browser you made them in. Export copies them as text you can send to your crew or move to another computer.

## How it works

Connect2 is an ASP.NET WebForms app. Every **Add to basket** button is a postback that reloads the page, and the button IDs depend on where an item sits in the current list. So presets store each item's stable resource ID (`data-id` on `.resource-availability`). A preset is a list of slots, and each slot is an ordered list of interchangeable units. Presets saved by v0.1 (one unit per entry) are converted automatically. On each page load, the script runs a small queue saved in `localStorage`. It finds the next unit on the page, searching by name (then by the first three words) if it isn't listed, clicks its Add button, and checks that the basket count went up after the reload. If a unit isn't bookable or can't be found, it moves on to the slot's next unit.

Availability uses the same JSON endpoints Connect2's own page calls (`/wizard/freetime/checkdaterangeforresource` and `/wizard/freetime/getnextresourceavailabledate`), with the date strings Connect2 writes into the page after you press Go. Requests only happen when you press a button, one at a time with a short pause, and results are cached for the same dates. For shoot-day runs, the script builds those date strings itself as MM/DD/YYYY, the format Connect2's date fields use.

A shoot-day run is a second small state machine in `localStorage`: `basket` (the add queue for that booking's dates) → `create` (pressed Create booking) → `time` (filled the Select time fields and pressed Update) → `handoff` (pressed Next to Terms, or stopped on a problem). It only ever acts on the Select resource and Select time steps.

## Develop

```sh
npm install
npm test
```

`test/run.js` loads the script into saved copies of the Select resource and Select time pages (`test/fixtures/`, with the student name and session tokens removed) and simulates Connect2's reloads. It covers picking, alternates, not-bookable items and warnings, migration from v0.1, the add queue with and without dates (availability responses are faked), the search fallback, date detection, how shoot days become bookings, and a full shoot-day run including a rejected time. It can't cover the live site, so test real changes against Connect2 with a small preset and an empty basket.

To edit while installed, either paste changes into Tampermonkey's editor, or push to `main` with a higher `@version` and use Tampermonkey's **Check for updates**.

When Connect2 changes its page, save the new page (**Save Page As → Webpage, HTML only**), scrub it the same way (student name, `__VIEWSTATE`, `__EVENTVALIDATION`, `__RequestVerificationToken`, and the form `hash=`), remove any `<div id="c2presets-host">` left behind by an installed copy of the script, and replace the fixture.

## Known limits

- Not yet run against the live site. The search fallback, the availability date format, and how Connect2 reads the filled-in times are the parts most likely to need adjusting.
- The 3-day limit is applied conservatively: a merged booking must fit in 72 hours *and* 3 calendar days. Connect2 may allow slightly longer; the limits are constants at the top of the shoot-days code.
- Each booking still needs you for Terms, Verify, and Complete, by design.
- The shoot-day schedule is one shared list, not saved per preset.
- Items you aren't allowed to book can't be added to presets. If permissions change later, the add skips them and reports it.
- Alternates are chosen by you. The script doesn't guess which units are interchangeable.
- The warning check is a word match on Connect2's item notes, so it can miss oddly worded rules or flag harmless ones.
- Built for MTSU's Media Arts category. Other categories should work, but presets warn when used outside the category they were made in.
