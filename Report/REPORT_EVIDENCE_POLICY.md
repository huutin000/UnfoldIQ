# Report & Evidence Policy

Single source for naming, retention and cleanup of `Report/`. Complements `policy/artifact-retention-policy.json` (machine policy for project artifacts); it does not replace it.

## Layout (physical paths are stable; never move to tidy the tree)

- `Report/phases/<phase>/` final gate reports; `Report/fixes/` fix reports; `Report/hardening/`, `Report/current/` live/hardening material; `Report/archive/` superseded intermediates; `Report/evidence/` raw proof; `Report/audit/` one-off audits.
- Entry points: `Report/INDEX.md`, `Report/phases/<phase>/INDEX.md`, `Report/evidence/INDEX.md`.

## Naming

- Reports: `PHASE_<id>_<TOPIC>_REPORT.md`, `FIX_<id>_<TOPIC>_REPORT.md`. Evidence: lowercase kebab-case under the owning phase folder.
- A new fix updates the Fix History of the canonical report, or adds one file in the phase folder. No new folder per fix or retry.

## Retention classes

| Class | Meaning | Who/when/how | Lifetime |
|---|---|---|---|
| `PINNED_CANONICAL` | Gate reports, approved final media, hashes, completion gates | Owner-approved only | Never auto-expires; no TTL |
| `REQUIRED_TEST_EVIDENCE` | Read by tests, fixtures or reports | Remove only after consumers are proven gone | Until consumer removed |
| `REGENERABLE_CACHE` | Rebuildable by a documented command | Agent may propose, owner approves by exact ID | Delete freely once regeneration is confirmed |
| `HISTORICAL_ARCHIVE` | Superseded but cited history | Archive to external storage with sha256 + pointer, owner approval | Keep indefinitely or archive |
| `REVIEW_REQUIRED` | Unclassified or owner review inputs | Owner decides track / archive / delete | HOLD until decided |
| `SENSITIVE_HOLD` | May contain session, cookie, page content (e.g. `.playwright-cli/`, browser profiles) | Never read, print, back up or commit by agents | HOLD |

## Cleanup rules

1. Ignored / untracked / no-reference / duplicate-sha are signals, not permission to delete.
2. Delete only exact paths from a verified manifest, after an external backup with matching sha256. No `git clean -x`, wildcards, `rm -rf` on large dirs.
3. Git worktrees are removed with `git worktree remove <path>` (no `--force`) after unique files are backed up.
4. Moving a report/evidence file requires updating every reference and an owner decision; indexes are the preferred fix.
5. Record every cleanup in `Report/audit/<audit>/CLEANUP_EXECUTION_RESULT.md` and `CLEANUP_EXECUTED_MANIFEST.csv`.
