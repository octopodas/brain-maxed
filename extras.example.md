# Brain extras

Layers `brain.js index` can't discover on disk — claude.ai connectors, background
daemons, anything that isn't a file. Copy this to `extras.md` and edit it to match
your setup, then run `node brain.js index`. One line each: `- name | description`.

## apps

- Gmail | claude.ai connector — search threads, drafts, labels
- Google Calendar | claude.ai connector — events, scheduling

## routines

- nightly backup | `./backup.sh` — cron job that snapshots the workspace
