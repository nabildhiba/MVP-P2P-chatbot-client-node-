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
import Web3 from 'web3'

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
const web3 = new Web3(fileConfig.rpcUrl || process.env.WEB3_RPC_URL || '')
const wallet = web3.eth.accounts.wallet.add(fileConfig.privateKey || process.env.PRIVATE_KEY || '')
const tokenAbi = [
  { inputs: [], name: 'decimals', outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' }
]
const tokenContract = new web3.eth.Contract(tokenAbi, fileConfig.tokenAddress || process.env.TOKEN_ADDRESS)
const decimals = Number(await tokenContract.methods.decimals().call())
const requestCounts = new Map()

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

async function discoverProviders () {
  const peers = []
  for await (const prov of libp2p.contentRouting.findProviders(key, { maxTimeout: 5000 })) {
    if (prov.multiaddrs.length === 0) continue
    let latency
    try {
      latency = await libp2p.ping(prov.id)
    } catch {
      latency = Infinity
    }
    let rewardAddress
    try {
      const record = await libp2p.contentRouting.get(key)
      const info = JSON.parse(decoder.decode(record))
      if (info.addr === prov.multiaddrs[0].toString()) rewardAddress = info.rewardAddress
    } catch {}
    console.log(`Tentative de connexion au pair ${prov.id.toString()} - Latence ${latency}ms`)
    peers.push({ id: prov.id, addr: prov.multiaddrs[0], latency, rewardAddress })
  }
  peers.sort((a, b) => a.latency - b.latency)
  return peers
}

let winner

function attemptPeer (peer, prompt) {
  const controller = new AbortController()
  const { promise: started, resolve: startedResolve, reject: startedReject } = Promise.withResolvers()
  const { promise: finished, resolve: finishedResolve, reject: finishedReject } = Promise.withResolvers()
  const timeout = setTimeout(() => {
    controller.abort()
    startedReject(new Error('timeout'))
    finishedReject(new Error('timeout'))
  }, 2000)

  ;(async () => {
    let first = true
    try {
      const stream = await libp2p.dialProtocol(peer.addr, '/ai-torrent/1/generate', { signal: controller.signal })
      params.context = context
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
          if (first) {
            first = false
            startedResolve({ peer, finished })
            if (winner && winner !== peer) {
              controller.abort()
              finishedResolve()
              return
            }
            if (!winner) winner = peer
          }
          if (winner !== peer) {
            controller.abort()
            finishedResolve()
            return
          }
          process.stdout.write(msg.response || '')
          if (msg.error) {
            console.error(msg.error)
            finishedResolve()
            return
          }
          if (msg.done) {
            context = msg.context
            process.stdout.write('\n')
            finishedResolve()
            return
          }
        }
      }
      finishedResolve()
    } catch (err) {
      if (first) startedReject(err)
      finishedReject(err)
    } finally {
      clearTimeout(timeout)
    }
  })()

  return { peer, controller, started, finished }
}

async function sendPrompt (prompt) {
  const providers = await discoverProviders()
  if (!providers.length) {
    console.error('Aucun pair n\'a répondu. Réessayez plus tard.')
    return
  }
  const attempts = providers.slice(0, 3).map(p => attemptPeer(p, prompt))
  let selected
  try {
    selected = await Promise.any(attempts.map(a => a.started))
  } catch (err) {
    console.error('Aucun pair n\'a répondu. Réessayez plus tard.')
    return
  }
  for (const a of attempts) {
    if (a.peer !== selected.peer) a.controller.abort()
  }
  await selected.finished
  const peerId = selected.peer.id.toString()
  const count = (requestCounts.get(peerId) || 0) + 1
  requestCounts.set(peerId, count)
  if (selected.peer.rewardAddress && count % 10 === 0) {
    try {
      const amount = 10n ** BigInt(decimals)
      const tx = await tokenContract.methods.transfer(selected.peer.rewardAddress, amount).send({ from: wallet.address })
      console.log(`Reward tx: ${tx.transactionHash}`)
    } catch (err) {
      console.error('Reward transfer failed:', err)
    }
  }
  winner = undefined
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
