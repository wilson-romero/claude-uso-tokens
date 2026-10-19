import type { EngineInterface, Register, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import { CODEX_SCRIPT, type CodexLimits, parseCodexLimits } from './codex'
import { type Account, accountFromConfig, crossed, label, planLabel, report, statusLine } from './format'

const CODEX_EVERY_MS = 5 * 60 * 1000

type State = {
  // Last percentage seen per window, so a toast fires once per threshold crossed.
  seen: Record<string, number>
  account: Account
  codex?: CodexLimits
  codexAt: number
  isCodexBusy: boolean
  // The last Claude figures drawn, so a Codex reading can redraw the line.
  figures?: { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }
}

// $.session.identity() answers only a mod managed settings install; a personal mod
// gets { deny } and reads the same facts from the person's own ~/.claude.json.
const readAccount = async ($: EngineInterface): Promise<Account> => {
  const id = await $.session.identity()
  if (!id.deny && id.email) return { email: id.email, plan: planLabel(id.organizationType, undefined) }
  try {
    const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (await $.env.get('HOME'))
    return dir ? accountFromConfig(await $.fs.read(`${dir}/.claude.json`)) : {}
  } catch {
    return {}
  }
}

const readCodex = async ($: EngineInterface): Promise<CodexLimits | undefined> => {
  try {
    const { stdout } = await $.process.run(['/bin/sh', '-c', CODEX_SCRIPT], { timeoutMs: 20_000 })
    return parseCodexLimits(stdout)
  } catch {
    return undefined
  }
}

const draw = async ($: EngineInterface, st: State) => {
  if (!st.figures) return
  const { context, rateLimits, cost } = st.figures
  $.ui.status(statusLine(context, rateLimits, cost, await $.clock.now(), st.account, st.codex))
}

const toastCrossings = ($: EngineInterface, st: State, prefix: string, windows: SessionRateLimit[]) => {
  for (const l of windows) {
    const key = `${prefix}${l.kind}`
    const hit = crossed(st.seen[key], l.percentUsed)
    if (hit !== undefined) $.ui.toast(`${prefix ? 'Codex' : 'Límite'} ${label(l.kind)} al ${l.percentUsed}% (pasó el ${hit}%)`)
    st.seen[key] = l.percentUsed
  }
}

// At most one read every five minutes; a read in flight is not started twice.
const refreshCodex = async ($: EngineInterface, st: State, isForced = false) => {
  const now = await $.clock.now()
  if (st.isCodexBusy || (!isForced && now - st.codexAt < CODEX_EVERY_MS)) return
  st.isCodexBusy = true
  try {
    const read = await readCodex($)
    st.codexAt = now
    if (read) {
      toastCrossings($, st, 'codex.', read.windows)
      st.codex = read
      await draw($, st)
    }
  } finally {
    st.isCodexBusy = false
  }
}

export const register: Register = on => {
  const st: State = { seen: {}, account: {}, codexAt: 0, isCodexBusy: false }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'uso', description: 'Uso de tokens, límites del plan y de Codex, y coste de la sesión' })
    st.account = await readAccount($)
    const usage = await $.session.usage()
    for (const l of usage.rateLimits) st.seen[l.kind] = l.percentUsed
    st.figures = { context: usage.context, rateLimits: usage.rateLimits, cost: usage.cost }
    await draw($, st)
    void refreshCodex($, st)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    toastCrossings($, st, '', e.rateLimits)
    st.figures = { context: e.context, rateLimits: e.rateLimits, cost: e.cost }
    await draw($, st)
    void refreshCodex($, st)
    return next(e)
  })

  on('command.run', { command: 'uso' }, async $ => {
    // 'summary' is estimated locally and sends no request: it costs nothing.
    const usage = await $.session.usage({ breakdown: 'summary' })
    const last = usage.context.breakdown?.apiUsage
    st.account = await readAccount($)
    await refreshCodex($, st, true)
    const now = await $.clock.now()
    return { text: report(usage.context, usage.rateLimits, usage.cost, now, last, st.account, st.codex) }
  })
}
