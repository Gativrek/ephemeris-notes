/**
 * Regenerates the committed fixture library (SPECS 17) byte for byte.
 * Run: node apps/desktop/test/make-fixtures.ts
 *
 * The output is test data: line endings, BOMs and odd whitespace are deliberate.
 * `.gitattributes` marks the folder `-text` so git never converts it.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/library');

function put(rel: string, data: string | Uint8Array): void {
  const file = join(root, ...rel.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

const lf = (lines: string[]) => lines.join('\n') + '\n';
const crlf = (lines: string[]) => lines.join('\r\n') + '\r\n';

// ---- binary helpers ------------------------------------------------------

function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A small valid PDF with one line of text per page. */
function pdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const fontId = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    const pageId = 3 + i * 2;
    const content = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const vaultJson = (v: Record<string, unknown>) => JSON.stringify({ schema: 1, ...v }, null, 2) + '\n';

// ---- the library ---------------------------------------------------------

rmSync(root, { recursive: true, force: true });

put(
  '.vaults/library.json',
  JSON.stringify(
    { schema: 1, id: '3f2b8c1e-4d5a-4e6f-9a7b-1c2d3e4f5a6b', created: '2026-10-01T09:00:00.000Z' },
    null,
    2,
  ) + '\n',
);
put('.gitignore', lf(['.vaults/*.tmp', '**/.*.vx-tmp-*', '.obsidian/workspace*.json', '.trash/']));

put('Inbox/2026-10-20 081500 idea.md', lf(['Idea from the phone: try an adaptive R in the GNSS filter.']));
put('Inbox/2026-10-21 223010 reading.md', lf(['# Reading list', '', '- Groves, chapter 14']));

// Content outside Domains: indexed and linkable, not in the sidebar.
put(
  'Archive/Old Obsidian note.md',
  lf(['# Old Obsidian note', '', 'Moved here before sorting. See [[Kalman Filter]].']),
);

// ---- Academic / Knowledge (concept notes) --------------------------------
put(
  'Academic/Knowledge/.vault/vault.json',
  vaultJson({
    id: '0a1b2c3d-0000-4000-8000-000000000001',
    name: 'Knowledge',
    created: '2026-10-01T09:05:00.000Z',
    order: 1,
    settings: { attachments: '_attachments', templates: '_templates', daily: 'Daily' },
  }),
);
put(
  'Academic/Knowledge/Concepts/Kalman Filter.md',
  lf([
    '---',
    'title: Kalman Filter',
    'tags: [estimation, filtering]',
    'aliases: [KF]',
    '---',
    '# Kalman Filter',
    '',
    'The filter alternates a prediction and a measurement update. See also [[RTK vs PPP]] and #estimation.',
    '',
    '## Prediction',
    '',
    '$$',
    '\\hat{x}_{k|k-1} = F \\hat{x}_{k-1|k-1}',
    '$$ {#eq:kf-predict}',
    '',
    '$$ P_{k|k-1} = F P_{k-1|k-1} F^\\top + Q $$',
    '',
    '## Gain and update',
    '',
    'The gain in @eq:kf-gain weighs the innovation; the state update is @eq:kf-update.',
    '',
    '$$ K_k = P_{k|k-1} H^\\top (H P_{k|k-1} H^\\top + R)^{-1} $$ {#eq:kf-gain}',
    '',
    '$$ \\hat{x}_{k|k} = \\hat{x}_{k|k-1} + K_k (z_k - H \\hat{x}_{k|k-1}) $$ {#eq:kf-update}',
    '',
    'Costs $5 and $10 are not math. Inline math: $z = Hx + v$. ^kf-summary',
    '',
    '```matlab kf_update.m',
    "K = (P*H') / (H*P*H' + R);",
    'x = x + K*(z - H*x);  % update',
    '```',
  ]),
);
put(
  'Academic/Knowledge/Concepts/RTK vs PPP.md',
  lf([
    '# RTK vs PPP',
    '',
    'Both reach centimetres; RTK needs a base station. Filtering uses a [[Kalman Filter|KF]].',
  ]),
);
put(
  'Academic/Knowledge/Concepts/RRT.md',
  lf(['# RRT', '', 'Rapidly-exploring random trees. #planning/sampling']),
);
put(
  'Academic/Knowledge/Concepts/Index.md',
  lf(['# Index', '', '- [[Kalman Filter]]', '- [[RTK vs PPP]]', '- [[RRT]]']),
);
put(
  'Academic/Knowledge/Navegação.md',
  lf(['# Navegação inercial', '', 'Notas em português: navegação, estimação, integração.']),
);

// ---- Academic / GNSS Study (a full Vault) --------------------------------
put(
  'Academic/GNSS Study/.vault/vault.json',
  vaultJson({
    id: '0a1b2c3d-0000-4000-8000-000000000002',
    name: 'GNSS Constellation Study',
    created: '2026-10-02T10:00:00.000Z',
    order: 2,
    cover: { file: 'cover.png', focus: { x: 0.5, y: 0.35 }, zoom: 1.0 },
    settings: { attachments: '_attachments', templates: '_templates', daily: 'Daily' },
  }),
);
put(
  'Academic/GNSS Study/.vault/cover.png',
  png(120, 228, (x, y) => [150 + Math.round((y / 228) * 60), 165 + Math.round((x / 120) * 30), 185]),
);
put(
  'Academic/GNSS Study/Notes/Intro.md',
  lf([
    '# Intro',
    '',
    'Start with the [[Kalman Filter]] and the local [[Index]] (ambiguous on purpose).',
    'A link to a note that does not exist: [[Missing Note]].',
    'Read [[paper.pdf#page=2]] and embed the figure: ![[diagram.png|300]]',
    'Heading link: [[Kalman Filter#Gain and update]]. Block link: [[Kalman Filter#^kf-summary]].',
    '',
    '<div>Raw HTML stays text.</div>',
  ]),
);
put(
  'Academic/GNSS Study/Notes/Index.md',
  lf(['# GNSS Index', '', '- [[Intro]]', '- [[Lecture 2]]', '- [[Lecture 10]]']),
);
put('Academic/GNSS Study/Notes/Lectures/Lecture 2.md', lf(['# Lecture 2', '', 'Pseudoranges.']));
put('Academic/GNSS Study/Notes/Lectures/Lecture 10.md', lf(['# Lecture 10', '', 'Carrier phase.']));
put(
  'Academic/GNSS Study/Notes/Lectures/Deep/Deeper/Third level.md',
  lf(['# Third level', '', 'Shown flattened in the tree.']),
);
put(
  'Academic/GNSS Study/Papers/paper.pdf',
  pdf(['Page 1: GNSS overview', 'Page 2: Error budget', 'Page 3: Conclusions']),
);
put(
  'Academic/GNSS Study/Data/run3.csv',
  lf(['t,roll,pitch,yaw', '0,0.1,0.0,1.5', '0.1,0.2,0.1,1.4', '0.2,0.25,0.15,1.35']),
);
put('Academic/GNSS Study/Daily/2026-10-20.md', lf(['# 2026-10-20', '', 'Read about multipath.']));
put(
  'Academic/GNSS Study/_attachments/diagram.png',
  png(16, 16, (x, y) => ((x + y) % 2 ? [60, 94, 146] : [230, 233, 237])),
);
put('Academic/GNSS Study/_templates/Daily.md', lf(['# {{date}}', '', 'Vault: {{vault}} ({{domain}})']));
put(
  'Academic/GNSS Study/Loose note.md',
  lf(['# Loose note', '', 'Lives at the Vault root, so it shows under Unfiled.']),
);
put('Academic/GNSS Study/.hidden-note.md', lf(['Hidden files never show.']));

// Encoding and whitespace cases (SPECS 17 round-trip).
put('Academic/GNSS Study/Encoding/LF.md', lf(['# LF', '', 'Plain LF file.']));
put('Academic/GNSS Study/Encoding/CRLF.md', crlf(['# CRLF', '', 'Windows line endings.']));
put(
  'Academic/GNSS Study/Encoding/BOM.md',
  Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(crlf(['# BOM', '', 'UTF-8 with BOM and CRLF.']), 'utf8'),
  ]),
);
put(
  'Academic/GNSS Study/Encoding/No trailing newline.md',
  '# No trailing newline\n\nThe last line has no newline.',
);
put(
  'Academic/GNSS Study/Encoding/Odd whitespace.md',
  '# Odd whitespace\n\n\tTabbed line   \n Non-breaking space\n\n\n\nTrailing spaces  \n   \n',
);
put(
  'Academic/GNSS Study/Encoding/Invalid YAML.md',
  lf([
    '---',
    'title: [unclosed',
    'tags: : :',
    '---',
    '# Invalid YAML',
    '',
    'The frontmatter is broken and must never be rewritten.',
  ]),
);
put('Academic/GNSS Study/Encoding/Mixed EOL.md', '# Mixed EOL\r\n\nLF line\r\nCRLF line\n');
put(
  'Academic/GNSS Study/Encoding/Latin1.md',
  Buffer.from('# Latin-1\n\nCaf\xe9 au lait, na\xefve.\n', 'latin1'),
);
put('Academic/GNSS Study/Encoding/Empty.md', '');

// A folder in a Domain without .vault/vault.json is not a Vault.
put('Academic/Old Course/notes.md', lf(['# Old course notes', '', 'Not a Vault yet.']));

// ---- Work / Acme Robotics --------------------------------------------------
put(
  'Work/Acme Robotics/.vault/vault.json',
  vaultJson({
    id: '0a1b2c3d-0000-4000-8000-000000000003',
    name: 'Acme Robotics',
    created: '2026-10-03T08:30:00.000Z',
    order: 1,
    'x-custom': { keep: 'unknown keys survive writes' },
    settings: { attachments: '_attachments', templates: '_templates', daily: 'Daily' },
  }),
);
put(
  'Work/Acme Robotics/Meetings/2026-10-01 Kickoff.md',
  lf(['# Kickoff', '', 'Owner: navigation team. Next: [[Navigation]].']),
);
put(
  'Work/Acme Robotics/Specs/Navigation.md',
  lf([
    '# Navigation',
    '',
    'Fusion uses the shared concept note [[Academic/Knowledge/Concepts/Kalman Filter]].',
    'Ambiguous on purpose: [[Index]].',
  ]),
);
put('Work/Acme Robotics/Specs/Index.md', lf(['# Specs Index', '', '- [[Navigation]]']));

// ---- Personal: no Vaults (empty Domain state) ------------------------------
put('Personal/.gitkeep', '');

console.log(`Fixture library written to ${root}`);
