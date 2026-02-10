/**
 * HTTP 通道：主进程中处理 HTTP 请求
 *
 * 使用 Node.js http/https 模块，支持 mTLS 和系统代理
 */
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import * as fs from 'node:fs';
import type { IServerChannel } from '../../ipc/common/types';
import type { HttpRequestOptions, HttpResponse } from '../../types/http';
import { BaseChannel } from '../../ipc/common/baseChannel';

function resolvePem(value: string): string {
  if (value.includes('-----BEGIN ')) return value;
  return fs.readFileSync(value, 'utf-8');
}

class HttpChannel extends BaseChannel {
  constructor() {
    super();
    this.onCommand('request', this.handleRequest);
  }

  private handleRequest = async (_ctx: string, arg: unknown): Promise<HttpResponse> => {
    const options = arg as HttpRequestOptions;
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout = 30_000,
      responseType = 'json',
      cert,
      key,
      ca,
      rejectUnauthorized,
    } = options;

    console.log(`[HttpChannel] ${method} ${url}`);

    return new Promise<HttpResponse>((resolve, reject) => {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqOptions: https.RequestOptions = {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        headers: { ...headers },
        timeout,
      };

      if (isHttps) {
        if (cert) reqOptions.cert = resolvePem(cert);
        if (key) reqOptions.key = resolvePem(key);
        if (ca) reqOptions.ca = resolvePem(ca);
        if (rejectUnauthorized !== undefined) reqOptions.rejectUnauthorized = rejectUnauthorized;
      }

      let bodyData: string | undefined;
      if (body && method !== 'GET' && method !== 'HEAD') {
        if (typeof body === 'string') {
          bodyData = body;
        } else {
          bodyData = JSON.stringify(body);
          const h = reqOptions.headers as Record<string, string>;
          if (!h['Content-Type']) h['Content-Type'] = 'application/json';
        }
        if (bodyData) {
          (reqOptions.headers as Record<string, string>)['Content-Length'] = Buffer.byteLength(bodyData).toString();
        }
      }

      const req = transport.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const statusCode = res.statusCode ?? 0;
          const statusMessage = res.statusMessage ?? '';

          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) responseHeaders[k] = Array.isArray(v) ? v[0] : v;
          }

          let data: unknown;
          if (responseType === 'buffer') {
            data = Array.from(raw);
          } else {
            const text = raw.toString('utf-8');
            if (responseType === 'json') {
              try { data = JSON.parse(text); } catch { data = text; }
            } else {
              data = text;
            }
          }

          console.log(`[HttpChannel] ✓ ${method} ${url} → ${statusCode}`);
          resolve({ status: statusCode, statusText: statusMessage, headers: responseHeaders, data, ok: statusCode >= 200 && statusCode < 300 });
        });
        res.on('error', (err) => reject(err));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`[HttpChannel] 请求超时（${timeout}ms）: ${method} ${url}`));
      });
      req.on('error', (err) => reject(err));

      if (bodyData) req.write(bodyData);
      req.end();
    });
  };
}

export function createHttpChannel(): IServerChannel<string> {
  return new HttpChannel();
}
