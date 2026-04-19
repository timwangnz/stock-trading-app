/**
 * server/llm.js
 * Multi-provider LLM adapter.
 * Normalises Anthropic, OpenAI, and Google Gemini into one interface.
 *
 * All tool definitions are passed in Anthropic format (input_schema).
 * This module converts them to each provider's native format and parses
 * the response back into a unified { text, toolName, toolInput } object.
 *
 * Supported providers: 'anthropic' | 'openai' | 'google'
 */

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
      { id: 'gemini-2.0-flash',    label: 'Gemini 2.0 Flash — fast & cheap' },
      { id: 'gemini-1.5-flash',    label: 'Gemini 1.5 Flash — balanced'     },
      { id: 'gemini-1.5-pro',      label: 'Gemini 1.5 Pro — most capable'   },
    ],
  },
}

// ── Tool format converters ────────────────────────────────────────

/** Anthropic format → OpenAI function-calling format */
function toOpenAITools(tools) {
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
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents:           [{ role: 'user', parts: [{ text: userMessage }] }],
      tools:              toGeminiTools(tools),
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()

  const parts    = data.candidates?.[0]?.content?.parts ?? []
  const fnCall   = parts.find(p => p.functionCall)?.functionCall
  const textPart = parts.find(p => p.text)
  return {
    text:      textPart?.text ?? null,
    toolName:  fnCall?.name ?? null,
    toolInput: fnCall?.args ?? null,
  }
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
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}
