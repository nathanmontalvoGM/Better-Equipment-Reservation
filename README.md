# Better Equipment Reservation

A browser userscript for MTSU's Connect2 equipment checkout (`mtsu.getconnect2.com`). It saves the gear you reserve every week as presets, adds a whole preset to your basket in one click, checks a preset's availability for your dates, and books a preset for several date ranges in a row.

It runs inside your own logged-in Connect2 tab and only clicks Connect2's own buttons for you. It never stores your password and never talks to anything except Connect2. It never finishes a booking for you: it stops before Terms & Conditions, and you accept the terms, verify, and complete each booking yourself.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge). In Chrome, open the extension's **Details** page and turn on **Allow User Scripts**.
2. Open the [raw script](https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/connect2-gear-presets.user.js). Tampermonkey shows an install page; click **Install**.
3. Open **Book by Category → Media Arts Equipment** in Connect2. A "Gear presets" panel appears in the bottom-right corner.

Installing from the raw link means Tampermonkey picks up new versions automatically, as long as `@version` in the script header goes up.

## Use

The panel has three sections. Each opens and closes from its header, and closed sections show a one-line summary.

### Dates

The times you need gear, as a list of pickup → return windows (date and time). Each one becomes one booking when you book, and Connect2 allows up to 3 days.

- **+ Add dates** adds a window. A new one starts the day after the last return, with the same length and times. **Edit** opens its pickup and return fields; moving the pickup date moves the return date with it. **×** removes it.
- **The selected window (●)** decides what's shown as free. Click another window to switch. Every bookable item on the equipment list gets a badge: **✓ Free for your dates**, **⚠ Collect from 10:00 AM Mon 11/2** / **⚠ Return by 2:00 PM Wed 11/4** (free those days, but not for your times), or **✗ Not free for your dates**. Under the selected window, the panel sums up the page ("12 free · 1 with a time problem · 1 not free").
- **Fit times**: when the only problem is that some preset items must be collected later or returned earlier, this button narrows the window to times that fit them all.
- **Warnings**: past dates, overlapping windows, a return before pickup (this one blocks booking), and windows over 3 days.

Connect2's own Availability box still works as a fallback when you have no dates here, but it only checks whole days and reloads the page.

### Preset

The gear you book every week. Pick a preset from the dropdown, or choose **+ New preset…**.

- **Each item** shows whether it's free for the selected dates. Items with nothing free then get **Find a replacement**, which suggests similar items (see Replacements below). Picking one adds it as a backup.
- **Item notes** that sound like a rule ("without prior permission", "training required") show as ⚠ warnings.
- **Edit** shows the controls: **+ Preset** on each item in the equipment list, **+ alt** to add backup units for an item (for example Arri Kit #3 and #4 for Kit #1, clicked in the list in the order you'd want them), **×** to remove, and **Rename** / **Delete preset**. Items your account can't book show **Can't book** and can't be added. **Done** hides the controls.
- **Book N date ranges** makes one booking per date window, in pickup order. Before adding anything, every window is checked with real times, and the confirmation lists any problems. Then, for each window, the script:
  1. adds the preset to your basket, using a unit that's free in each slot for that window;
  2. presses **Create booking**, fills in the pickup and return times, and presses **Update**;
  3. presses **Next** to Terms & Conditions and stops. You finish Terms, Special Requests, Verify, and Complete.

  Back on **Book by Category → Media Arts Equipment**, the panel offers **Start booking 2 of N** (or **Redo**). If an item doesn't fit a window when its turn comes, the run stops before adding anything and asks, item by item: **Use** a replacement that's free then, **Add it anyway**, or **Leave it out**. If Connect2 still rejects a time on Select time, the run stops there and shows Connect2's reasons item by item (outside cage hours, booked by someone else), including the ones Connect2 hides behind "Show more". Connect2's suggested times appear as buttons: pick one and the run continues to Next.
- **or just add to basket** (or **Add to basket** when you have no dates) adds one unit per item for the selected dates without booking. Every add reloads the page, so expect a few seconds of flicker. The summary lists any swaps and anything it couldn't add. **Stop** cancels; items already added stay in your basket.

### More

- **Scan equipment list** pages through the whole list once, the same as clicking Next through it, so replacement suggestions can come from all of it. The script also remembers every list page you open.
- **Export presets / Import**: presets live only in the browser you made them in. Export copies them as text you can send to your crew or move to another computer.

### Replacements

When nothing in a slot is free, **Find a replacement** looks for similar items: same Connect2 category, and shared brand, focal length, aperture, or kind of gear ("lens", "light"…), ignoring shelf codes like "A3-A6". The 8 most similar are checked against the window's actual times, and up to 3 that fit are offered. The search is offered in the preset, before a run adds anything, and on a Select time page where Connect2 says an item is booked by someone else. In that last case, to use the replacement for that booking, press Back, empty your basket, and press **Redo**.

## How it works

Connect2 is an ASP.NET WebForms app. Every **Add to basket** button is a postback that reloads the page, and the button IDs depend on where an item sits in the current list. So presets store each item's stable resource ID (`data-id` on `.resource-availability`). A preset is a list of slots, and each slot is an ordered list of interchangeable units. Presets saved by v0.1 (one unit per entry) are converted automatically. On each page load, the script runs a small queue saved in `localStorage`. It finds the next unit on the page, searching by name (then by the first three words) if it isn't listed, clicks its Add button, and checks that the basket count went up after the reload. If a unit isn't bookable or can't be found, it moves on to the slot's next unit.

Availability uses the same JSON endpoints Connect2's own page calls (`/wizard/freetime/checkdaterangeforresource` and `/wizard/freetime/getnextresourceavailabledate`), with the date strings Connect2 writes into the page after you press Go. Requests only happen when you press a button, one at a time with a short pause, and results are cached for the same dates. For date-range runs, the script builds those date strings itself as MM/DD/YYYY, the format Connect2's date fields use. A range check comes back like `{ "TypeName": "success", "Title": "Available", "List": ["Collect from: 8:00 AM", "Monday, 26 Oct 2026", "Return by: 4:30 PM", "Wednesday, 28 Oct 2026"] }`, and the script compares those limits with the booking's pickup and return times. Units are then ranked: fits, partly free, couldn't check, wrong times, not free.

A date-range run is a second small state machine in `localStorage`: `basket` (the add queue for that booking's dates) → `create` (pressed Create booking) → `time` (filled the Select time fields and pressed Update) → `handoff` (pressed Next to Terms, or stopped on a problem). It only ever acts on the Select resource and Select time steps.

## Develop

```sh
npm install
npm test
```

`test/run.js` loads the script into saved copies of the Select resource and Select time pages, plus a Select time page showing a rejected time (`test/fixtures/`, with the student name and session tokens removed) and simulates Connect2's reloads. It covers picking, alternates, not-bookable items and warnings, migration from v0.1, the add queue with and without dates (availability responses are faked), the search fallback, date detection, editing date windows and their warnings, migrations from v0.3 shoot days and v0.7 check dates, availability badges on the list and the preset for the selected window, fitting times to collect-from / return-by limits, ranking alternates by time fit, a full multi-booking run, recovering from a rejected time with Connect2's suggestions, the catalog and list scan, similarity ranking, picking replacements in the preset, during a run, and after a rejection, collapsible sections and edit mode, and the button layout on the list. The fake availability responses copy the real ones' shape. It can't cover the live site, so test real changes against Connect2 with a small preset and an empty basket.

To edit while installed, either paste changes into Tampermonkey's editor, or push to `main` with a higher `@version` and use Tampermonkey's **Check for updates**.

When Connect2 changes its page, save the new page (**Save Page As → Webpage, HTML only**), scrub it the same way (student name, `__VIEWSTATE`, `__EVENTVALIDATION`, `__RequestVerificationToken`, and the form `hash=`), remove any `<div id="c2presets-host">` left behind by an installed copy of the script, and replace the fixture.

## Known limits

- Confirmed on the live site: adding a preset, Create booking, filling in the times, and the range-check response format. Not yet confirmed: picking a suggested time, and Connect2's wording for clash types other than cage hours and other bookings (unknown wordings are shown as Connect2 writes them).
- Availability is checked automatically for the selected window: the preset's items first, then the items on the page you're looking at (15 at a time, one request each, with a short pause between them). Results are kept until you reload, so switching back to a window you've already checked is instant. Nothing is checked while the script is adding, booking, or scanning.
- "Similar" is a name match, not knowledge of gear. It can suggest a camera kit that includes the right lens ("Canon 70D with 18-135mm Lens") as a lens replacement, or miss a good substitute with a very different name. You always choose; nothing is swapped automatically.
- Replacement search only knows the items the script has seen. Run **Scan equipment list** again after the cage adds gear.
- After a rejected time, swapping an item needs an empty basket and a redo; the script doesn't edit the basket.
- The range check only reports the collect-from time on the pickup day and the return-by time on the return day. A closure in the middle of a range (say, a lunch hour on the pickup day after the pickup time) isn't checked; Connect2 catches it at Select time.
- The 3-day warning is conservative: a range must fit in 72 hours *and* 3 calendar days. Connect2 may allow slightly longer; the limits are constants at the top of the date-ranges code, and a range over them is only warned about, not blocked.
- Each booking still needs you for Terms, Verify, and Complete, by design.
- The dates are one shared list, not saved per preset.
- Items you aren't allowed to book can't be added to presets. If permissions change later, the add skips them and reports it.
- Alternates are chosen by you. The script doesn't guess which units are interchangeable.
- The warning check is a word match on Connect2's item notes, so it can miss oddly worded rules or flag harmless ones.
- Built for MTSU's Media Arts category. Other categories should work, but presets warn when used outside the category they were made in.
