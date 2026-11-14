# Plugins

Plugins add block types (a fence such as ` ```bode `), inline marks, views on the desk, commands and settings.

## Installing

Settings > Plugins > **Install from Folder…** copies a plugin's folder (the one holding `manifest.json` and `main.js`) into the app. Plugins are installed per computer; their data lives in the library, so it travels with your notes. Turn a plugin on with its **Enable** switch. A plugin made for a newer version of the app shows "Not compatible" with the reason, and is not loaded.

Plugins are trusted code: they run inside the app with access to your notes. Install only plugins you trust.

## Using them

- A plugin's blocks appear in the suggestions after three backticks, first in the list.
- Its commands are in the command palette (`Ctrl+P`); give them shortcuts in Settings > Keyboard.
- Its settings, if it has any, are under its name in Settings > Plugins.
- Its help pages are in the **Plugins** folder of this Help, under the plugin's name. They go away when the plugin is disabled.

When a plugin block cannot render, the block shows its source with the plugin's message and a **Retry** button; the note itself is never changed by the failure.
