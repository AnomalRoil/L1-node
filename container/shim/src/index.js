import { randomUUID } from 'node:crypto'
import https from 'node:https'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import express from 'express'
import Debug from 'debug'

import { register} from './registration.js'
import { FIL_WALLET_ADDRESS, NGINX_PORT, NODE_OPERATOR_EMAIL, NODE_VERSION, nodeId, PORT, } from './config.js'
import { streamCAR } from './utils.js'
import { trapServer } from './trap.js'

const debug = Debug('node')
const app = express()

const testCAR = await fsPromises.readFile('./public/QmQ2r6iMNpky5f1m4cnm3Yqw8VSvjuKpTcK1X7dBR1LkJF.car')

app.disable('x-powered-by')

app.get('/favicon.ico', (req, res) => {
  res.sendStatus(404)
})

// Whenever nginx doesn't have a CAR file in cache, this is called
app.get('/cid/:cid*', async (req, res) => {
  const cid = req.params.cid + req.params[0]
  debug.extend('req')(`Cache miss for %s`, cid)
  res.set('Cache-Control', 'public, max-age=31536000, immutable')

  if (req.headers.range) {
    let [start, end] = req.headers.range.split('=')[1].split('-')
    start = parseInt(start, 10)
    end = parseInt(end, 10)

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Range', `bytes ${start}-${end}/${testCAR.length}`)
    res.status(206)
    return res.end(testCAR.slice(start, end + 1))
  }

  // Testing CID
  if (cid === 'QmQ2r6iMNpky5f1m4cnm3Yqw8VSvjuKpTcK1X7dBR1LkJF') {
    res.setHeader('X-Node-Id', nodeId)
    res.setHeader('X-Node-Version', NODE_VERSION)
    return res.send(testCAR)
  }

  https.get(`https://ipfs.io/api/v0/dag/export?arg=${cid}`, async fetchRes => {
    streamCAR(fetchRes, res).catch(debug)
  })
})

app.get('/register-check', (req, res) => {
  const { nodeId: receivedNodeId } = req.query
  if (receivedNodeId !== nodeId) {
    debug.extend('check')('Check failed, nodeId mismatch')
    return res.sendStatus(403)
  }
  debug.extend('check')('Check successful')
  res.sendStatus(200)
})

const server = app.listen(PORT, async () => {
  debug.extend('version')(`${NODE_VERSION}`)
  debug(`shim running on http://localhost:${PORT}. Test at http://localhost:${PORT}/cid/QmQ2r6iMNpky5f1m4cnm3Yqw8VSvjuKpTcK1X7dBR1LkJF?clientId=${randomUUID()}`)
  debug(`nginx caching proxy running on https://localhost:${NGINX_PORT}. Test at https://localhost:${NGINX_PORT}/cid/QmQ2r6iMNpky5f1m4cnm3Yqw8VSvjuKpTcK1X7dBR1LkJF?clientId=${randomUUID()}`)
  debug.extend('address')(`===== IMPORTANT =====`)
  debug.extend('address')(`Earnings will be sent to Filecoin wallet address: ${FIL_WALLET_ADDRESS}`)
  debug.extend('address')(NODE_OPERATOR_EMAIL ? `Payment notifications and important update will be sent to: ${NODE_OPERATOR_EMAIL}` : 'NO OPERATOR EMAIL SET, WE HIGHLY RECOMMEND SETTING ONE')
  debug.extend('address')(`===== IMPORTANT =====`)

  await register()
  server.registerInterval = setInterval(() => {
    register().catch(() => process.exit(0))
  }, (Math.random() * 2 + 4) * 60 * 1000) // register every ~5 minutes

  // Start log ingestor
  import('./log_ingestor.js')
})

trapServer(server)
