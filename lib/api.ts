import {
  ANDROID_NAS_ORIGIN,
  isAndroidApp,
  nativeJsonResponse,
} from './native-transport.ts';
export type Connection = {
  base: string;
  key: string;
  session: number;
  auth?: 'cookie';
};
export function normalizeBase(
  input: string,
  pageOrigin = typeof window === 'undefined' ? '' : window.location.origin,
  androidNative = isAndroidApp(),
  androidHttpOrigin = ANDROID_NAS_ORIGIN,
): string {
  const url = new URL(input.trim());
  if (url.username || url.password || url.search || url.hash)
    throw new Error('服务地址不能包含账号、密码或查询参数');
  // Browser HTTP is same-origin only. Android additionally permits one NAS
  // origin through native networking; public sites and iOS still require HTTPS.
  const octets = url.hostname.split('.').map(Number);
  const privateV4 =
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
  const sameLanOrigin = privateV4 && url.origin === pageOrigin;
  const androidNas =
    androidNative && !!androidHttpOrigin && url.origin === androidHttpOrigin && url.pathname === '/';
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        sameLanOrigin ||
        androidNas)
    )
  )
    throw new Error(
      '请使用 HTTPS；局域网 HTTP 仅支持当前同源网页或安卓版明确配置的地址',
    );
  return url.toString().replace(/\/+$/, '');
}
export async function api<T>(
  connection: Connection,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    if (
      connection.auth === 'cookie' &&
      (typeof window === 'undefined' ||
        connection.base !== window.location.origin)
    )
      throw new Error('设备授权仅能用于当前网页服务');
    const url = `${connection.base}/api${path}`;
    const response =
      isAndroidApp() &&
      connection.base === ANDROID_NAS_ORIGIN &&
      connection.auth !== 'cookie'
        ? await nativeJsonResponse(
            url,
            { Authorization: `Bearer ${connection.key}` },
            controller.signal,
          )
        : await fetch(url, {
            headers:
              connection.auth === 'cookie'
                ? {}
                : { Authorization: `Bearer ${connection.key}` },
            signal: controller.signal,
            cache: 'no-store',
            credentials: connection.auth === 'cookie' ? 'same-origin' : 'omit',
            redirect: 'error',
          });
    if (!response.ok) {
      if (response.status === 401)
        throw new Error('访问密钥无效，请到设置重新连接');
      if (response.status === 429) throw new Error('请求较多，请稍后刷新');
      if (path.includes('/map?')) {
        const data = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        throw new Error(
          typeof data?.error === 'string'
            ? data.error.slice(0, 180)
            : '地图暂时加载失败，请重试',
        );
      }
      throw new Error('数据服务暂时不可用，请检查连接后重试');
    }
    return (await response.json()) as T;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted)
      throw new Error('连接超时，请检查网络后重试');
    if (error instanceof TypeError)
      throw new Error('无法连接数据服务，请检查服务地址、网络和跨域设置');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
