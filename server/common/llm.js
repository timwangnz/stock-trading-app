/**
 * server/llm.js
 * Multi-provider LLM adapter.
 * Normalises Anthropic, OpenAI, Google Gemini, and local Ollama into one interface.
 *
 * All tool definitions are passed in Anthropic format (input_schema).
 * This module converts them to each provider's native format and parses
 * the response back into a unified { text, toolName, toolInput } object.
 *
 * Supported providers: 'anthropic' | 'openai' | 'google' | 'ollama'
 *
 * Ollama notes:
 *  - Calls http://localhost:11434 (or OLLAMA_URL env var) — no API key needed
 *  - Supports tool use for compatible models (gemma3, llama3, mistral…)
 *  - Falls back to JSON extraction from text if tool call is not returned
 */

const OLLAMA_BASE = process.env.OLLAMA_URL ?? 'http://localhost:11434'

// ── Provider model lists (shown in the UI settings) ──────────────
export const PROVIDERS = {
  anthropic: {
    label:  'Anthropic (Claude)',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fast & cheap' },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6 — balanced'    },
      { id: 'claude-opus-4-6',           label: 'Claude Opus 4.6 — most capable'  },
    ],
  },
  openai: {
    label:  'OpenAI (GPT)',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini — fast & cheap' },
      { id: 'gpt-4o',      label: 'GPT-4o — balanced'          },
      { id: 'o1-mini',     label: 'o1 mini — reasoning'        },
    ],
  },
  google: {
    label:  'Google (Gemini)',
    models: [
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite — free tier, fastest' },
      { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash — free tier, balanced'     },
      { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro — paid only, most capable'   },
    ],
  },
  ollama: {
    label:  'Ollama (Local)',
    models: [
      { id: 'gemma4:26b-a4b-it-q4_K_M', label: 'Gemma 4 26B Q4 — default'   },
      { id: 'gemma4',                    label: 'Gemma 4 (latest)'            },
      { id: 'gemma3',                    label: 'Gemma 3'                     },
      { id: 'llama3',                    label: 'Llama 3'                     },
      { id: 'mistral',                   label: 'Mistral'                     },
      { id: 'qwen2.5',                   label: 'Qwen 2.5'                    },
    ],
  },
}

// ── Tool format converters ────────────────────────────────────────

/** Anthropic format → OpenAI function-calling format */
function toOpenAITools(tools) {
  if (!tools?.length) return []
  return tools.map(t => ({
    type: 'function',
    function: {
      name:        t.name,
      description: t.description,
      parameters:  t.input_schema,
    },
  }))
}

/** Anthropic format → Gemini functionDeclarations format */
function toGeminiTools(tools) {
  if (!tools?.length) return []
  return [{
    functionDeclarations: tools.map(t => ({
      name:        t.name,
      description: t.description,
      parameters:  t.input_schema,
    })),
  }]
}

// ── Provider call functions ───────────────────────────────────────

async function callAnthropic({ apiKey, model, systemPrompt, userMessage, tools }) {
  const key = apiKey
  if (!key) throw new Error('No API key configured. Please add your Anthropic API key in the Trading Agent settings (⚙️).')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system:     systemPrompt,
      tools,
      messages:   [{ role: 'user', content: userMessage }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
  const data = await res.json()

  const toolBlock = data.content?.find(b => b.type === 'tool_use')
  const textBlock = data.content?.find(b => b.type === 'text')
  return {
    text:      textBlock?.text ?? null,
    toolName:  toolBlock?.name ?? null,
    toolInput: toolBlock?.input ?? null,
  }
}

async function callOpenAI({ apiKey, model, systemPrompt, userMessage, tools }) {
  if (!apiKey) throw new Error('No OpenAI API key configured.')

  // o1 models don't support system messages or tools — fall back to user message
  const isO1 = model.startsWith('o1')
  const messages = isO1
    ? [{ role: 'user', content: `${systemPrompt}\n\n${userMessage}` }]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ]

  const body = { model, messages }
  if (!isO1) {
    body.tools        = toOpenAITools(tools)
    body.tool_choice  = 'auto'
    body.max_tokens   = 512
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const data = await res.json()

  const msg       = data.choices?.[0]?.message
  const toolCall  = msg?.tool_calls?.[0]
  return {
    text:      msg?.content ?? null,
    toolName:  toolCall?.function?.name ?? null,
    toolInput: toolCall ? JSON.parse(toolCall.function.arguments) : null,
  }
}

async function callGemini({ apiKey, model, systemPrompt, userMessage, tools }) {
  if (!apiKey) throw new Error('No Google API key configured.')

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const geminiTools = toGeminiTools(tools)

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents:           [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig:   { maxOutputTokens: 1024 },
  }
  if (geminiTools.length) {
    body.tools       = geminiTools
    body.tool_config = { function_calling_config: { mode: 'AUTO' } }
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Gemini ${res.status}: ${errText}`)
  }
  const data = await res.json()

  // Safety check — Gemini can return SAFETY or RECITATION finish reasons with no content
  const candidate = data.candidates?.[0]
  if (!candidate?.content) {
    const reason = candidate?.finishReason ?? 'unknown'
    throw new Error(`Gemini returned no content (finishReason: ${reason})`)
  }

  const parts    = candidate.content.parts ?? []
  const fnCall   = parts.find(p => p.functionCall)?.functionCall
  const textPart = parts.find(p => p.text)
  return {
    text:      textPart?.text ?? null,
    toolName:  fnCall?.name ?? null,
    toolInput: fnCall?.args ?? null,
  }
}

// ── Ollama JSON fallback ──────────────────────────────────────────
// When a local model returns plain text instead of a tool call, try to
// extract a JSON object from the response. Handles:
//   • ```json ... ``` fenced blocks
//   • bare { ... } objects anywhere in the text
//   • trailing commas and other minor LLM JSON quirks

/** Attempt light repairs on JSON that local models commonly produce */
function repairJson(s) {
  return s
    .replace(/,\s*([\]}])/g, '$1')   // trailing commas before ] or }
    .replace(/([{,]\s*)(\w+)\s*:/g,  // unquoted keys  { foo: }  →  { "foo": }
      (_, pre, key) => `${pre}"${key}":`)
}

export function extractJsonFromText(text, toolName) {
  if (!text) return null
  // Try fenced code block first
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw    = fenced ? fenced[1] : text
  // Find the outermost { ... }
  const start  = raw.indexOf('{')
  const end    = raw.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  const slice  = raw.slice(start, end + 1)
  // Try raw first, then with light repairs
  for (const attempt of [slice, repairJson(slice)]) {
    try {
      const parsed = JSON.parse(attempt)
      if (typeof parsed === 'object' && parsed !== null) {
        return { toolName, toolInput: parsed, text: null }
      }
    } catch { /* try next */ }
  }
  console.warn('[ollama] extractJsonFromText: all parse attempts failed — slice preview:', slice.slice(0, 300))
  return null
}

/**
 * Build a prompt suffix that instructs the model to reply with JSON
 * matching the first tool's input_schema. Used when the model doesn't
 * support native tool calling (e.g. Gemma3 via Ollama).
 */
function buildJsonInstructions(tools) {
  if (!tools?.length) return ''
  const tool       = tools[0]
  const props      = tool.input_schema?.properties ?? {}
  const propLines  = Object.entries(props)
    .map(([k, v]) => `  "${k}": ${v.type === 'array' ? '[…]' : `"${v.description ?? v.type}"`}`)
    .join(',\n')

  return `\n\nYou MUST respond with ONLY a valid JSON object — no explanation, no markdown, no extra text.
The JSON must match this structure exactly:
{
${propLines}
}
Do not include any text before or after the JSON object.`
}

async function callOllama({ model, systemPrompt, userMessage, tools }) {
  // Gemma3 (and most Ollama models) do not support native tool calling.
  // Instead, we embed the expected JSON schema in the system prompt and
  // parse the JSON out of the model's text response.
  const toolName      = tools?.[0]?.name ?? null
  const jsonInstructions = tools?.length ? buildJsonInstructions(tools) : ''

  const messages = [
    { role: 'system', content: systemPrompt + jsonInstructions },
    { role: 'user',   content: userMessage },
  ]

  const body = { model, messages, stream: false }

  let res
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`Ollama unreachable at ${OLLAMA_BASE} — is it running? (${err.message})`)
  }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  const data = await res.json()

  const text = data.message?.content ?? null

  // Try to extract structured JSON from the text response
  if (toolName && text) {
    const fallback = extractJsonFromText(text, toolName)
    if (fallback) return fallback
  }

  return { text, toolName: null, toolInput: null }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Call an LLM with tool support.
 * @param {object} cfg - { provider, model, apiKey }
 * @param {object} params - { systemPrompt, userMessage, tools }
 * @returns {{ text: string|null, toolName: string|null, toolInput: object|null }}
 */
export async function callLLM(cfg, params) {
  const { provider = 'anthropic', model, apiKey } = cfg
  switch (provider) {
    case 'anthropic': return callAnthropic({ apiKey, model, ...params })
    case 'openai':    return callOpenAI   ({ apiKey, model, ...params })
    case 'google':    return callGemini   ({ apiKey, model, ...params })
    case 'ollama':    return callOllama   ({ model, ...params })
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}
