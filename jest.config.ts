import { type Config } from '@jest/types'


export default async (): Promise<Config.InitialOptions> => {
	return {
		bail: 1,
		forceExit: true,
		modulePathIgnorePatterns: ['dist', '.vscode-test'],
		transform: {
			'^.+\\.tsx?$': [
				'esbuild-jest',
				{
					sourcemap: true,
					loaders: {
						'.spec.ts': 'tsx',
						'.test.ts': 'tsx'
					}
				}
			]
		}
	}
}
