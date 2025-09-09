#!/usr/bin/env node
import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { mplex } from '@libp2p/mplex'
import { kadDHT } from '@libp2p/kad-dht'
import { identify  } from '@libp2p/identify'
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { mdns } from '@libp2p/mdns'


const prompt = process.argv.slice(2).join(' ')
const params = {}

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

const bootstrapPeers = process.env.AI_TORRENT_ADDR
  ? [process.env.AI_TORRENT_ADDR]
  : ['/ip4/127.0.0.1/tcp/4513/ws']

for (const addr of bootstrapPeers) {
  try {
    await libp2p.dial(addr)
    break
  } catch (err) {
    console.error(`could not dial ${addr}`, err)
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const key = encoder.encode('ait:cap:mistral-q4')
const value = await libp2p.contentRouting.get(key)
const addr = decoder.decode(value)

const { stream } = await libp2p.dialProtocol(addr, '/ai-torrent/1/generate')

await stream.sink((async function* () {
  yield encoder.encode(JSON.stringify({ prompt, params }) + '\n')
})())

let buffer = ''
for await (const chunk of stream.source) {
  buffer += decoder.decode(chunk)
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim()) process.stdout.write(line + '\n')
  }
}

await libp2p.stop()
