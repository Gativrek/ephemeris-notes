# History and git

When the library folder is a git repository, the app can commit your changes for you and show any note's past versions. It uses the git installed on this computer and never pushes, pulls or rewrites history. To start, run `git init` in the library folder.

## Committing automatically

Settings > Library > **Commit to git automatically** commits every change on an interval you pick (**Every** 5 minutes to 2 hours). **Commit Now** commits right away. The last attempt's result shows beside it: committed, nothing to commit, skipped (git was busy, for example in the middle of a merge) or failed with git's message. Failures never interrupt your writing. Commits made by hand count just the same.

## A note's history

**Show Note History** (command palette, or **Show History** on a note's desk card and tree row) opens "History: *note*" on the desk, beside the note.

- **Versions**, newest first: when, the commit's message, and lines added and removed. **Not committed yet** comes first when the note has changed since its last commit.
- **Compared with now** shows what restoring the selected version would change; **Changes in this version** shows what that commit changed. Added and removed lines are marked + and −, with changed words marked within them. Unchanged stretches are folded; click one to open it.
- **Restore This Version** asks first, then writes that version as the note's text: one edit you can undo with `Ctrl+Z` in the note. Git is not touched; the restore is committed later like any edit.

History follows a note across renames and moves made in the app.
