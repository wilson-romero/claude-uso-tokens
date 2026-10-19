import type { SessionRateLimit } from 'claude-code'

export type CodexLimits = {
  plan?: string
  windows: SessionRateLimit[]
  resetCredits?: number
}

// `codex app-server` speaks JSON-RPC over stdio and exits as soon as its input
// closes, before answering: the requests go in and the input stays open six
// seconds. account/rateLimits/read reads the plan's usage without spending it.
// Never call account/rateLimitResetCredit/consume: it burns a free reset.
const REQUESTS = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'uso-tokens', version: '1' } } },
  { jsonrpc: '2.0', method: 'initialized' },
  { jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' },
]

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export const CODEX_SCRIPT = `{ printf '%s\\n' ${REQUESTS.map(r => quote(JSON.stringify(r))).join(' ')}; sleep 6; } | codex app-server 2>/dev/null`

type Window = { usedPercent?: number; resetsAt?: number }

const toLimit = (kind: string, w: Window | undefined): SessionRateLimit | undefined =>
  w && typeof w.usedPercent === 'number'
    ? {
        kind,
        percentUsed: w.usedPercent,
        resetsAt: typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000).toISOString() : undefined,
      }
    : undefined

// The answer to request 2, out of the server's line-per-message output.
export const parseCodexLimits = (stdout: string): CodexLimits | undefined => {
  for (const line of stdout.split('\n')) {
    let msg: { id?: number; result?: Record<string, unknown> }
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id !== 2 || !msg.result) continue
    const rl = msg.result.rateLimits as { primary?: Window; secondary?: Window; planType?: string } | undefined
    if (!rl) return undefined
    const credits = msg.result.rateLimitResetCredits as { availableCount?: number } | undefined
    return {
      plan: typeof rl.planType === 'string' ? rl.planType : undefined,
      windows: [toLimit('five_hour', rl.primary), toLimit('seven_day', rl.secondary)].filter(
        (w): w is SessionRateLimit => w !== undefined,
      ),
      resetCredits: typeof credits?.availableCount === 'number' ? credits.availableCount : undefined,
    }
  }
  return undefined
}
