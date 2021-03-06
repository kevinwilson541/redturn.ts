
import Redis from "ioredis"
import { assert } from "chai";

import RedTurn from "../index"

describe("redturn tests", () => {
  let client: RedTurn
  let redis: Redis.Redis
  let sub: Redis.Redis

  before(async () => {
    redis = new Redis()
    sub = new Redis()

    const redisReady = new Promise(resolve => {
      redis.on("ready", resolve)
    })
    const subReady = new Promise(resolve => {
      sub.on("ready", resolve)
    })

    await Promise.all([redisReady, subReady])
  })

  beforeEach(async () => {
    client = new RedTurn(redis, sub)
    await client.start()
  })

  afterEach(async () => {
    // @ts-ignore
    await client._clear()
    await redis.del("resource")
  })

  after(async () => {
    await redis.quit()
    await sub.quit()
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

  it("should handle multiple clients", async () => {
    const redis2 = new Redis()
    const sub2 = new Redis()
    const client2 = new RedTurn(redis2, sub2)
    await client2.start()

    const id1 = await client.wait("resource", 5000)
    const pm2 = client2.wait("resource", 5000)

    await client.signal("resource", id1)

    const id2 = await pm2
    await client2.signal("resource", id2)

    await client2.stop()
    await redis2.quit()
    await sub2.quit()
  })

  it("should handle closing head tracker", async () => {
    const redis2 = new Redis()
    const sub2 = new Redis()
    const client2 = new RedTurn(redis2, sub2)
    await client2.start()

    const id1 = await client.wait("resource", 50)
    const pm2 = client.wait("resource", 5000)
    const pm3 = client2.wait("resource", 5000)

    // wait for client2 to clear resource based on timeout
    await new Promise(resolve => {
      client2.on(`resource:${client.getChannel()}:${id1}:cleared`, resolve)
    })
    const id2 = await pm2

    await client.signal("resource", id2)

    const id3 = await pm3
    await client2.signal("resource", id3)

    await client2.stop()
    await redis2.quit()
    await sub2.quit()
  })

  it("should handle refresh", async () => {
    const id = await client.wait("resource", 5000)
    assert.equal(typeof id, "string")

    const id2 = await client.refresh("resource", id, 5000)
    assert.equal(typeof id2, "string")
    assert.notEqual(id, id2)

    const arr = await redis.lrange("resource", 0, -1)
    assert.lengthOf(arr, 1)
    const [ compareId, channel, timeoutStr ] = arr[0].split(":")
    assert.equal(compareId, id2)
    assert.equal(channel, client.getChannel())
  })

  it("should fail refresh when giving wrong head id", async () => {
    const id = await client.wait("resource", 5000)
    assert.equal(typeof id, "string")

    let err: Error
    try {
      await client.refresh("resource", id + "1", 5000)
    } catch (e) {
      err = e
    }

    assert.ok(err)

    const arr = await redis.lrange("resource", 0, -1)
    assert.lengthOf(arr, 1)
    const [ compareId, channel, timeoutStr ] = arr[0].split(":")
    assert.equal(compareId, id)
    assert.equal(channel, client.getChannel())
  })

  it("sequential lock performance", async () => {
    const count = 1000
    const start = Date.now()

    for (let i = 0; i < count; ++i) {
      const id = await client.wait("resource", 30000)
      await client.signal("resource", id)
    }

    console.log(count, 'sequential locks took', Date.now() - start, 'ms', count * (1000 / (Date.now() - start)), 'op/s');
  })

  it("concurrent lock performance", async () => {
    const promises: Promise<void>[] = []
    const count = 1000
    const start = Date.now()

    for (let i = 0; i < count; ++i) {
      promises.push(client.wait("resource", 30000).then(id => {
        return client.signal("resource", id)
      }))
    }

    await Promise.all(promises)
    console.log(count, 'concurrent locks took', Date.now() - start, 'ms', count * (1000 / (Date.now() - start)), 'op/s');
  })
})