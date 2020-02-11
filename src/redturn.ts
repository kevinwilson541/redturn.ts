
import { ADD_SCRIPT, REMOVE_SCRIPT } from "./constants/scripts"
import * as crypto from "crypto"
import { ID_LEN } from "./constants/random";
import Queue from "./queue";
import { MonotonicTimer } from "./monotonic";
import { EventEmitter } from "events";

export enum ScriptOperations {
  LOAD = "LOAD"
}

export interface HeadTracker {
  id: string
  channel: string
  timeout: NodeJS.Timer
}

export interface RequestCtx {
  id: string
  resource: string
  timeout: number
  resolve: (id: string) => void
  reject: (error: any) => void
}

export interface RedisPipelineClient {
  script(op: ScriptOperations, script: string): RedisPipelineClient
  exec(): Promise<any[]>
}

export interface RedisClient {
  evalsha(digest: string, ...args: (string | number)[]): Promise<any>
  script(op: ScriptOperations, script: string): Promise<string>
  pipeline(): RedisPipelineClient
}

export interface RedisSubClient extends EventEmitter {
  subscribe(...channels: string[]): Promise<number>
  unsubscribe(...channels: string[]): Promise<number>
}

export enum RedTurnState {
  RUNNING = "RUNNING",
  STOPPING = "STOPPING",
  STOPPED = "STOPPED"
}

export class RedTurn extends EventEmitter {
  private client: RedisClient
  private subclient: RedisSubClient
  private id: string
  private reqQueue: Map<string, Queue<string>>
  private waiting: Map<string, RequestCtx>
  private head: Map<string, HeadTracker>
  private addScript: string
  private removeScript: string
  private timer: MonotonicTimer
  private leased: Set<string>
  private state: RedTurnState

  constructor(client: RedisClient, subclient: RedisSubClient, options: { id?: string } = {}) {
    super()
    const { id } = options
    this.id = id || crypto.randomBytes(ID_LEN).toString("hex")
    this.client = client
    this.subclient = subclient
    this.head = new Map()
    this.reqQueue = new Map()
    this.waiting = new Map()
    this.timer = new MonotonicTimer()
    this.leased = new Set()
    this.state = RedTurnState.STOPPED
  }

  async start() {
    if (this.state !== RedTurnState.STOPPED) {
      throw new Error(`Cannot start redturn server when in state ${RedTurnState.STOPPED}`)
    }

    if (!this.addScript || !this.removeScript) {
      const [addScript, removeScript] = await this.client.pipeline()
        .script(ScriptOperations.LOAD, ADD_SCRIPT)
        .script(ScriptOperations.LOAD, REMOVE_SCRIPT)
        .exec()

      if (addScript[0] === null && typeof addScript[1] === "string") {
        this.addScript = addScript[1]
      } else {
        throw new Error(`Could not load ADD_SCRIPT`)
      }

      if (removeScript[0] === null && typeof removeScript[1] === "string") {
        this.removeScript = removeScript[1]
      } else {
        throw new Error(`Could not load REMOVE_SCRIPT`)
      }
    }

    this.state = RedTurnState.RUNNING
    const handler = (channel, message) => {
      if (channel !== this.id) return
      const [ resource, id ] = message.split(":")
      this._notifyWait(resource, id)
    }
    this.subclient.on("message", handler)
    this.on("closed", () => {
      this.subclient.removeListener("message", handler)
    })
    await this.subclient.subscribe(this.id)
  }

  async stop() {
    if (this.state !== RedTurnState.RUNNING) {
      return
    }

    this.state = RedTurnState.STOPPING

    return new Promise(resolve => {
      this.once("idle", async () => {
        await this._clear()
        this.state = RedTurnState.STOPPED
        this.emit("closed")
        return resolve()
      })

      if (this.idle()) {
        this.emit("idle")
      }
    })
  }

  async wait(resource: string, timeout: number): Promise<string> {
    const id = this._genMsgId()
    const val = id + ":" + this.id + ":" + timeout
    return new Promise<string>(async (resolve, reject) => {
      if (this.state !== RedTurnState.RUNNING) {
        return reject(new Error("Closing"))
      }

      this._addToReqQueue(resource, id)
      const ctx = { id, resource, timeout, resolve, reject }
      this.waiting.set(id, ctx)

      let ret: string
      try {
        ret = await this.client.evalsha(this.addScript, 1, resource, this.id, val, id)
      } catch (e) {
        this._deleteCtx(ctx)
        return reject(e)
      }

      if (this.state !== RedTurnState.RUNNING) {
        return
      }

      const [ otherId, channel, timeoutStr ] = ret.split(":")
      this._replaceHead(resource, channel, otherId, parseInt(timeoutStr))
    })
    
  }

  async signal(resource: string, id: string): Promise<void> {
    return this._signalDone(resource, this.id, id)
  }

  idle() {
    return this.leased.size === 0 && this.waiting.size === 0
  }

  private _genMsgId() {
    return this.timer.getTime().join(".")
  }

  private _replaceHead(resource: string, channel: string, id: string, timeout: number) {
    const current = this.head.get(channel)
    if (current && current.id !== id) {
      clearTimeout(current.timeout)
    }

    const timer = setTimeout(this._clearHead.bind(this, resource, channel, id), timeout)
    this.head.set(resource, { id, channel, timeout: timer })
  }

  private _clearHead(resource: string, channel: string, id: string) {
    if (this.state === RedTurnState.STOPPED) return
    const { channel: otherChann, id: otherId } = this.head.get(resource)
    if (otherChann === channel && otherId === id) {
      this.head.delete(resource)
      this._signalDone(resource, channel, id)
    }
  }

  private _addToReqQueue(resource: string, id: string) {
    let queue = this.reqQueue.get(resource)
    if (!queue) {
      queue = new Queue()
    }

    queue.enqueue(id)
    this.reqQueue.set(resource, queue)
  }

  private _removeFromReqQueue(ctx: RequestCtx) {
    const { resource, id } = ctx
    const queue = this.reqQueue.get(resource)
    let head = queue.peek()

    // iterate through elements in queue until we reach id we're looking for
    while (head && head !== id) {
      const [ milli, counter ] = head.split(".")
      const [ ctxMilli, ctxCounter ] = id.split(".")
      // if we receive notification for active ctx greater than the current head, head was skipped
      // otherwise, we should return an error as this notified ctx was skipped
      if (milli < ctxMilli || (milli === ctxMilli && counter < ctxCounter)) {
        const otherCtx = this.waiting.get(head)
        queue.dequeue()
        this.waiting.delete(head)
        this._reply(otherCtx, new Error(`Async notification message missed for resource ${resource}, request ${id}`))
        head = queue.peek()
      } else {
        this.waiting.delete(id)
        this._reply(ctx, new Error(`Async notification message missed for resource ${resource}, request ${id}`))
        break
      }
    }

    if (head === id) {
      queue.dequeue()
      this.waiting.delete(id)
      this._reply(ctx)
    }

    if (queue.len() === 0) {
      this.reqQueue.delete(resource)
    }

    if (this.idle()) {
      this.emit("idle")
    }
  }

  private _notifyWait(resource: string, id: string) {
    if (this.state !== RedTurnState.RUNNING) return

    const ctx = this.waiting.get(id)
    if (!ctx) {
      this.signal(resource, id)
    } else {
      this._removeFromReqQueue(ctx)
      this._replaceHead(resource, this.id, id, ctx.timeout)
    }
  }

  _deleteCtx(ctx: RequestCtx) {
    const { resource, id } = ctx
    const queue = this.reqQueue.get(resource)

    const rem = queue.delete(id)
    if (rem === true) {
      this.waiting.delete(id)
    }

    if (queue.len() === 0) {
      this.reqQueue.delete(resource)
    }

    if (this.idle() === true) {
      this.emit("idle")
    }
  }

  private async _signalDone(resource: string, channel: string, id: string) {
    // only delete leased id if signalling is for this instance of server
    if (channel === this.id) {
      this.leased.delete(id)
    }
    
    try {
      const ret: string = await this.client.evalsha(this.removeScript, 1, resource, id, channel)
      if (ret !== null && this.state == RedTurnState.RUNNING) {
        const [ otherId, channel, timeoutStr ] = ret.split(":")
        this._replaceHead(resource, channel, otherId, parseInt(timeoutStr))
      }
    } catch (e) {
      this.emit("error", e)
    } finally {
      if (channel === this.id && this.idle()) {
        this.emit("idle")
      }
    }
  }

  private _reply(ctx: RequestCtx, error?: any) {
    if (error) {
      return ctx.reject(error)
    } else {
      this.leased.add(ctx.id)
      return ctx.resolve(ctx.id)
    }
  }

  private async _clear() {
    await this.subclient.unsubscribe(this.id)
    // clear head trackers
    this.head.forEach(track => {
      clearTimeout(track.timeout)
    })
    this.head.clear()
    this.waiting.clear()
    this.reqQueue.clear()
    this.leased.clear()
  }
}