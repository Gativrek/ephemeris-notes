// Renders the design system's app icon into build/icon.ico and build/icon.png for the
// Windows executable and installer. Run with Electron (no window is shown):
//   npx electron scripts/build-icons.mjs
// 16-32 px use ephemeris-icon-small.svg, 48 px and up ephemeris-icon.svg (design/README,
// "Name and icon").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, nativeImage } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const logos = path.resolve(here, '../../../design/assets/Logos');
const out = path.resolve(here, '../build');
const SIZE = 512;

/** One offscreen page showing both SVGs side by side; each is captured from it. */
async function renderBoth() {
  const win = new BrowserWindow({
    show: false,
    width: SIZE * 2,
    height: SIZE,
    useContentSize: true,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
    // Exact pixels: one CSS pixel per device pixel.
    zoomFactor: 1,
  });
  const img = (f) =>
    `<img src="data:image/svg+xml;base64,${fs.readFileSync(path.join(logos, f)).toString('base64')}" width="${SIZE}" height="${SIZE}">`;
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden;display:flex">${img('ephemeris-icon-small.svg')}${img('ephemeris-icon.svg')}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(async () => {
    // Some Electron builds refuse data: pages; a temporary file works everywhere.
    const page = path.join(out, '.render.html');
    fs.writeFileSync(page, html);
    try {
      await win.loadFile(page);
    } finally {
      fs.rmSync(page, { force: true });
    }
  });
  // Offscreen windows hand out their frames through 'paint'; take one after the images load.
  const frame = await new Promise((resolve) => {
    let timer = null;
    win.webContents.on('paint', (_e, _dirty, image) => {
      // The frame is only valid inside this callback: copy it out.
      if (image.isEmpty()) return;
      const copy = nativeImage.createFromBuffer(image.toPNG());
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => resolve(copy), 400);
    });
    win.webContents.invalidate();
  });
  win.destroy();
  const size = frame.getSize();
  if (size.width < SIZE * 2) throw new Error('Unexpected frame size ' + JSON.stringify(size));
  const small = frame.crop({ x: 0, y: 0, width: SIZE, height: SIZE });
  const large = frame.crop({ x: SIZE, y: 0, width: SIZE, height: SIZE });
  return { small, large };
}

/** An .ico holding PNG images (Windows Vista and later read these directly). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    const { small, large } = await renderBoth();
    if (small.isEmpty() || large.isEmpty()) throw new Error('The icon rendered empty.');
    const at = (img, size) => img.resize({ width: size, height: size, quality: 'best' }).toPNG();
    const pngs = [
      ...[16, 24, 32].map((size) => ({ size, data: at(small, size) })),
      ...[48, 64, 128, 256].map((size) => ({ size, data: at(large, size) })),
    ];
    fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));
    fs.writeFileSync(path.join(out, 'icon.png'), at(large, SIZE));
    console.log(
      `wrote build/icon.ico (${pngs.map((p) => p.size).join(', ')} px) and build/icon.png (${SIZE} px)`,
    );
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
