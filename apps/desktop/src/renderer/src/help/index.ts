/** The core Help pages (SPECS 11.2), in reading order. */
import gettingStarted from './getting-started.md?raw';
import history from './history-and-git.md?raw';
import inbox from './inbox.md?raw';
import links from './links-and-embeds.md?raw';
import markdown from './markdown-basics.md?raw';
import math from './math.md?raw';
import obsidian from './obsidian.md?raw';
import pdfs from './pdfs.md?raw';
import plugins from './plugins.md?raw';
import search from './search.md?raw';
import shortcuts from './shortcuts.md?raw';
import workspace from './workspace.md?raw';

export interface CoreHelpPage {
  id: string;
  title: string;
  markdown: string;
}

export const CORE_HELP: CoreHelpPage[] = [
  { id: 'getting-started', title: 'Getting started', markdown: gettingStarted },
  { id: 'workspace', title: 'The workspace', markdown: workspace },
  { id: 'markdown', title: 'Markdown basics', markdown },
  { id: 'links', title: 'Links and embeds', markdown: links },
  { id: 'math', title: 'Math and equation references', markdown: math },
  { id: 'pdfs', title: 'PDFs', markdown: pdfs },
  { id: 'search', title: 'Search syntax', markdown: search },
  { id: 'history', title: 'History and git', markdown: history },
  { id: 'shortcuts', title: 'Keyboard shortcuts', markdown: shortcuts },
  { id: 'plugins', title: 'Plugins', markdown: plugins },
  { id: 'inbox', title: 'Inbox contract', markdown: inbox },
  { id: 'obsidian', title: 'Using with Obsidian', markdown: obsidian },
];
