# setup-test

This is the test project setup-test. It checks that the replication record and its website work. The record holds the decisions, the process events, the roadmap and the plans of the project. It has no research question yet. Fadel M. Megahed will add one when the real work starts.

People: Fadel M. Megahed (Owner). The full list is in `project/roadmap.md`.

## What each folder holds

| Folder | What it holds |
|---|---|
| `plans/` | Specs, plans and ledgers. The names are `YYYY-MM-DD-<topic>-<kind>.md`. |
| `probes/` | One folder for each probe, with scripts and a README. |
| `findings/` | The findings of each probe, with the script and the output. |
| `calls/` | The budgets in `README.md` and the logs of paid calls in `<service>-calls.csv`. |
| `project/` | The roadmap, the decisions and the process events. |
| `environment/` | Session information, lock files and software versions. |

## Build the site on your computer

1. Install Node 22.
2. Open a terminal in the root folder of the repository.
3. Run `node .replication/build-site.mjs --out _site`.
4. Open `_site/index.html` in a browser.
