# Better Equipment Reservation

A browser userscript for MTSU's Connect2 equipment checkout (`mtsu.getconnect2.com`). It saves the gear you reserve every week as presets, adds a whole preset to your basket in one click, and checks a preset's availability for your dates.

It runs inside your own logged-in Connect2 tab and only clicks Connect2's own buttons for you. It never stores your password, never talks to anything except Connect2, and never submits a booking: you still set dates and press **Create booking** yourself.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge). In Chrome, open the extension's **Details** page and turn on **Allow User Scripts**.
2. Open the [raw script](https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/connect2-gear-presets.user.js). Tampermonkey shows an install page; click **Install**.
3. Open **Book by Category → Media Arts Equipment** in Connect2. A "Gear presets" panel appears in the bottom-right corner.

Installing from the raw link means Tampermonkey picks up new versions automatically, as long as `@version` in the script header goes up.

## Use

- **New**: name a preset, then click **+ Preset** next to each item you want. Use Connect2's search box or page through the list to find items.
- **Add all to basket**: adds each item in turn. Every add reloads the page (that's how Connect2 works), so expect a few seconds of flicker. When it finishes, it lists anything it couldn't add and why.
- **Check availability**: set **Collect** and **Return** in Connect2's Availability box, press **Go**, then press this. Every preset item is checked against those dates, including items not on the current page.
- **Stop / Resume**: stops an add in progress. Items already added stay in your basket.
- **Export / Import**: presets live only in the browser you made them in. Export copies them as text you can send to your crew or move to another computer.

## How it works

Connect2 is an ASP.NET WebForms app. Every **Add to basket** button is a postback that reloads the page, and the button IDs depend on where an item sits in the current list. So presets store each item's stable resource ID (`data-id` on `.resource-availability`). On each page load, the script runs a small queue saved in `localStorage`. It finds the next item on the page, searching by name (then by the first three words) if it isn't listed, clicks its Add button, and checks that the basket count went up after the reload.

Availability uses the same JSON endpoints Connect2's own page calls (`/wizard/freetime/checkdaterangeforresource` and `/wizard/freetime/getnextresourceavailabledate`), with the date strings Connect2 writes into the page after you press Go.

## Develop

```sh
npm install
npm test
```

`test/run.js` loads the script into a saved copy of the Select resource page (`test/fixtures/select-resource.html`, with the student name and session tokens removed) and simulates Connect2's reloads. It covers picking, the add queue, the search fallback, and date detection. It can't cover the live site, so test real changes against Connect2 with a small preset and an empty basket.

To edit while installed, either paste changes into Tampermonkey's editor, or push to `main` with a higher `@version` and use Tampermonkey's **Check for updates**.

When Connect2 changes its page, save the new page (**Save Page As → Webpage, HTML only**), scrub it the same way (student name, `__VIEWSTATE`, `__EVENTVALIDATION`, `__RequestVerificationToken`, and the form `hash=`), and replace the fixture.

## Known limits

- Not yet run against the live site. The search fallback and the availability date format are the parts most likely to need adjusting.
- Items you aren't allowed to book are skipped and reported, not added.
- Built for MTSU's Media Arts category. Other categories should work, but presets warn when used outside the category they were made in.
