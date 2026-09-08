import type { Command, Ledger } from './ledger.ts';

export type Snapshot = {state: Ledger; revision: number; user?: {name: string; email: string}};
type Ref<T> = {current: T};
type RandomSource = {randomUUID?: () => string; getRandomValues?: (bytes: Uint8Array) => Uint8Array};

export function createRequestId(source: RandomSource | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID();
  // getRandomValues is also available on HTTP origins; keep 122 random UUID bits.
  if (typeof source?.getRandomValues !== 'function') throw new Error('浏览器无法生成请求编号，请更换浏览器或使用 HTTPS 后重试');
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

type SaveContext = {
  busyRef: Ref<boolean>;
  requestRef: Ref<{key: string; signature: string} | null>;
  stateRef: Ref<Snapshot>;
  setBusy: (busy: boolean) => void;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
  setSnapshot: (snapshot: Snapshot) => void;
};

export async function saveCommand(command: Command, context: SaveContext, dependencies: {fetch?: typeof fetch; createId?: () => string} = {}): Promise<boolean> {
  const {busyRef, requestRef, stateRef, setBusy, setError, setNotice, setSnapshot} = context;
  if (busyRef.current) return false;
  busyRef.current = true;
  let key: string | undefined;
  let sent = false;
  const request = dependencies.fetch ?? globalThis.fetch;
  const update = (data: Snapshot) => {
    const next = {...stateRef.current, ...data};
    stateRef.current = next;
    setSnapshot(next);
  };
  try {
    setBusy(true);
    setError('');
    const signature = JSON.stringify(command);
    if (!requestRef.current || requestRef.current.signature !== signature) {
      requestRef.current = {key: (dependencies.createId ?? createRequestId)(), signature};
    }
    key = requestRef.current.key;
    const body = JSON.stringify({command, revision: stateRef.current.revision, requestId: key});
    sent = true;
    const response = await request('/api/ledger', {method: 'POST', headers: {'Content-Type': 'application/json'}, body});
    const data = await response.json() as Snapshot & {error?: string};
    if (data.state) update(data);
    if (!response.ok) {
      if (response.status === 409) requestRef.current = null;
      throw new Error(data.error || '保存失败');
    }
    requestRef.current = null;
    setNotice('已保存，手机和电脑可同步查看');
    return true;
  } catch (e) {
    // Only reconcile after a possible write, and retain the same key for uncertain retries.
    if (sent && key) try {
      const response = await request('/api/ledger', {cache: 'no-store'});
      if (response.ok) {
        const fresh = await response.json() as Snapshot;
        update(fresh);
        if (fresh.state.requests.includes(key)) {
          requestRef.current = null;
          setNotice('已确认保存成功');
          return true;
        }
      }
    } catch {}
    setError(e instanceof Error ? e.message : '连接中断，请保持表单不变并重试；重复提交不会重复记账');
    return false;
  } finally {
    busyRef.current = false;
    setBusy(false);
  }
}
