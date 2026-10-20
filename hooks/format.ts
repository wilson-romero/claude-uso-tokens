import type { ModelUsage, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { CodexLimits } from './codex'

// Bogotá has no daylight saving time: UTC-5 all year.
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const KIND_LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'semana', spend_limit: 'gasto' }

export const THRESHOLDS = [80, 90] as const

export type Account = { email?: string; plan?: string }

const PLAN_LABEL: Record<string, string> = {
  claude_pro: 'Pro',
  claude_max: 'Max',
  claude_team: 'Team',
  claude_enterprise: 'Enterprise',
}

// "claude_max" + "default_claude_max_5x" -> "Max 5x"; an unknown type is shown as given.
export const planLabel = (type: string | undefined, tier: string | undefined) => {
  if (!type) return undefined
  const name = PLAN_LABEL[type] ?? type
  const multiplier = tier?.match(/_(\d+x)$/)?.[1]
  return multiplier ? `${name} ${multiplier}` : name
}

// The oauthAccount block of ~/.claude.json, reduced to the two fields shown.
export const accountFromConfig = (text: string): Account => {
  const parsed: unknown = JSON.parse(text)
  const raw = (parsed as { oauthAccount?: Record<string, unknown> } | null)?.oauthAccount
  if (!raw) return {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return {
    email: str(raw.emailAddress),
    plan: planLabel(str(raw.organizationType), str(raw.organizationRateLimitTier)),
  }
}

// The domain names the employer or the provider, so it stays out of screenshots.
export const maskEmail = (email: string) => email.replace(/@.*$/, '@•••')

export const accountPart = (account: Account | undefined) =>
  account && (account.email || account.plan)
    ? [account.email && maskEmail(account.email), account.plan].filter(Boolean).join(' ')
    : undefined

const pad = (n: number) => String(n).padStart(2, '0')

export const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const label = (kind: string) => KIND_LABEL[kind] ?? kind

// "04:25" when the reset is within a day of `now`, otherwise "sáb 16:07".
export const resetAt = (iso: string | undefined, now: number) => {
  if (!iso) return undefined
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return undefined
  const local = new Date(at + BOGOTA_OFFSET_MS)
  const hhmm = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
  return at - now < 24 * 60 * 60 * 1000 ? hhmm : `${WEEKDAYS[local.getUTCDay()]} ${hhmm}`
}

export const contextPart = (context: SessionContextUsage) =>
  context.tokens === undefined
    ? `ctx –/${tokens(context.window)}`
    : `ctx ${tokens(context.tokens)}/${tokens(context.window)} (${context.percent ?? 0}%)`

export const limitPart = (limit: SessionRateLimit, now: number) => {
  const reset = resetAt(limit.resetsAt, now)
  return `${label(limit.kind)} ${limit.percentUsed}%${reset ? ` → ${reset}` : ''}`
}

export const codexPart = (codex: CodexLimits | undefined, now: number) =>
  codex && codex.windows.length ? `Codex ${codex.windows.map(l => limitPart(l, now)).join(' · ')}` : undefined

export const costPart = (cost: SessionCost | undefined) =>
  cost === undefined ? undefined : `US$${cost.usd.toFixed(2)}`

export const statusLine = (
  context: SessionContextUsage,
  rateLimits: SessionRateLimit[],
  cost: SessionCost | undefined,
  now: number,
  account?: Account,
  codex?: CodexLimits,
) =>
  [accountPart(account), contextPart(context), ...rateLimits.map(l => limitPart(l, now)), codexPart(codex, now), costPart(cost)]
    .filter(Boolean)
    .join(' · ')

// The highest threshold a window crossed since `before`, or undefined.
export const crossed = (before: number | undefined, after: number) => {
  const passed = THRESHOLDS.filter(t => after >= t && (before === undefined || before < t))
  return passed.length ? passed[passed.length - 1] : undefined
}

export const report = (
  context: SessionContextUsage,
  rateLimits: SessionRateLimit[],
  cost: SessionCost | undefined,
  now: number,
  last?: ModelUsage | null,
  account?: Account,
  codex?: CodexLimits,
) => {
  const lines = ['Uso de esta sesión', '']
  const who = accountPart(account)
  lines.push(`Cuenta: ${who ?? 'no disponible'}`, '')
  lines.push(`Contexto: ${contextPart(context).replace(/^ctx /, '')}`)
  if (last) {
    const u = last
    lines.push(
      `  última respuesta: ${tokens(u.input_tokens)} entrada, ${tokens(u.cache_read_input_tokens)} de caché, ` +
        `${tokens(u.cache_creation_input_tokens)} escritos en caché, ${tokens(u.output_tokens)} salida`,
    )
  }
  lines.push('', 'Límites del plan:')
  if (rateLimits.length === 0) lines.push('  sin datos todavía (llegan con la primera respuesta, solo en suscripción)')
  for (const l of rateLimits) {
    const reset = resetAt(l.resetsAt, now)
    lines.push(`  ${label(l.kind)}: ${l.percentUsed}% usado${reset ? `, se reinicia ${reset} (Bogotá)` : ''}`)
  }
  lines.push('', `Límites de Codex${codex?.plan ? ` (plan ${codex.plan})` : ''}:`)
  if (!codex || codex.windows.length === 0) lines.push('  sin lectura (¿codex instalado y con sesión iniciada?)')
  for (const l of codex?.windows ?? []) {
    const reset = resetAt(l.resetsAt, now)
    lines.push(`  ${label(l.kind)}: ${l.percentUsed}% usado${reset ? `, se reinicia ${reset} (Bogotá)` : ''}`)
  }
  if (codex?.resetCredits !== undefined)
    lines.push(`  reinicios gratuitos disponibles: ${codex.resetCredits} (este mod nunca los usa)`)
  const c = costPart(cost)
  if (c) lines.push('', `Coste estimado de la sesión: ${c}`)
  return lines.join('\n')
}
