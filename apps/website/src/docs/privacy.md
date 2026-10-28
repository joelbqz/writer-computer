# Privacy and telemetry

<!-- A summary of docs/telemetry.md, which is the full disclosure. Change this page when the guarantees or the off-switches there change. -->

Writer Computer keeps your notes on your Mac. There is no account and no sync service, and the text you write never leaves your computer.

Writer can send a small amount of usage data to help decide what to build next, but only if you turn it on.

## Off until you turn it on

- The first time you open Writer, a dialog asks for an email for release news, with a switch for usage data beside it. **Not now** turns both down.
- You can change either at any time in Preferences → Privacy, with **Share Usage Data** and **Email**.
- Turning usage data off takes effect immediately; nothing is queued for later.

Declining sends one event that records the choice, once, with nothing else; the dialog says so before you answer. It is how the maintainer can tell a "no" from a download that was never opened.

## What is never sent

- The contents of your notes.
- File names, folder names or any path on your disk.
- Workspace names, search queries or how many documents you have.
- Your location: the analytics service is told not to derive one from your IP address.

## What is sent when it's on

Usage data is a handful of events, such as the app opening or a file being created, each with a random ID made for this install, the app version, the OS and the processor type. There is no way for an event to carry a file name or any of your writing.

If you type an email, it is sent once each time you set, change or clear it, even with usage data off, so you can get release news without sending usage data. Clearing the field removes it.

The [telemetry disclosure](https://github.com/joelbqz/writer-computer/blob/master/docs/telemetry.md) lists every event and property and where they go.

## Other connections

- Writer checks GitHub for new releases so it can offer updates.
- An image in a note whose address is a web URL, `![](https://…)`, is loaded from that address, as in any markdown viewer.
- Links you click open in your browser.

## Turn it off for good

Any one of these is enough:

1. Leave **Share Usage Data** off. It is off by default.
2. Set `WRITER_TELEMETRY_DISABLED=1` in the environment. Writer then never sets up telemetry, whatever the settings say.
3. Build Writer from source. A build without the project key compiled in has no telemetry at all.
