import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import { kadDHT } from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import fsp from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { generate } from './inference.js'

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

const configText = await fsp.readFile(new URL('./config.yaml', import.meta.url), 'utf8')
const config = parse(configText)

const bootstrappers = [process.env.BOOTSTRAP_ADDR].filter(Boolean)
const port = process.env.PORT || 0

const libp2p = await createLibp2p({
  addresses: {
    listen: [`/ip4/0.0.0.0/tcp/${port}/ws`]
  },
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

libp2p.addEventListener('peer:connect', e => {
  console.log('peer connected:', e.detail.remotePeer.toString())
})
libp2p.addEventListener('peer:disconnect', e => {
  console.log('peer disconnected:', e.detail.remotePeer.toString())
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const announceKey = config.announceKey || 'ait:cap:mistral-q4'
const addr = libp2p.getMultiaddrs()[0]?.toString() || ''

console.log(`listening on ${addr}`)
try {
  writeFileSync(new URL('../client/daemon.addr', import.meta.url), addr)
} catch (err) {
  console.warn('Failed to write address file:', err)
}
try {
  await libp2p.contentRouting.put(encoder.encode(announceKey), encoder.encode(addr))
  console.log(`announced ${announceKey} at ${addr}`)
} catch (err) {
  console.warn('Failed to announce address:', err)
}

let active = 0
const limit = config.maxConcurrent || 1

libp2p.handle('/ai-torrent/1/generate', async ({ stream, connection }) => {
  console.log('incoming generate request from', connection.remotePeer.toString())
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
