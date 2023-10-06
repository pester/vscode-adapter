import log, { VSCodeLogOutputChannelTransport } from "./log"
describe('vscode-e2e', () => {
	describe('log', () => {
		it('should be able to log', async () => {
			const transport = new VSCodeLogOutputChannelTransport('test')
			log.attachTransport(transport.transport)
			log.warn('test')
		})
	})
})
