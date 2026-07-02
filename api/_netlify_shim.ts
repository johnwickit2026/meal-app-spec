import type { HandlerEvent } from '@netlify/functions'

/**
 * Compatibility shim: wraps a Netlify HandlerEvent in lightweight req/res objects
 * that match the shape expected by the legacy Vercel-style handler bodies.
 */
export function createReqRes(event: HandlerEvent) {
  const req = {
    method: event.httpMethod,
    headers: event.headers as Record<string, string>,
    body: (() => {
      const b = event.body
      if (!b || b.trim() === '') return null
      try { return JSON.parse(b) } catch { return null }
    })(),
    query: (event.queryStringParameters || {}) as Record<string, string>,
    url: event.path,
  }

  let _statusCode = 200
  const _headers: Record<string, string> = {}

  const res = {
    setHeader(k: string, v: string) { _headers[k] = v; return res },
    status(code: number) { _statusCode = code; return res },
    json(data: unknown) {
      return {
        statusCode: _statusCode,
        headers: { ..._headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    },
    end() {
      return { statusCode: _statusCode, headers: _headers, body: '' }
    },
  }

  return { req, res }
}
