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
import { ConnectionFailedError } from '@libp2p/interface'
import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'node:process'

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}


const args = process.argv.slice(2)
const discoverIndex = args.indexOf('--discover')
const discover = discoverIndex !== -1
if (discover) args.splice(discoverIndex, 1)
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

const rl = createInterface({ input, output })

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const key = encoder.encode('ait:cap:mistral-q4')

let addr
if (!discover) addr = process.env.AI_TORRENT_ADDR
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

async function sendPrompt (prompt) {
  let stream
  try {
    console.log(`Connecting to provider at ${addr}`)
    stream = await libp2p.dialProtocol(multiaddr(addr), '/ai-torrent/1/generate')
  } catch (err) {
    if (err instanceof ConnectionFailedError) {
      const msg = err.cause?.message ?? err.message
      console.error(`Failed to connect to provider at ${addr}: ${msg}`)
      console.error('Hint: AI_TORRENT_ADDR may be outdated or the daemon may not be running.')
    } else {
      console.error(`Failed to connect to provider at ${addr}:`, err)
      console.error('Hint: AI_TORRENT_ADDR may be outdated or the daemon may not be running.')
    }
    return
  }
  if (!stream) {
    console.error('No stream returned from provider')
    return
  }

  await stream.sink((async function * () {
    yield encoder.encode(JSON.stringify({ prompt, params }) + '\n')
  })())

  let buffer = ''
  outer: for await (const chunk of stream.source) {
    const data = chunk.subarray ? chunk.subarray() : Uint8Array.from(chunk)
    buffer += decoder.decode(data)
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      process.stdout.write(msg.response || '')
      if (msg.error) {
        console.error(msg.error)
        break outer
      }
      if (msg.done) {
        process.stdout.write('\n')
        break outer
      }
    }
  }
}

while (true) {
  const prompt = await rl.question('> ')
  const trimmed = prompt.trim().toLowerCase()
  if (trimmed === 'exit' || trimmed === 'quit') break
  await sendPrompt(prompt)
}

await libp2p.stop()
rl.close()
