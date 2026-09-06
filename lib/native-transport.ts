import {
  Capacitor,
  CapacitorHttp,
  type HttpOptions,
  type HttpResponse,
} from '@capacitor/core';

import mobileConfig from '../mobile.config.json' with { type: 'json' };
export const ANDROID_NAS_ORIGIN = mobileConfig.androidHttpOrigin;
export const DEFAULT_SERVER_URL = mobileConfig.defaultServerUrl;
export const isAndroidApp = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

// Use the native networking stack, not globally relaxed WebView mixed content.
// Cleartext access is restricted again by Android's network security config.
export async function nativeJsonResponse(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  request: (options: HttpOptions) => Promise<HttpResponse> = (options) =>
    CapacitorHttp.get(options),
  allowedOrigin = ANDROID_NAS_ORIGIN,
): Promise<Response> {
  const target = new URL(url);
  if (
    !allowedOrigin || target.origin !== allowedOrigin ||
    !target.pathname.startsWith('/api/') ||
    target.username ||
    target.password ||
    target.hash
  )
    throw new Error('原生局域网连接仅允许已配置的 TMate 数据接口');
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  let abort: () => void = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
    });
    const result = await Promise.race([
      request({
        url,
        headers,
        connectTimeout: 10000,
        readTimeout: 15000,
        disableRedirects: true,
        responseType: 'json',
      }),
      cancelled,
    ]);
    if (
      (result.status >= 300 && result.status < 400) ||
      new URL(result.url).origin !== target.origin
    )
      throw new Error('数据服务发生重定向，已停止连接');
    return new Response(
      typeof result.data === 'string'
        ? result.data
        : JSON.stringify(result.data),
      {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('无法连接 TMate，请检查家庭 Wi-Fi 和服务地址');
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
