/**
 * ollama.js
 * Client for the local Ollama API (http://localhost:11434).
 *
 * Uses the OpenAI-compatible /v1/chat/completions endpoint
 * with streaming so responses appear token-by-token.
 *
 * Usage:
 *   import { streamOllamaChat } from './ollama'
 *   await streamOllamaChat({ model, messages, onToken, onDone, onError })
 */

const OLLAMA_BASE = 'http://localhost:11434'

/**
 * Check whether Ollama is reachable.
 * Returns true if the server responds, false otherwise.
 */
export async function isOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Stream a chat completion from a local Ollama model.
 *
 * @param {object} opts
 * @param {string}   opts.model      - Ollama model name, e.g. "gemma3"
 * @param {Array}    opts.messages   - OpenAI-style message array [{ role, content }]
 * @param {Function} opts.onToken    - called with each text chunk as it arrives
 * @param {Function} [opts.onDone]   - called with the full response text when finished
 * @param {Function} [opts.onError]  - called with an Error if something goes wrong
 * @param {AbortSignal} [opts.signal] - optional AbortSignal to cancel the request
 */
export async function streamOllamaChat({ model = 'gemma3', messages, onToken, onDone, onError, signal }) {
  try {
    const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Ollama error ${res.status}: ${errText}`)
    }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let   full    = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Each chunk may contain multiple SSE lines
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

      for (const line of lines) {
        const jsonStr = line.slice(6).trim()
        if (jsonStr === '[DONE]') continue

        try {
          const parsed  = JSON.parse(jsonStr)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            full += content
            onToken(content)
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    onDone?.(full)
  } catch (err) {
    if (err.name === 'AbortError') return
    onError?.(err)
  }
}
