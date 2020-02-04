
export class MonotonicTimer {
  private time: number
  private index: number

  constructor() {
    this.time = Date.now()
    this.index = 0
  }

  getTime() {
    const curr = Math.max(Date.now(), this.time)
    if (curr === this.time) {
      this.index++
    } else {
      this.index = 0
    }

    this.time = curr

    return [ this.time, this.index ]
  }
}