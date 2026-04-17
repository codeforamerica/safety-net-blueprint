import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  platform: 'browser',
  target: ['es6'],
  logLevel: 'info',
};

// Copy ui.html to dist/
function copyUI() {
  const src = path.join(__dirname, 'src', 'ui.html');
  const dest = path.join(__dirname, 'dist', 'ui.html');
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  fs.copyFileSync(src, dest);
}

if (watch) {
  const ctx = await esbuild.context({
    ...buildOptions,
    plugins: [{
      name: 'copy-ui',
      setup(build) {
        build.onEnd(() => copyUI());
      }
    }]
  });
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  copyUI();
}
