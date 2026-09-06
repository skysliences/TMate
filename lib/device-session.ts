import { api, type Connection } from './api.ts';
import type { CarInfo } from './data';
import { isAndroidApp } from './native-transport.ts';
type DeviceState = {
  local: boolean;
  pairingEnabled?: boolean;
  connection?: Connection;
  cars?: CarInfo[];
  error?: string;
};
export function cookieConnection(): Connection {
  return {
    base: window.location.origin,
    key: '',
    auth: 'cookie',
    session: Date.now(),
  };
}
export async function deviceSession(
  method: 'POST' | 'DELETE',
  key = '',
  pairingToken = '',
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch('/api/session', {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: method === 'POST' ? JSON.stringify({ pairingToken }) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new Error('配对链接已失效或密钥无效，请输入访问密钥连接');
      throw new Error('设备连接失败，请检查网络与服务地址');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function restoreDevice(signal: AbortSignal): Promise<DeviceState> {
  // The packaged Android UI starts at connection settings, never fake vehicles.
  // Its local assets are not the NAS origin and must not use browser cookies.
  if (isAndroidApp()) return { local: true, pairingEnabled: false };
  if (!['http:', 'https:'].includes(window.location.protocol))
    return { local: false };
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const pairingToken = fragment.get('pair') || '';
  if (fragment.has('pair')) {
    fragment.delete('pair');
    window.history.replaceState(
      null,
      '',
      window.location.pathname +
        window.location.search +
        (fragment.size ? `#${fragment}` : ''),
    );
  }
  let local =
    !!pairingToken ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      window.location.hostname,
    );
  try {
    const response = await fetch('/api/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      if (local || response.status >= 500)
        throw new Error('暂时无法读取 TMate 服务，请刷新重试');
      return { local: false };
    }
    const state = (await response.json()) as {
      service?: string;
      authenticated?: boolean;
      pairingEnabled?: boolean;
    };
    if (state.service !== 'voltlog') {
      if (local) throw new Error('当前地址没有返回有效的 TMate 服务');
      return { local: false };
    }
    local = true;
    if (pairingToken) await deviceSession('POST', '', pairingToken, signal);
    if (!state.authenticated && !pairingToken)
      return { local: true, pairingEnabled: state.pairingEnabled === true };
    const connection = cookieConnection();
    const { cars } = await api<{ cars: CarInfo[] }>(
      connection,
      '/cars',
      signal,
    );
    if (!Array.isArray(cars)) throw new Error('车辆数据格式无效');
    return { local: true, pairingEnabled: true, connection, cars };
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      local,
      error: local
        ? error instanceof Error
          ? error.message
          : '服务连接失败'
        : undefined,
    };
  }
}
