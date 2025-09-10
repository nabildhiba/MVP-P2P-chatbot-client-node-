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
import Web3 from 'web3'

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }
}

const configText = await fsp.readFile(new URL('./config.yaml', import.meta.url), 'utf8')
const config = parse(configText)

const web3 = (config.rpcUrl || process.env.RPC_URL)
  ? new Web3(config.rpcUrl || process.env.RPC_URL)
  : null
const rewardsFile = new URL('./rewards.json', import.meta.url)

const bootstrappers = [process.env.BOOTSTRAP_ADDR].filter(Boolean)
const port = process.env.PORT || config.port || 55781

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
  console.log('peer connected:', e.detail.toString())
})
libp2p.addEventListener('peer:disconnect', e => {
  console.log('peer disconnected:', e.detail.toString())
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const announceKey = config.announceKey || 'ait:cap:mistral-q4'
const addr = libp2p.getMultiaddrs()[0]?.toString() || ''
const rewardAddress = config.rewardAddress || ''
const announcement = JSON.stringify({ addr, rewardAddress })

console.log(`listening on ${addr}`)
try {
  const fileData = [addr]
  if (rewardAddress) fileData.push(rewardAddress)
  writeFileSync(new URL('../client/daemon.addr', import.meta.url), fileData.join('\n'))
} catch (err) {
  console.warn('Failed to write address file:', err)
}
try {
  await libp2p.contentRouting.put(encoder.encode(announceKey), encoder.encode(announcement))
  console.log(`announced ${announceKey} at ${addr}`)
} catch (err) {
  console.warn('Failed to announce address:', err)
}

let active = 0
const limit = config.maxConcurrent || 1

async function watchRewards () {
  if (!web3 || !rewardAddress) return
  try {
    const blockNumber = await web3.eth.getBlockNumber()
    const transferTopic = web3.utils.sha3('Transfer(address,address,uint256)')
    const toTopic = '0x' + rewardAddress.toLowerCase().slice(2).padStart(64, '0')
    const logs = await web3.eth.getPastLogs({ fromBlock: blockNumber, toBlock: blockNumber, topics: [transferTopic, null, toTopic] })
    for (const log of logs) {
      const decoded = web3.eth.abi.decodeLog([
        { type: 'address', name: 'from', indexed: true },
        { type: 'address', name: 'to', indexed: true },
        { type: 'uint256', name: 'value' }
      ], log.data, [log.topics[1], log.topics[2]])
      const amountWei = BigInt(decoded.value)
      let totalWei = 0n
      try {
        totalWei = BigInt((await fsp.readFile(rewardsFile, 'utf8')).trim() || '0')
      } catch {}
      totalWei += amountWei
      await fsp.writeFile(rewardsFile, totalWei.toString())
      console.log(`Reward confirmed: ${web3.utils.fromWei(decoded.value, 'ether')} tokens (total ${web3.utils.fromWei(totalWei.toString(), 'ether')})`)
    }
  } catch (err) {
    console.warn('Failed to check rewards:', err)
  }
}

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
      const dataChunk = chunk.subarray ? chunk.subarray() : Uint8Array.from(chunk)
      data += decoder.decode(dataChunk)
      if (data.includes('\n')) break
    }
    const req = JSON.parse(data.trim())
    const { prompt, params = {} } = req

    await stream.sink((async function* () {
      for await (const line of generate(prompt, params, config.model)) {
        yield encoder.encode(line + '\n')
      }
    })())
    await watchRewards()
  } catch (err) {
    await stream.sink((async function* () {
      yield encoder.encode(JSON.stringify({ error: err.message }) + '\n')
    })())
  } finally {
    active--
  }
})

console.log('daemon running')
