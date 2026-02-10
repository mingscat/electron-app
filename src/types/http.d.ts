/**
 * HTTP 网络请求相关类型定义
 */

/** HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * HTTP 请求选项
 */
export interface HttpRequestOptions {
  /** 请求 URL */
  url: string;
  /** HTTP 方法，默认 GET */
  method?: HttpMethod;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体（POST/PUT/PATCH），对象会自动 JSON.stringify */
  body?: string | Record<string, unknown> | unknown[];
  /** 超时时间（ms），默认 30000 */
  timeout?: number;
  /** 响应类型：json（默认）、text、buffer（返回 number[]） */
  responseType?: 'json' | 'text' | 'buffer';

  // ─── TLS / mTLS 选项 ────────────────────────────
  /** 客户端证书（PEM 字符串或文件路径） */
  cert?: string;
  /** 客户端私钥（PEM 字符串或文件路径） */
  key?: string;
  /** 自定义 CA 证书（PEM 字符串或文件路径），用于自签名服务端 */
  ca?: string;
  /** 是否跳过服务端证书验证（仅调试用），默认 false */
  rejectUnauthorized?: boolean;
}

/**
 * HTTP 响应
 */
export interface HttpResponse<T = unknown> {
  /** HTTP 状态码 */
  status: number;
  /** 状态文本 */
  statusText: string;
  /** 响应头 */
  headers: Record<string, string>;
  /** 响应数据 */
  data: T;
  /** 是否成功 (2xx) */
  ok: boolean;
}

/**
 * HTTP Channel 接口（渲染进程调用）
 */
export interface IHttpChannel {
  call(command: 'request', arg: HttpRequestOptions): Promise<HttpResponse>;
  call<T = unknown>(
    command: string,
    arg?: unknown,
    cancellationToken?: import('../ipc/common/types').CancellationToken,
  ): Promise<T>;
  listen<T = unknown>(event: string, arg?: unknown): import('../ipc/common/types').IEvent<T>;
}
