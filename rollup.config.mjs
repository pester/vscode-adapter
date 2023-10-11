import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import swc from '@rollup/plugin-swc';
import terser from '@rollup/plugin-terser';
export default {
  input: 'src/extension.ts',
  output: {
    file: 'dist/extension.js',
    format: 'cjs',
    sourcemap: true,
		sourcemapExcludeSources: true
  },
  plugins: [
		// Uses the node resolution algorithm to resolve import statements in JavaScript files
		nodeResolve({
      preferBuiltins: true,
			extensions: ['.ts', '.js', '.mjs', '.cjs', '.json']
    }),
    // Compiles TypeScript faster than tsc
    swc({
      // SWC options go here
      swc: {
        sourceMaps: true,
      }
    }),
		// Converts commonjs modules to ES6 modules for purposes of tree shaking (which then get converted back to CommonJS for output)
    commonjs(),
		// Minifies code
		terser()
  ],
  external: ['vscode']
}
