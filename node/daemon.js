import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { mplex } from '@libp2p/mplex'
import { kadDHT } from '@libp2p/kad-dht'
import { identify  } from '@libp2p/identify'
import fs from 'node:fs/promises'
import { parse } from 'yaml'
import { generate } from './inference.js'
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { mdns } from '@libp2p/mdns'

const configText = await fs.readFile(new URL('./config.yaml', import.meta.url), 'utf8')
const config = parse(configText)

const libp2p = await createLibp2p({
  transports: [webSockets(), circuitRelayTransport(), webRTC()],
  streamMuxers: [mplex()],
  connectionEncryption: [noise()],
  dht: kadDHT(),
  peerDiscovery: [mdns()],
  services: {
    identify: identify(),
    relay: circuitRelayServer()
  }
})

await libp2p.start()

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const announceKey = config.announceKey || 'ait:cap:mistral-q4'
const addr = libp2p.getMultiaddrs()[0]?.toString() || ''
await libp2p.contentRouting.put(encoder.encode(announceKey), encoder.encode(addr))
console.log(`announced ${announceKey} at ${addr}`)

let active = 0
const limit = config.maxConcurrent || 1

libp2p.handle('/ai-torrent/1/generate', async ({ stream }) => {
  if (active >= limit) {
    await stream.sink((async function* () {
      yield encoder.encode(JSON.stringify({ error: 'Too many requests' }) + '\n')
    })())
    return
  }
  active++
  try {
    let data = ''
    for await (const chunk of stream.source) {
      data += decoder.decode(chunk)
      if (data.includes('\n')) break
    }
    const req = JSON.parse(data.trim())
    const { prompt, params = {} } = req

    await stream.sink((async function* () {
      for await (const line of generate(prompt, params, config.model)) {
        yield encoder.encode(line + '\n')
      }
    })())
  } catch (err) {
    await stream.sink((async function* () {
      yield encoder.encode(JSON.stringify({ error: err.message }) + '\n')
    })())
  } finally {
    active--
  }
})

console.log('daemon running')
