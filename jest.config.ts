import type { Config } from '@jest/types'

export default async (): Promise<Config.InitialOptions> => {
	return {
		bail: true,
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
