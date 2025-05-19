import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

// [INFO] The following 'watch' property ensures that Rollup rebuilds when any .js, .html, or .css file changes in root, /scripts, or /sidepanel.
// This is important for development workflows where you want to auto-reload or rebuild on changes to scripts, markup, or styles.
export const watch = {
  // Globs for all relevant files to watch
  include: [
    '*.js', '*.html', '*.css',
    'scripts/**/*.js', 'scripts/**/*.html', 'scripts/**/*.css',
    'sidepanel/**/*.js', 'sidepanel/**/*.html', 'sidepanel/**/*.css'
  ]
};

export default [
  {
    input: 'sidepanel/index.js',
    output: {
      dir: 'dist/sidepanel',
      format: 'iife',
    },
    plugins: [
      commonjs(),
      nodeResolve(),
      copy({
        targets: [
          {
            // [INFO] Copy manifest, background, sidepanel, and images to dist root as before
            src: ['manifest.json', 'background.js', 'sidepanel', 'images'],
            dest: 'dist'
          },
          {
            // [INFO] Copy get-bearer-token.js to dist/scripts for Chrome extension content_scripts
            // [WARNING] If you add more scripts to manifest.json, add them here too to avoid missing file errors!
            src: 'scripts/get-bearer-token.js',
            dest: 'dist/scripts'
          }
        ]
      })
    ]
  },
  {
    input: 'scripts/extract-content.js',
    output: {
      dir: 'dist/scripts',
      format: 'es'
    },
    plugins: [
      commonjs(),
      nodeResolve(),
    ]
  }
];
