/**
 * HTTP 服务：Worker 侧 HTTP 请求能力
 *
 * 使用浏览器原生 fetch API，适用于 Worker 自身发起的网络请求。
 * 渲染进程应通过 IPC → 主进程 HttpChannel（使用 Node.js http/https）发起请求。
 */
import type { HttpRequestOptions, HttpResponse } from '../../types/http';

type OmitUrlMethod = Partial<Omit<HttpRequestOptions, 'url' | 'method'>>;
type OmitUrlMethodBody = Partial<Omit<HttpRequestOptions, 'url' | 'method' | 'body'>>;

export class HttpService {
  /** 通用 HTTP 请求 */
  async request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = 30_000,
      responseType = 'json',
    } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: { ...headers },
        signal: controller.signal,
      };

      if (body && method !== 'GET' && method !== 'HEAD') {
        if (typeof body === 'string') {
          fetchOptions.body = body;
        } else {
          fetchOptions.body = JSON.stringify(body);
          const h = fetchOptions.headers as Record<string, string>;
          if (!h['Content-Type']) {
            h['Content-Type'] = 'application/json';
          }
        }
      }

      const response = await fetch(url, fetchOptions);

      // 解析响应头
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // 解析响应体
      let data: T;
      if (responseType === 'json') {
        const text = await response.text();
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = text as T;
        }
      } else if (responseType === 'text') {
        data = (await response.text()) as T;
      } else {
        const buffer = await response.arrayBuffer();
        data = Array.from(new Uint8Array(buffer)) as T;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
        ok: response.ok,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`[HttpService] 请求超时（${timeout}ms）: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET 请求 */
  get<T = unknown>(url: string, options?: OmitUrlMethod): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'GET', ...options });
  }

  /** POST 请求 */
  post<T = unknown>(url: string, body?: HttpRequestOptions['body'], options?: OmitUrlMethodBody): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'POST', body, ...options });
  }

  /** PUT 请求 */
  put<T = unknown>(url: string, body?: HttpRequestOptions['body'], options?: OmitUrlMethodBody): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'PUT', body, ...options });
  }

  /** DELETE 请求 */
  delete<T = unknown>(url: string, options?: OmitUrlMethod): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'DELETE', ...options });
  }
}
