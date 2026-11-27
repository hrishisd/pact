# 05 Easier Shortcut setup

Status: needs-triage

Spec: `../spec.md`, "Shortcut" and "Out of scope" (the iCloud link).

## Why

The human built the Pact Health Shortcut from the setup page's steps on 2026-11-26 and found it very involved. Two mistakes cost the most time: inserting the whole Health Samples list instead of Repeat Item, and typing the word "Lines" into Combine Text instead of picking the variable. The working Shortcut uploaded 275 sleep samples. Its Source token sent nothing for Oura samples, so stored sources are empty.

## What to build

- **An iCloud link to the human's Shortcut** on the setup page, as the main way to get it, with the upload URL to copy and paste when Shortcuts asks for it on import (an Import Question on Get Contents of URL's URL). The build steps stay, folded, as a fallback.
- **A clearer answer for an upload with nothing usable.** When a non-empty body yields no samples, say so and show the expected line format, e.g. "Pact got no samples. Each line should look like sleep|start|end|value|source." Today a body of unknown-type lines answers "Pact got 0 sleep samples and 0 mindful sessions."
- **Automation advice on the setup page** changed to what was worked out below.

## Notes

- An iCloud Shortcut link is a snapshot. Editing the Shortcut later doesn't change what the link gives; sharing again gives a new link, which the page would need.
- The shared Shortcut must not carry the human's upload key: the URL's Import Question default must be a placeholder.
- Share it with the mindful-minutes steps already in, so mindful pacts (ticket 04) need no new Shortcut.
- Automations, as worked out with the human: one App automation on apps opened every morning (they chose Anki and email), Is Opened or Is Closed, Run Immediately, Notify When Run off. Health can't be read while the phone is locked, iOS has no unlock trigger, and a time-of-day automation set to Run Immediately runs on a locked phone and reads nothing. A time-of-day automation set to Run After Confirmation waits as a notification until tapped.

## Comments
