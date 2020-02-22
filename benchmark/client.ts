/* global suite set bench after */
import { execSync } from "child_process";
import RedTurn from "../index";
import Redis from "ioredis"
import * as os from "os"

console.log("==========================");
console.log("CPU: " + os.cpus().length);
console.log("OS: " + os.platform() + " " + os.arch());
console.log("node version: " + process.version);
console.log("current commit: " + execSync("git rev-parse --short HEAD"));
console.log("==========================");

suite("Concurrent Locking", function () {
  // @ts-ignore
  set("mintime", 5000)
  // @ts-ignore
  set("concurrency", 1000)
  // @ts-ignore
  set("iterations", 1000)

  let client: RedTurn
  let redis: Redis.Redis
  let sub: Redis.Redis

  before(function (next) {
    redis = new Redis()
    sub = new Redis()
    client = new RedTurn(redis, sub)
    client.start()
      .then(next)
  })

  // @ts-ignore
  bench("wait/signal workflow", function (next) {
    client.wait("resource", 30000)
      .then(id => {
        return client.signal("resource", id)
      })
      .then(next)
  });

  after(function (next) {
    client.stop().then(next)
  })
})

suite("Sequential Locking", function () {
  // @ts-ignore
  set("mintime", 5000)
  // @ts-ignore
  set("concurrency", 1)
  // @ts-ignore
  set("iterations", 1000)

  let client: RedTurn
  let redis: Redis.Redis
  let sub: Redis.Redis

  before(function (next) {
    redis = new Redis()
    sub = new Redis()
    client = new RedTurn(redis, sub)
    client.start()
      .then(next)
  })

  // @ts-ignore
  bench("wait/signal workflow", function (next) {
    client.wait("resource", 30000)
      .then(id => {
        return client.signal("resource", id)
      })
      .then(next)
  });

  after(function (next) {
    client.stop().then(next)
  })
})