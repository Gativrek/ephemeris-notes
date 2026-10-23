/** The core Help pages (SPECS 11.2), in reading order. */
import gettingStarted from './getting-started.md?raw';
import inbox from './inbox.md?raw';
import links from './links-and-embeds.md?raw';
import markdown from './markdown-basics.md?raw';
import math from './math.md?raw';
import obsidian from './obsidian.md?raw';
import search from './search.md?raw';
import shortcuts from './shortcuts.md?raw';

export interface CoreHelpPage {
  id: string;
  title: string;
  markdown: string;
}

export const CORE_HELP: CoreHelpPage[] = [
  { id: 'getting-started', title: 'Getting started', markdown: gettingStarted },
  { id: 'markdown', title: 'Markdown basics', markdown },
  { id: 'links', title: 'Links and embeds', markdown: links },
  { id: 'math', title: 'Math and equation references', markdown: math },
  { id: 'search', title: 'Search syntax', markdown: search },
  { id: 'shortcuts', title: 'Keyboard shortcuts', markdown: shortcuts },
  { id: 'inbox', title: 'Inbox contract', markdown: inbox },
  { id: 'obsidian', title: 'Using with Obsidian', markdown: obsidian },
];
