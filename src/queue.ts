
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
  
  delete(val: T) {
    let index = this._front.indexOf(val)
    if (index >= 0) {
      this._front = this._front.slice(0, index).concat(this._front.slice(index + 1))
      return true
    }

    index = this._back.indexOf(val)
    if (index >= 0) {
      this._back = this._back.slice(0, index).concat(this._front.slice(index + 1))
      return true
    }

    return false
  }
}

export default Queue