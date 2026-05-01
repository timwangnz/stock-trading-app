/**
 * server/mcp.js
 * MCP (Model Context Protocol) HTTP client — Streamable HTTP transport.
 *
 * Implements the full 2024-11-05 handshake:
 *   1. POST initialize  → server returns Mcp-Session-Id header
 *   2. POST notifications/initialized  (no response expected)
 *   3. POST tools/list  → array of tool definitions
 *   4. POST tools/call  → tool result
 *
 * Session IDs are kept in memory for the lifetime of the process.
 * Each (url+auth) pair gets one session reused across calls.
 */

const MCP_VERSION = '2024-11-05'
let   _reqId      = 1

// In-memory session cache:  key → { sessionId, serverInfo }
const _sessions = new Map()

// ── Internal helpers ─────────────────────────────────────────────

function authHeaders(server) {
  if (!server.auth_header?.trim()) return {}
  const colon = server.auth_header.indexOf(':')
  if (colon === -1) return {}
  return { [server.auth_header.slice(0, colon).trim()]: server.auth_header.slice(colon + 1).trim() }
}

function sessionKey(server) {
  return `${server.url}||${server.auth_header ?? ''}`
}

/** Parse a text/event-stream body and return the first result payload */
async function parseSSE(res) {
  const text = await res.text()
  console.log('[mcp] SSE body preview:', text.slice(0, 300))
  let result = null, error = null
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const obj = JSON.parse(line.slice(6))
      if (obj.error)              error  = obj.error
      if (obj.result !== undefined) result = obj.result
    } catch { /* skip */ }
  }
  if (error) throw new Error(`MCP error ${error.code ?? ''}: ${error.message}`)
  return result
}

/** Send one JSON-RPC POST and return the result (or null for notifications) */
async function post(url, method, params, extraHeaders = {}) {
  const isNotification = !params    // notifications have no id
  const body = isNotification
    ? JSON.stringify({ jsonrpc: '2.0', method })
    : JSON.stringify({ jsonrpc: '2.0', id: String(_reqId++), method, params })

  let res
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json, text/event-stream',
        ...extraHeaders,
      },
      body,
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new Error(`MCP fetch failed (${url}): ${err.message}`)
  }

  if (isNotification) return null   // 202 Accepted, no body expected

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`MCP HTTP ${res.status}: ${body.slice(0, 300)}`)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/event-stream')) return parseSSE(res)

  const data = await res.json()
  if (data.error) throw new Error(`MCP error ${data.error.code ?? ''}: ${data.error.message}`)
  return data.result
}

/**
 * Run the initialize handshake for a server and cache the session.
 * Returns the session headers object to include in subsequent requests.
 */
async function ensureSession(server) {
  const key  = sessionKey(server)
  if (_sessions.has(key)) {
    const { sessionId } = _sessions.get(key)
    return sessionId ? { 'Mcp-Session-Id': sessionId } : {}
  }

  const hdrs = authHeaders(server)
  console.log(`[mcp] Initialising session for "${server.name}" (${server.url})`)

  // 1. initialize
  const initRes = await fetch(server.url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...hdrs },
    body:    JSON.stringify({
      jsonrpc: '2.0', id: String(_reqId++), method: 'initialize',
      params: {
        protocolVersion: MCP_VERSION,
        capabilities:    {},
        clientInfo:      { name: 'Vantage', version: '1.0.0' },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!initRes.ok) {
    const body = await initRes.text().catch(() => '')
    throw new Error(`MCP initialize failed ${initRes.status}: ${body.slice(0, 300)}`)
  }

  const sessionId = initRes.headers.get('mcp-session-id') ?? null
  console.log(`[mcp] Session established for "${server.name}" — sessionId=${sessionId ?? 'none'}`)

  const sessionHdrs = sessionId ? { ...hdrs, 'Mcp-Session-Id': sessionId } : hdrs

  // 2. notifications/initialized  (fire-and-forget)
  fetch(server.url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...sessionHdrs },
    body:    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => {})

  _sessions.set(key, { sessionId })
  return sessionHdrs
}

/** Slugify a server name for use as a tool-name prefix */
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24)
}

// ── Public API ───────────────────────────────────────────────────

/**
 * List all tools from an MCP server, converted to Anthropic input_schema format.
 * Performs the initialize handshake on first call; reuses the session thereafter.
 */
export async function getToolsFromServer(server) {
  try {
    const sessionHdrs = await ensureSession(server)
    const result      = await post(server.url, 'tools/list', {}, sessionHdrs)
    const tools       = result?.tools ?? []
    const prefix      = `mcp_${slug(server.name)}_`

    console.log(`[mcp] "${server.name}" offers ${tools.length} tool(s): ${tools.map(t => t.name).join(', ')}`)

    return tools.map(t => ({
      name:         prefix + t.name,
      description:  `[${server.name}] ${t.description ?? t.name}`,
      input_schema: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
      _mcpServerId:   server.id,
      _mcpServerUrl:  server.url,
      _mcpAuthHeader: server.auth_header,
      _mcpToolName:   t.name,
    }))
  } catch (err) {
    // Clear cached session so next attempt retries the handshake
    _sessions.delete(sessionKey(server))
    console.warn(`[mcp] Could not list tools from "${server.name}": ${err.message}`)
    return []
  }
}

/**
 * Call an MCP tool and return a plain-text result string.
 */
export async function callMCPTool(server, toolName, args) {
  const sessionHdrs = await ensureSession(server)
  const result      = await post(
    server.url,
    'tools/call',
    { name: toolName, arguments: args ?? {} },
    sessionHdrs
  )
  const content = result?.content ?? []
  const text    = content.filter(c => c.type === 'text').map(c => c.text).join('\n')
  return text || JSON.stringify(result)
}

/**
 * Test-connect: initialize + list tools.
 * Returns { ok, toolCount, toolNames, error }.
 */
export async function testServer(server) {
  // Clear any stale session so we always do a fresh handshake on test
  _sessions.delete(sessionKey(server))
  try {
    const tools = await getToolsFromServer(server)
    return { ok: true, toolCount: tools.length, toolNames: tools.map(t => t._mcpToolName) }
  } catch (err) {
    return { ok: false, toolCount: 0, toolNames: [], error: err.message }
  }
}
