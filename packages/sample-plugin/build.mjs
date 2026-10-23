// Builds the plugin folder `dist/` (manifest.json, main.js, styles.css) with the
// TypeScript compiler's transpiler: one file, type-only imports, no bundler needed.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../package.json'));
const ts = require('typescript');

const out = join(here, 'dist');
mkdirSync(out, { recursive: true });
const source = readFileSync(join(here, 'src/main.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    verbatimModuleSyntax: true,
  },
  fileName: 'main.ts',
});
writeFileSync(join(out, 'main.js'), outputText);
copyFileSync(join(here, 'manifest.json'), join(out, 'manifest.json'));
copyFileSync(join(here, 'styles.css'), join(out, 'styles.css'));
console.log(`sample-plugin built to ${out}`);
