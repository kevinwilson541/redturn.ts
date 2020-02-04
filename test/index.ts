
import Redis from "ioredis"
import { assert } from "chai";

import RedTurn from "../index"

describe("redturn tests", () => {
  let client: RedTurn
  let redis: Redis.Redis
  let sub: Redis.Redis

  before(() => {
    redis = new Redis()
    sub = new Redis()
  })

  beforeEach(async () => {
    client = new RedTurn(redis, sub)
    await client.start()
  })

  afterEach(async () => {
    // @ts-ignore
    await client._clear()
    await redis.flushdb()
  })

  it("should make a call to wait", async () => {
    const id = await client.wait("resource", 5000)
    assert.equal(typeof id, "string")

    const arr = await redis.lrange("resource", 0, -1)
    assert.lengthOf(arr, 1)
    const [ compareId, channel, timeoutStr ] = arr[0].split(":")
    assert.equal(compareId, id)
  })

  it("should make a call to wait and then signal", async () => {
    const id = await client.wait("resource", 5000)
    assert.equal(typeof id, "string")

    await client.signal("resource", id)

    const arr = await redis.lrange("resource", 0, -1)
    assert.lengthOf(arr, 0)
  })

  it("should make multiple calls to wait/signal", async () => {
    const pm1 = client.wait("resource", 5000)
    const pm2 = client.wait("resource", 5000)

    const id = await pm1
    const len = await redis.llen("resource")
    assert.equal(len, 2)

    await client.signal("resource", id)
    const id2 = await pm2

    const arr = await redis.lrange("resource", 0, -1)
    assert.lengthOf(arr, 1)
    const [ compareId, channel, timeoutStr ] = arr[0].split(":")
    assert.equal(compareId, id2)

    await client.signal("resource", id2)
    const arr2 = await redis.lrange("resource", 0, -1)
    assert.lengthOf(arr2, 0)
  })

  it("should wait until completely empty of pending requests to complete stop call", async () => {
    const id = await client.wait("resource", 5000)
    assert.equal(client.idle(), false)

    let called = false
    client.once("idle", () => {
      called = true
    })
    await client.signal("resource", id)
    assert.ok(called)

    await client.stop()
  })

  it("should handle a skipped message", async () => {
    const pm1 = client.wait("resource", 5000)
    let skipped = false
    const pm2 = client.wait("resource", 5000).catch(e => skipped = true)
    const pm3 = client.wait("resource", 5000)

    const ret = await redis.lindex("resource", 1)
    await redis.lrem("resource", 0, ret)

    const id1 = await pm1
    await client.signal("resource", id1)
    const id3 = await pm3
    await client.signal("resource", id3)
    assert.ok(skipped)
  })
})