/**
 * HTTP API 模块：网络请求能力
 *
 * 请求通过 IPC 传递到主进程，由 Node.js http/https 执行（支持 mTLS）。
 */
import type { IHttpChannel, HttpRequestOptions, HttpResponse } from '../../types/http';

type OmitUrlMethod = Partial<Omit<HttpRequestOptions, 'url' | 'method'>>;
type OmitUrlMethodBody = Partial<Omit<HttpRequestOptions, 'url' | 'method' | 'body'>>;

export class HttpApi {
  constructor(private readonly channel: IHttpChannel) {}

  /** 通用请求 */
  request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.channel.call<HttpResponse<T>>('request', options);
  }

  /** GET */
  get<T = unknown>(url: string, options?: OmitUrlMethod): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'GET', ...options });
  }

  /** POST */
  post<T = unknown>(url: string, body?: HttpRequestOptions['body'], options?: OmitUrlMethodBody): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'POST', body, ...options });
  }

  /** PUT */
  put<T = unknown>(url: string, body?: HttpRequestOptions['body'], options?: OmitUrlMethodBody): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'PUT', body, ...options });
  }

  /** DELETE */
  delete<T = unknown>(url: string, options?: OmitUrlMethod): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'DELETE', ...options });
  }

  /** PATCH */
  patch<T = unknown>(url: string, body?: HttpRequestOptions['body'], options?: OmitUrlMethodBody): Promise<HttpResponse<T>> {
    return this.request<T>({ url, method: 'PATCH', body, ...options });
  }
}
