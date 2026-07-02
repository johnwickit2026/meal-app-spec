import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ prefixed ones) for server-side use
  const env = loadEnv(mode, process.cwd(), '')

  // Inject env vars so ssrLoadModule'd handlers see process.env.*
  for (const [key, val] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = val
  }

  return {
    plugins: [
      react(),
      {
        name: 'api-routes',
        configureServer(server) {
          server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
            // ── 1. Parse the path (strip /api prefix, query string, trailing slash) ──
            const rawUrl = req.url || '/'
            const [pathname] = rawUrl.split('?')
            // pathname is relative to /api, e.g. "/admin/users/balance"
            const routeSegments = pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean)

            // ── 2. Resolve file path with dynamic-segment + index fallback ──
            const apiDir = path.resolve(process.cwd(), 'api')

            /**
             * Walk the route segments, trying to match each directory/file.
             * Supports:
             *   api/admin/users/balance.ts          → exact file
             *   api/admin/student-menu/[id].ts      → dynamic segment
             *   api/admin/routines/index.ts          → index fallback
             */
            function resolveApiFile(
              segments: string[],
              currentDir: string,
              params: Record<string, string> = {}
            ): { filePath: string; params: Record<string, string> } | null {
              if (segments.length === 0) {
                // Try index.ts in current dir
                const indexPath = path.join(currentDir, 'index.ts')
                if (fs.existsSync(indexPath)) return { filePath: indexPath, params }
                return null
              }

              const [head, ...rest] = segments

              // a) Exact file match (leaf node)
              if (rest.length === 0) {
                const exactFile = path.join(currentDir, `${head}.ts`)
                if (fs.existsSync(exactFile)) return { filePath: exactFile, params }

                // b) Directory with index.ts
                const indexFile = path.join(currentDir, head, 'index.ts')
                if (fs.existsSync(indexFile)) return { filePath: indexFile, params }
              }

              // c) Descend into exact sub-directory
              const exactDir = path.join(currentDir, head)
              if (fs.existsSync(exactDir) && fs.statSync(exactDir).isDirectory()) {
                const result = resolveApiFile(rest, exactDir, params)
                if (result) return result
              }

              // d) Dynamic segment: look for [param].ts or [param]/ directory
              if (fs.existsSync(currentDir)) {
                const entries = fs.readdirSync(currentDir)
                for (const entry of entries) {
                  const dynMatch = entry.match(/^\[(.+?)\](\.ts)?$/)
                  if (!dynMatch) continue

                  const paramName = dynMatch[1]
                  const newParams = { ...params, [paramName]: head }

                  if (dynMatch[2]) {
                    // [param].ts — only valid as leaf
                    if (rest.length === 0) {
                      const dynFile = path.join(currentDir, entry)
                      if (fs.existsSync(dynFile)) return { filePath: dynFile, params: newParams }
                    }
                  } else {
                    // [param]/ directory — descend
                    const dynDir = path.join(currentDir, entry)
                    if (fs.existsSync(dynDir) && fs.statSync(dynDir).isDirectory()) {
                      const result = resolveApiFile(rest, dynDir, newParams)
                      if (result) return result
                    }
                  }
                }
              }

              return null
            }

            const resolved = resolveApiFile(routeSegments, apiDir)

            if (!resolved) {
              // No matching API file — pass through to Vite's asset/HMR handling
              return next()
            }

            const { filePath, params } = resolved

            // ── 3. CORS preflight ──
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

            if (req.method === 'OPTIONS') {
              res.statusCode = 200
              res.end()
              return
            }

            try {
              // ── 4. Load the module via Vite SSR (hot-reloads on save) ──
              const mod = await server.ssrLoadModule(filePath)
              const handlerFn = mod.default

              if (typeof handlerFn !== 'function') {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: `API module at ${filePath} has no default export function` }))
                return
              }

              // ── 5. Read raw body once ──
              const rawBody = await new Promise<Buffer>((resolve, reject) => {
                const chunks: Buffer[] = []
                req.on('data', (chunk: Buffer) => chunks.push(chunk))
                req.on('end', () => resolve(Buffer.concat(chunks)))
                req.on('error', reject)
              })

              const bodyText = rawBody.toString('utf-8')
              let bodyJson: unknown = undefined
              try {
                if (bodyText) bodyJson = JSON.parse(bodyText)
              } catch {
                // not JSON — leave as undefined
              }

              // ── 6. Parse query string ──
              const queryObj: Record<string, string | string[]> = {}
              const searchParams = new URLSearchParams(rawUrl.split('?')[1] || '')
              for (const [k, v] of searchParams.entries()) {
                if (queryObj[k] === undefined) queryObj[k] = v
                else if (Array.isArray(queryObj[k])) (queryObj[k] as string[]).push(v)
                else queryObj[k] = [queryObj[k] as string, v]
              }

              // ── 7. Detect handler style and call appropriately ──
              //
              //  Style A — Web API:  export default async function handler(req: Request): Promise<Response>
              //  Style B — Vercel:   export default async function handler(req: VercelRequest, res: VercelResponse)
              //
              // Heuristic: if the function declares >= 2 parameters it's Vercel/Node style.
              const isVercelStyle = handlerFn.length >= 2

              if (isVercelStyle) {
                // ── Style B: Vercel/Node ──
                // Augment IncomingMessage with VercelRequest fields
                const vercelReq = Object.assign(req, {
                  body: bodyJson,
                  query: { ...params, ...queryObj },
                  cookies: {} as Record<string, string>,
                })

                // Build a VercelResponse-compatible wrapper around ServerResponse
                let statusCode = 200
                const vercelRes = Object.assign(res, {
                  status(code: number) {
                    statusCode = code
                    res.statusCode = code
                    return vercelRes
                  },
                  json(data: unknown) {
                    res.statusCode = statusCode
                    if (!res.headersSent) {
                      res.setHeader('Content-Type', 'application/json')
                    }
                    res.end(JSON.stringify(data))
                    return vercelRes
                  },
                  send(data: unknown) {
                    res.statusCode = statusCode
                    if (typeof data === 'object' && data !== null) {
                      if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
                      res.end(JSON.stringify(data))
                    } else {
                      res.end(String(data ?? ''))
                    }
                    return vercelRes
                  },
                })

                await handlerFn(vercelReq, vercelRes)
              } else {
                // ── Style A: Web API (Request → Response) ──
                const url = `http://localhost${req.url}`
                const webReq = new Request(url, {
                  method: req.method || 'GET',
                  headers: req.headers as Record<string, string>,
                  body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : rawBody,
                })

                const webRes: Response = await handlerFn(webReq)

                res.statusCode = webRes.status
                webRes.headers.forEach((value, key) => {
                  res.setHeader(key, value)
                })
                const responseBody = await webRes.arrayBuffer()
                res.end(Buffer.from(responseBody))
              }
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err)
              console.error(
                `[api-routes] Error handling ${req.method} /api/${routeSegments.join('/')}:`,
                err
              )
              if (!res.headersSent) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'Internal server error', detail: message }))
              }
            }
          })
        },
      },
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return

            // Recharts + all transitive deps (d3-*, victory-vendor, robust-predicates)
            if (
              id.includes('/recharts/') ||
              id.includes('/d3-') ||
              id.includes('/d3/') ||
              id.includes('/victory-vendor/') ||
              id.includes('/robust-predicates/')
            ) {
              return 'vendor-charts'
            }

            if (
              id.includes('/react-dom/') ||
              id.includes('/react-router') ||
              id.includes('/react/')
            ) {
              return 'vendor-react'
            }

            if (id.includes('/@supabase/')) {
              return 'vendor-supabase'
            }

            if (
              id.includes('/lucide-react/') ||
              id.includes('/react-hot-toast/') ||
              id.includes('/clsx/') ||
              id.includes('/tailwind-merge/')
            ) {
              return 'vendor-ui'
            }

            if (
              id.includes('/zustand/') ||
              id.includes('/date-fns/') ||
              id.includes('/axios/')
            ) {
              return 'vendor-misc'
            }
          },
        },
      },
    },
  }
})
