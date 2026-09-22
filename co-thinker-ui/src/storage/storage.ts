// 带命名空间的本机存储。读要校验，写失败要说出来。

const NS = 'cothinker.ui.v1'

export interface StorageStatus {
  ok: boolean
  detail?: string
}

export class Repository {
  private status: StorageStatus = { ok: true }
  private memory = new Map<string, unknown>()

  constructor(private readonly namespace = NS) {}

  get state(): StorageStatus {
    return this.status
  }

  private key(name: string) {
    return `${this.namespace}:${name}`
  }

  private backend(): Storage | null {
    try {
      const probe = '__ct_probe__'
      window.localStorage.setItem(probe, '1')
      window.localStorage.removeItem(probe)
      return window.localStorage
    } catch {
      return null
    }
  }

  read<T>(name: string, guard: (value: unknown) => value is T): T | null {
    if (this.memory.has(name)) return this.memory.get(name) as T
    const store = this.backend()
    if (!store) {
      this.status = { ok: false, detail: '这台浏览器不允许本机存储，内容只保留在当前页面。' }
      return null
    }
    const raw = store.getItem(this.key(name))
    if (raw == null) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!guard(parsed)) {
        store.removeItem(this.key(name))
        this.status = { ok: true, detail: '本机存有一份读不懂的旧数据，已跳过。' }
        return null
      }
      return parsed
    } catch {
      store.removeItem(this.key(name))
      this.status = { ok: true, detail: '本机存有一份读不懂的旧数据，已跳过。' }
      return null
    }
  }

  write(name: string, value: unknown): boolean {
    this.memory.set(name, value)
    const store = this.backend()
    if (!store) {
      this.status = { ok: false, detail: '尚未保存到本机：这台浏览器不允许本机存储。' }
      return false
    }
    try {
      store.setItem(this.key(name), JSON.stringify(value))
      if (!this.status.ok) this.status = { ok: true }
      return true
    } catch {
      this.status = { ok: false, detail: '尚未保存到本机：本机存储空间不足或被拒绝。' }
      return false
    }
  }

  /** 测试用。 */
  clear(): void {
    this.memory.clear()
    this.status = { ok: true }
  }

  remove(name: string): void {
    this.memory.delete(name)
    try {
      this.backend()?.removeItem(this.key(name))
    } catch {
      /* 内存里已经删掉 */
    }
  }
}

export const repository = new Repository()
