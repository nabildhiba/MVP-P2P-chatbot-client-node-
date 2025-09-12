#!/usr/bin/env node
import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import { kadDHT } from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { bootstrap } from '@libp2p/bootstrap'
import { ping } from '@libp2p/ping'
import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { readFileSync } from 'node:fs'

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}


const params = {}
let context
let fileConfig = {}
try {
  fileConfig = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)))
} catch {}

// bootstrap for DHT discovery
const bootstrappers = [fileConfig.bootstrapAddr || process.env.BOOTSTRAP_ADDR].filter(Boolean)

const libp2p = await createLibp2p({
  transports: [webSockets()],
  streamMuxers: [mplex()],
  connectionEncrypters: [noise()],
  dht: kadDHT(),
  peerDiscovery: bootstrappers.length ? [bootstrap({ list: bootstrappers })] : [],
  services: {
    identify: identify(),
    ping: ping()
  }
})

await libp2p.start()

const rl = createInterface({ input, output })

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const key = encoder.encode('ait:cap:mistral-q4')

// Discover peers either from a static list in config or through the DHT
async function discoverProviders () {
  const peers = []

  // Add statically configured nodes
  const staticNodes = Array.isArray(fileConfig.nodes) ? fileConfig.nodes : []
  for (const addr of staticNodes) {
    peers.push({ id: addr, addr, latency: 0 })
  }

  // Discover nodes via DHT if routers are configured
  let hasContentRouters = false
  try {
    const routers = libp2p.components.contentRouters
    hasContentRouters = Array.isArray(routers) ? routers.length > 0 : routers?.size > 0
  } catch {}

  if (!hasContentRouters) {
    console.warn('No DHT routers configured, falling back to static nodes')
  } else {
    try {
      for await (const prov of libp2p.contentRouting.findProviders(key, { maxTimeout: 5000 })) {
        if (prov.multiaddrs.length === 0) continue
        let latency
        try {
          latency = await libp2p.ping(prov.id)
        } catch {
          latency = Infinity
        }
        console.log(`Tentative de connexion au pair ${prov.id.toString()} - Latence ${latency}ms`)
        peers.push({ id: prov.id.toString(), addr: prov.multiaddrs[0], latency })
      }
    } catch (err) {
      if (err.name === 'NoContentRoutersError') {
        console.warn('No DHT routers configured, falling back to static nodes')
      } else {
        console.error('Error discovering nodes via DHT:', err)
      }
    }
  }

  // Deduplicate peers by address
  const seen = new Set()
  const unique = []
  for (const p of peers) {
    const key = p.addr.toString()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(p)
  }
  unique.sort((a, b) => a.latency - b.latency)
  return unique
}

// Send a prompt to a given peer and collect the response
async function sendToPeer (peer, prompt) {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  const result = { peer, ok: false, response: '', duration: 0 }
  console.log(`Envoi de la requête au pair ${peer.id}`)
  try {
    const stream = await libp2p.dialProtocol(peer.addr, '/ai-torrent/1/generate', { signal: controller.signal })
    params.context = context
    await stream.sink((async function * () {
      yield encoder.encode(JSON.stringify({ prompt, params }) + '\n')
    })())
    let buffer = ''
    for await (const chunk of stream.source) {
      const data = chunk.subarray ? chunk.subarray() : Uint8Array.from(chunk)
      buffer += decoder.decode(data)
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        if (msg.response) result.response += msg.response
        if (msg.error) {
          console.error(`Erreur du noeud ${peer.id}:`, msg.error)
          return result
        }
        if (msg.done) {
          result.ok = true
          result.context = msg.context
        }
      }
    }
  } catch (err) {
    console.error(`Erreur durant la requête auprès du pair ${peer.id}:`, err.message)
  } finally {
    clearTimeout(timeout)
    result.duration = Date.now() - start
  }
  return result
}

// Send the prompt to all discovered peers in parallel and combine responses
async function sendPrompt (prompt) {
  const providers = await discoverProviders()
  if (!providers.length) {
    console.error('Aucun pair n\'a répondu. Réessayez plus tard.')
    return
  }

  const results = await Promise.all(providers.map(p => sendToPeer(p, prompt)))
  const successes = results.filter(r => r.ok)

  for (const r of results) {
    if (r.ok) {
      console.log(`Réponse reçue de ${r.peer.id} en ${r.duration}ms`)
    } else {
      console.log(`Aucune réponse de ${r.peer.id}`)
    }
  }

  if (!successes.length) {
    console.error('Aucun pair n\'a répondu. Réessayez plus tard.')
    return
  }

  // combine responses from all successful peers
  const combined = successes.map(r => r.response).join('\n')
  context = successes[0].context
  process.stdout.write(combined + '\n')
}

while (true) {
  const prompt = await rl.question('> ')
  const trimmed = prompt.trim().toLowerCase()
  if (trimmed === 'exit' || trimmed === 'quit') {
    context = undefined
    break
  }
  if (trimmed === 'new') {
    context = undefined
    console.log('Starting new session')
    continue
  }
  await sendPrompt(prompt)
}

await libp2p.stop()
rl.close()
