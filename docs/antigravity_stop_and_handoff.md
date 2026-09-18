# Antigravity - Stop & Create Handoff

Copy toàn bộ prompt bên dưới và gửi cho Antigravity khi muốn dừng công việc để hôm sau làm tiếp.

```text
Stop here for today. Do not continue implementing the current task.

Before stopping, create or update a file named `AGENT_HANDOFF.md` in the project root so this work can be resumed accurately in a new session tomorrow.

Record:

1. Current task / task ID and original objective.
2. What has been completed.
3. What is currently in progress.
4. The exact point where you are stopping.
5. Files that were modified and what changed in each file.
6. Important technical decisions or assumptions already made.
7. Tests/checks already run and their results.
8. Current errors, warnings, blockers, or unresolved issues.
9. Remaining TODO items.
10. The exact next action that should be performed when resuming.
11. Commands that should be rerun if needed.
12. Any task IDs / ManageTask statuses that must be preserved.

Also inspect:
- git status
- git diff --stat
- relevant git diff

Use those to make the handoff accurate.

Do NOT:
- continue implementing after creating the handoff
- revert existing changes
- clean up unfinished work
- refactor unrelated code
- change task scope
- mark unfinished tasks as completed

Once `AGENT_HANDOFF.md` is written, give me a short summary and stop.
```
