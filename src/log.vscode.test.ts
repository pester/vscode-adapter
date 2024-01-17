import log, { VSCodeLogOutputChannelTransport } from "./log"
describe('log', () => {
	it('should be able to log', () => {
		const transport = new VSCodeLogOutputChannelTransport('test')
		log.attachTransport(transport.transport)
		log.warn('test')
	})
})
