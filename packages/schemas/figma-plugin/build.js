const esbuild = require('esbuild');
const fs = require('fs');

const watch = process.argv.includes('--watch');

// Build the plugin code
async function build() {
  // Ensure dist directory exists
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
  }

  const buildOptions = {
    entryPoints: ['src/code.ts'],
    bundle: true,
    outfile: 'dist/code.js',
    target: 'es2017',
  };

  if (watch) {
    // Use context API for watch mode
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }

  // Copy the UI HTML file
  fs.copyFileSync('src/ui.html', 'dist/ui.html');

  console.log('Build complete');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
