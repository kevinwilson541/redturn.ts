
class Queue<T> {
  private _front: Array<T>
  private _back: Array<T>

  constructor() {
    this._front = []
    this._back = []
  }

  enqueue(val: T) {
    this._back.push(val)
  }

  renqueue(val: T) {
    this._front.push(val)
  }

  dequeue() {
    if (this._front.length === 0) {
      this._front = this._back.reverse()
      this._back = []
    }

    return this._front.pop()
  }

  peek() {
    if (this._front.length === 0) {
      this._front = this._back.reverse()
      this._back = []
    }

    return this._front.length === 0 ? undefined : this._front[this._front.length-1]
  }

  len() {
    return this._front.length + this._back.length
  }
}

export default Queue