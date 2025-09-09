#!/usr/bin/env node
import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import { kadDHT } from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import { multiaddr } from '@multiformats/multiaddr'
import { readFileSync } from 'node:fs'

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}


const prompt = process.argv.slice(2).join(' ')
const params = {}

const bootstrappers = [process.env.BOOTSTRAP_ADDR].filter(Boolean)

const libp2p = await createLibp2p({
  transports: [webSockets()],
  streamMuxers: [mplex()],
  connectionEncrypters: [noise()],
  dht: kadDHT(),
  peerDiscovery: bootstrappers.length ? [bootstrap({ list: bootstrappers })] : [],
  services: {
    identify: identify()
  }
})

await libp2p.start()

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const key = encoder.encode('ait:cap:mistral-q4')

let addr = process.env.AI_TORRENT_ADDR
if (!addr && process.env.PORT) {
  try {
    const fileAddr = readFileSync(new URL('./daemon.addr', import.meta.url), 'utf8').trim()
    const peerId = fileAddr.split('/p2p/')[1]
    if (peerId) addr = `/ip4/127.0.0.1/tcp/${process.env.PORT}/ws/p2p/${peerId}`
  } catch {}
}
if (!addr) {
  try {
    addr = readFileSync(new URL('./daemon.addr', import.meta.url), 'utf8').trim()
  } catch (err) {
    console.warn('Failed to read daemon address file:', err)
  }
}
if (!addr) {
  try {
    const value = await libp2p.contentRouting.get(key)
    addr = decoder.decode(value)
  } catch (err) {
    console.error('Failed to resolve provider address:', err)
    process.exit(1)
  }
}

let stream
try {
  stream = await libp2p.dialProtocol(multiaddr(addr), '/ai-torrent/1/generate')
} catch (err) {
  console.error('Failed to connect to provider:', err)
  process.exit(1)
}
if (!stream) {
  console.error('No stream returned from provider')
  process.exit(1)
}

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
