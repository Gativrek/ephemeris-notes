/**
 * The sample plugin (SPECS 12.10): exercises every v1 service so the contract test
 * fails when the plugin API changes without it. Classes are prefixed with the plugin id.
 */
import type {
  BlockHost,
  BlockInfo,
  BlockView,
  Plugin,
  PluginContext,
  PluginFactory,
} from '@vaults/plugin-api';

const ID = 'sample-plugin';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = `${ID}-${cls}`;
  if (text !== undefined) e.textContent = text;
  return e;
}

const reverse = (s: string) => [...s].reverse().join('');

const HELP = `# Sample plugin

This page comes from the sample plugin through \`ctx.help.register\`.

A live block:

\`\`\`sample-reverse
help page
\`\`\`
`;

class SamplePlugin implements Plugin {
  private ctx!: PluginContext;
  /** Mounted blocks, so a theme change can reach them. */
  private readonly mounted = new Set<HTMLElement>();

  async onload(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    ctx.log.info('loading, API', ctx.apiVersion);

    // Library storage: count loads.
    const state = await ctx.storage.library.readJson<{ loads: number }>('state.json', { loads: 0 });
    await ctx.storage.library.writeJson('state.json', { loads: state.loads + 1 });

    ctx.blocks.register('sample-reverse', {
      render: (target, info, host) => this.renderReverse(target, info, host),
    });
    ctx.blocks.register('sample-throw', {
      render() {
        throw new Error('Sample failure');
      },
    });

    ctx.settings.register({
      fields: [
        {
          key: 'greeting',
          type: 'text',
          label: 'Greeting',
          default: 'Hello',
          hint: 'Shown in the sample pane.',
        },
        { key: 'shout', type: 'toggle', label: 'Shout', default: false },
      ],
      pane: (pane) => {
        const p = el('p', 'pane');
        const draw = () => {
          const g = ctx.settings.get<string>('greeting');
          p.textContent = `Sample pane: ${ctx.settings.get<boolean>('shout') ? g.toUpperCase() : g}`;
        };
        draw();
        pane.append(p);
        const sub = ctx.settings.onChange(draw);
        return () => sub.dispose();
      },
    });

    ctx.help.register([{ id: 'guide', title: 'Sample plugin guide', markdown: HELP }]);

    ctx.commands.register({
      id: 'open-overlay',
      title: 'Sample: Open Overlay',
      run: () => this.openOverlay(),
    });
    ctx.commands.register({
      id: 'notify',
      title: 'Sample: Notify',
      run: () => ctx.ui.notify(`${ctx.settings.get<string>('greeting')} from the sample plugin`),
    });
    ctx.commands.register({
      id: 'fail',
      title: 'Sample: Failing Command',
      run: () => {
        throw new Error('Sample command failure');
      },
    });

    ctx.theme.onChange((theme) => {
      for (const block of this.mounted) {
        block.dataset.theme = theme;
        const t = block.querySelector(`.${ID}-theme`);
        if (t) t.textContent = `theme: ${theme}; ink: ${ctx.theme.token('ink')}`;
      }
    });
  }

  onunload(): void {
    this.mounted.clear();
  }

  private renderReverse(target: HTMLElement, info: BlockInfo, host: BlockHost): BlockView {
    const ctx = this.ctx;
    const box = el('div', 'reverse');
    box.dataset.theme = ctx.theme.current;
    const out = el('div', 'output', reverse(info.source.trim()));
    const theme = el('div', 'theme', `theme: ${ctx.theme.current}; ink: ${ctx.theme.token('ink')}`);
    const args = el('div', 'args', JSON.stringify(info.args));
    const note = el(
      'div',
      'note',
      `${info.note.path} | ${info.note.vaultPath ?? '-'} | ${info.note.domain ?? '-'}`,
    );
    const fileLine = el('div', 'file');
    const status = el('div', 'status');
    const upper = el('button', 'upper', 'Uppercase');
    upper.type = 'button';
    upper.addEventListener('click', () => {
      void host.updateSource(info.source.toUpperCase(), { expectedVersion: info.version }).then((ok) => {
        status.textContent = ok ? 'updated' : 'refused';
      });
    });
    const save = el('button', 'save', 'Save State');
    save.type = 'button';
    save.addEventListener('click', () => {
      void (async () => {
        const vp = info.note.vaultPath;
        if (!vp) return;
        const vault = ctx.storage.vault(vp);
        await vault.writeJson('seen.json', { note: info.note.path });
        const back = await vault.readJson<{ note?: string }>('seen.json', {});
        const lib = await ctx.storage.library.readJson<{ loads?: number }>('state.json', {});
        status.textContent = `saved ${back.note ?? '?'}; loads ${lib.loads ?? 0}`;
      })();
    });
    const overlay = el('button', 'overlay', 'Open Overlay');
    overlay.type = 'button';
    overlay.addEventListener('click', () => {
      const h = host.openOverlay({
        title: 'Block overlay',
        render: (o) => {
          o.append(el('p', 'overlay-body', reverse(info.source.trim())));
        },
      });
      void h;
    });
    box.append(out, theme, args, note, fileLine, upper, save, overlay, status);
    target.append(box);
    this.mounted.add(box);

    // ctx.vault: read a file named by the info string (file="...").
    const file = info.args.named.file;
    if (file) {
      const resolved = ctx.vault.resolve(file, info.note.path) ?? file;
      void ctx.vault.readText(resolved).then(
        (text) => (fileLine.textContent = `file: ${text.split('\n').find((l) => l.trim()) ?? ''}`),
        (err: unknown) =>
          (fileLine.textContent = `file error: ${err instanceof Error ? err.message : String(err)}`),
      );
    }

    // Writing back during render is a contract violation: the host must refuse it.
    if (info.args.positional.includes('write-during-render')) {
      void host
        .updateSource('should not happen')
        .then((ok) => (status.textContent = ok ? 'accepted' : 'refused'));
    }

    return {
      update: (next) => {
        out.textContent = reverse(next.source.trim());
        info = next;
        return true;
      },
      dispose: () => {
        this.mounted.delete(box);
      },
    };
  }

  private openOverlay(): void {
    const ctx = this.ctx;
    ctx.ui.openOverlay({
      title: 'Sample overlay',
      size: 'large',
      render: (root, handle) => {
        const p = el('p', 'overlay-body', `ink: ${ctx.theme.token('ink')}`);
        const dirty = el('button', 'dirty', 'Make Dirty');
        dirty.type = 'button';
        let isDirty = false;
        dirty.addEventListener('click', () => {
          isDirty = true;
          handle.setDirty(true);
          handle.setTitle('Sample overlay (edited)');
        });
        const close = el('button', 'close', 'Done');
        close.type = 'button';
        close.addEventListener('click', () => handle.close());
        root.append(p, dirty, close);
        void isDirty;
      },
      onRequestClose: () => true,
    });
  }
}

const factory: PluginFactory = () => new SamplePlugin();
export default factory;
