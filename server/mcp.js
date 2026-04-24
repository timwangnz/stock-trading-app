/**
 * server/mcp.js
 * Lightweight MCP (Model Context Protocol) HTTP client.
 *
 * Supports the Streamable HTTP transport (2024-11-05 spec).
 * Each request is stateless — no session management required for most servers.
 *
 * Flow:
 *   1. getToolsFromServer(serverConfig) — returns tools in Anthropic format
 *   2. callMCPTool(serverConfig, toolName, args) — executes a tool, returns text
 */

const MCP_VERSION = '2024-11-05'
let   _reqId      = 1

// ── Internal helpers ─────────────────────────────────────────────

function authHeaders(server) {
  if (!server.auth_header?.trim()) return {}
  // auth_header stored as "HeaderName: value", e.g. "Authorization: Bearer tok"
  const colon = server.auth_header.indexOf(':')
  if (colon === -1) return {}
  return { [server.auth_header.slice(0, colon).trim()]: server.auth_header.slice(colon + 1).trim() }
}

/** Parse an SSE response body and collect the last result object */
async function parseSSE(res) {
  const text  = await res.text()
  let result  = null
  let error   = null
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    try {
      const obj = JSON.parse(line.slice(6))
      if (obj.error)                          error  = obj.error
      if (obj.result !== undefined)           result = obj.result
      // Unwrap JSON-RPC envelope if present
      if (obj.jsonrpc && obj.result !== undefined) result = obj.result
    } catch { /* skip malformed event */ }
  }
  if (error) throw new Error(`MCP error ${error.code ?? ''}: ${error.message}`)
  return result
}

/** Send a single JSON-RPC 2.0 request and return the result */
async function jsonrpc(url, method, params, extra = {}) {
  const id  = (_reqId++).toString()
  let   res
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json, text/event-stream',
        ...extra,
      },
      body:    JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal:  AbortSignal.timeout(15_000),
    })
  } catch (err) {
    throw new Error(`MCP fetch failed: ${err.message}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`MCP ${res.status}: ${body.slice(0, 200)}`)
  }

  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/event-stream')) return parseSSE(res)

  const data = await res.json()
  if (data.error) throw new Error(`MCP error ${data.error.code ?? ''}: ${data.error.message}`)
  return data.result
}

/** Slugify a server name for use as a tool name prefix */
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24)
}

// ── Public API ───────────────────────────────────────────────────

/**
 * List all tools from an MCP server, converted to Anthropic input_schema format.
 * Each tool's name is prefixed with `mcp_{serverSlug}_` to avoid clashes.
 * The original name and server id are stored in _mcp* meta fields for routing.
 *
 * @param {object} server - row from mcp_servers table
 * @returns {Array} tools in Anthropic format (with extra _mcp* fields)
 */
export async function getToolsFromServer(server) {
  try {
    const hdrs   = authHeaders(server)
    const result = await jsonrpc(server.url, 'tools/list', {}, hdrs)
    const tools  = result?.tools ?? []
    const prefix = `mcp_${slug(server.name)}_`

    return tools.map(t => ({
      name:         prefix + t.name,
      description:  `[${server.name}] ${t.description ?? t.name}`,
      input_schema: t.inputSchema ?? { type: 'object', properties: {}, required: [] },
      // Routing metadata (not sent to LLM)
      _mcpServerId:   server.id,
      _mcpServerUrl:  server.url,
      _mcpAuthHeader: server.auth_header,
      _mcpToolName:   t.name,
    }))
  } catch (err) {
    console.warn(`[mcp] Could not list tools from "${server.name}" (${server.url}): ${err.message}`)
    return []
  }
}

/**
 * Call an MCP tool and return a plain-text result.
 * @param {object} server  - row from mcp_servers (must have url, auth_header)
 * @param {string} toolName - original tool name (without the mcp_ prefix)
 * @param {object} args    - tool arguments
 * @returns {string}
 */
export async function callMCPTool(server, toolName, args) {
  const hdrs   = authHeaders(server)
  const result = await jsonrpc(server.url, 'tools/call', { name: toolName, arguments: args ?? {} }, hdrs)

  // MCP returns content as array: [{ type: 'text', text: '...' }, ...]
  const content = result?.content ?? []
  return content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n') || JSON.stringify(result)
}

/**
 * Test-connect to a server: initialize handshake + tool list.
 * Returns { ok, tools, error }.
 */
export async function testServer(server) {
  try {
    const tools = await getToolsFromServer(server)
    return { ok: true, tools, toolCount: tools.length }
  } catch (err) {
    return { ok: false, tools: [], error: err.message }
  }
}
