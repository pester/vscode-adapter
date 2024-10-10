import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		ignores: [
			'.vscode-test/**',
			'dist/**',
			'eslint.config.mjs',
			'vscode.d.ts',
			'vscode.proposed.d.ts',
			'.vscode-test.js',
			'*.config.js',
		],
	},
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
			parser: tseslint.parser,
			ecmaVersion: 2023,
			parserOptions: {
				// project: './tsconfig.json',
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-unsafe-member-access': 'off', //FIXME: Implement
			'@typescript-eslint/no-unsafe-assignment': 'off', //FIXME: Implement
			'@typescript-eslint/no-unsafe-argument': 'off', //FIXME: Implement
			'@typescript-eslint/no-unsafe-call': 'off', //FIXME: Implement
			'@typescript-eslint/no-misused-promises': 'off', //FIXME: Implement
			'@typescript-eslint/require-await': 'off', //FIXME: Implement
			'@typescript-eslint/no-floating-promise': 'off', //FIXME: Implement
			'@typescript-eslint/non-nullable-type-assertion-style': 'off', //FIXME: Implement
			'@typescript-eslint/no-unused-vars': 'off', //FIXME: Implement
			'@typescript-eslint/restrict-plus-operands': 'off', //FIXME: Implement
			'@typescript-eslint/no-duplicate-type-constituents': 'off', //FIXME: Implement
			'@typescript-eslint/no-floating-promises': 'off', //FIXME: Implement
			'@typescript-eslint/no-unsafe-return': 'off', //FIXME: Implement
			'@typescript-eslint/unbound-method': 'off', //FIXME: Implement
			'@typescript-eslint/restrict-template-expressions': 'off', //FIXME: Implement
			'@typescript-eslint/no-unused-expressions': 'off', //FIXME: Implement
			'@typescript-eslint/no-inferrable-types': 'off', //FIXME: Implement
			'@typescript-eslint/array-type': 'off', //FIXME: Implement
			'@typescript-eslint/no-require-imports': 'off', //FIXME: Implement
			'@typescript-eslint/consistent-type-definitions': 'off', //FIXME: Implement
			'@typescript-eslint/no-non-null-assertion': 'error', //FIXME: Implement

			// 'no-tabs': 'off',
			// indent: 'off',
			// '@typescript-eslint/indent': 'off',
			// '@typescript-eslint/space-before-function-paren': 'off',
			// '@typescript-eslint/explicit-function-return-type': 'off',
			// 'no-return-await': 'off',
			// '@typescript-eslint/return-await': 'off',
			// '@typescript-eslint/no-unused-vars': 'warn',
			// '@typescript-eslint/restrict-template-expressions': 'off'
		},
	}
)
