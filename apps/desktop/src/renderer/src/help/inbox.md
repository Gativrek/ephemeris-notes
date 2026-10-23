# Inbox contract

`Inbox/` at the library root is where other tools (a phone capture app, a script) add notes without ever conflicting with the app.

## Rules for other tools

- Only **create new files** in `Inbox/`.
- Never change or delete an existing file, anywhere in the library.
- Suggested name: `YYYY-MM-DD HHmmss short-title.md`.

## What the app does

- The rail's Inbox button shows how many notes are waiting.
- The app may edit, move or delete Inbox notes. Processing a note means moving it into a Vault section with **Move to…**.

## Why it works

Because outside tools only ever add new files, two devices never write the same file. Plain file sync (Syncthing, a cloud folder, git) is enough, with no merge conflicts.
