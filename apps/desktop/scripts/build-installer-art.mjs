// Renders the Windows installer's artwork from the design system into build/:
//   installerSidebar.bmp   164 × 314  welcome and finish pages (installer and uninstaller)
//   installerHeader.bmp    150 × 57   right side of the header on the other pages
// The page uses the app's own tokens, fonts and chooser background, so the installer
// looks like the chooser. Run with Electron (no window is shown):
//   npx electron scripts/build-installer-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const design = path.resolve(here, '../../../design');
const out = path.resolve(here, '../build');
const SIDEBAR = { width: 164, height: 314 };
const HEADER = { width: 150, height: 57 };
const GAP = 16;

const url = (p) => pathToFileURL(path.join(design, p)).href;
const logo = url('assets/Logos/ephemeris-icon.svg');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${url('tokens.css')}">
<link rel="stylesheet" href="${url('components/bundle.css')}">
<style>
  html, body { margin: 0; background: transparent; }
  body { display: flex; align-items: flex-start; gap: ${GAP}px; -webkit-font-smoothing: antialiased; }
  .side { position: relative; width: ${SIDEBAR.width}px; height: ${SIDEBAR.height}px; overflow: hidden;
    display: flex; flex-direction: column; align-items: center; box-sizing: border-box; }
  .side img { margin-top: 40px; width: 76px; height: 76px; }
  .name { margin-top: 12px; font: 400 28px/1.1 var(--font-display); letter-spacing: 0.01em; color: var(--chooser-ink); }
  .orn { margin-top: 12px; display: flex; align-items: center; gap: 8px; }
  .orn i { display: block; width: 32px; height: 1px; background: var(--chooser-ornament-line); }
  .orn b { width: 6px; height: 6px; transform: rotate(45deg); background: var(--gold); }
  .tag { margin-top: 12px; font: 400 11.5px/1.45 var(--font-ui); color: var(--chooser-muted); text-align: center; }
  .band { position: absolute; left: 0; right: 0; bottom: 0; height: 42px; background: var(--chooser-band);
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font: 500 9.5px/1 var(--font-ui); color: var(--chooser-band-ink); }
  .band span { display: flex; align-items: center; gap: 5px; }
  .band b { width: 5px; height: 5px; transform: rotate(45deg); }
  .head { width: ${HEADER.width}px; height: ${HEADER.height}px; box-sizing: border-box; padding-right: 10px;
    display: flex; align-items: center; justify-content: flex-end; gap: 8px; background: #ffffff; }
  .head img { width: 30px; height: 30px; }
  .head span { font: 400 20px/1 var(--font-display); letter-spacing: 0.01em; color: var(--chooser-ink); }
</style></head><body>
  <div class="side vx-chooser-bg">
    <img src="${logo}" alt="">
    <div class="name">Ephemeris</div>
    <div class="orn"><i></i><b></b><i></i></div>
    <div class="tag">Markdown notes,<br>kept in Vaults.</div>
    <div class="band">
      <span><b style="background: var(--domain-academic-band)"></b>Academic</span>
      <span><b style="background: var(--domain-work-band)"></b>Work</span>
      <span><b style="background: var(--domain-personal-band, var(--chooser-band-ink))"></b>Personal</span>
    </div>
  </div>
  <div class="head"><img src="${logo}" alt=""><span>Ephemeris</span></div>
</body></html>`;

async function render() {
  const width = SIDEBAR.width + GAP + HEADER.width;
  const win = new BrowserWindow({
    show: false,
    width,
    height: SIDEBAR.height,
    useContentSize: true,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  // A file page, so the stylesheets and fonts load from design/ by file URL.
  const page = path.join(out, '.installer-art.html');
  fs.writeFileSync(page, html);
  try {
    await win.loadFile(page);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => document.fonts.size)');
  } finally {
    fs.rmSync(page, { force: true });
  }
  // Offscreen windows hand out frames through 'paint'; take one once painting settles.
  const frame = await new Promise((resolve) => {
    let timer = null;
    win.webContents.on('paint', (_e, _dirty, image) => {
      if (image.isEmpty()) return;
      const copy = image.crop({ x: 0, y: 0, ...image.getSize() });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => resolve(copy), 400);
    });
    win.webContents.invalidate();
  });
  win.destroy();
  const size = frame.getSize();
  if (size.width !== width || size.height !== SIDEBAR.height)
    throw new Error(`Expected ${width} × ${SIDEBAR.height} device pixels, got ${JSON.stringify(size)}`);
  return {
    sidebar: frame.crop({ x: 0, y: 0, ...SIDEBAR }),
    header: frame.crop({ x: SIDEBAR.width + GAP, y: 0, ...HEADER }),
  };
}

/** A 24-bit bottom-up BMP, the format NSIS's Modern UI loads. */
function bmp(image) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  const stride = Math.ceil((width * 3) / 4) * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[row + x * 3] = bgra[i];
      data[row + x * 3 + 1] = bgra[i + 1];
      data[row + x * 3 + 2] = bgra[i + 2];
    }
  }
  const head = Buffer.alloc(54);
  head.write('BM', 0);
  head.writeUInt32LE(54 + data.length, 2);
  head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(width, 18);
  head.writeInt32LE(height, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  head.writeUInt32LE(data.length, 34);
  head.writeInt32LE(2835, 38); // 72 dpi
  head.writeInt32LE(2835, 42);
  return Buffer.concat([head, data]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const { sidebar, header } = await render();
    fs.writeFileSync(path.join(out, 'installerSidebar.bmp'), bmp(sidebar));
    fs.writeFileSync(path.join(out, 'installerHeader.bmp'), bmp(header));
    console.log('Wrote build/installerSidebar.bmp and build/installerHeader.bmp');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
