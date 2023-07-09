// Borrowed with love from: https://github.com/chalk/strip-ansi-stream/tree/main because it is ES only

import stripAnsi from '@ctiterm/strip-ansi'
import { Transform } from 'stream'

export default function createStripAnsiTransform() {
	return new Transform({
		objectMode: true,
		transform(chunk: string, encoding: string, done) {
			this.push(
				stripAnsi(chunk)
			)
			done()
		}
	})
}
