import { expect, test } from 'claude-code/testing'

import { accountFromConfig, accountPart, maskEmail, crossed, planLabel, report, resetAt, statusLine, tokens } from './format'

// 2026-10-19 06:00 UTC = 01:00 in Bogotá.
const NOW = Date.parse('2026-10-19T06:00:00Z')

test('tokens are shortened to k and M', () => {
  expect(tokens(950)).toBe('950')
  expect(tokens(112_400)).toBe('112k')
  expect(tokens(1_000_000)).toBe('1.0M')
})

test('a reset within a day shows only the Bogotá time, a later one the weekday too', () => {
  expect(resetAt('2026-10-19T09:25:00Z', NOW)).toBe('04:25')
  expect(resetAt('2026-10-24T21:07:00Z', NOW)).toBe('sáb 16:07')
  expect(resetAt(undefined, NOW)).toBe(undefined)
  expect(resetAt('not a date', NOW)).toBe(undefined)
})

test('the status line joins context, both windows and cost', () => {
  const line = statusLine(
    { tokens: 112_400, window: 200_000, percent: 56 },
    [
      { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-19T09:25:00Z' },
      { kind: 'seven_day', percentUsed: 45, resetsAt: '2026-10-24T21:07:00Z' },
    ],
    { usd: 1.234 },
    NOW,
  )
  expect(line).toBe('ctx 112k/200k (56%) · 5h 92% → 04:25 · semana 45% → sáb 16:07 · US$1.23')
})

test('before the first response the context shows a dash and no limits', () => {
  expect(statusLine({ window: 200_000 }, [], undefined, NOW)).toBe('ctx –/200k')
})

test('a toast threshold fires once, on the highest one crossed', () => {
  expect(crossed(undefined, 50)).toBe(undefined)
  expect(crossed(70, 85)).toBe(80)
  expect(crossed(85, 86)).toBe(undefined)
  expect(crossed(79, 95)).toBe(90)
  expect(crossed(undefined, 92)).toBe(90)
})

test('the report says when there are no limit readings yet', () => {
  expect(report({ window: 200_000 }, [], undefined, NOW)).toContain('sin datos todavía')
})

test('the plan label carries the rate-limit multiplier', () => {
  expect(planLabel('claude_max', 'default_claude_max_5x')).toBe('Max 5x')
  expect(planLabel('claude_max', 'default_claude_max_20x')).toBe('Max 20x')
  expect(planLabel('claude_pro', undefined)).toBe('Pro')
  expect(planLabel('claude_new_plan', undefined)).toBe('claude_new_plan')
  expect(planLabel(undefined, 'x')).toBe(undefined)
})

test('the account takes only email and plan from the config', () => {
  const config = JSON.stringify({
    oauthAccount: {
      emailAddress: 'persona@example.com',
      organizationType: 'claude_max',
      organizationRateLimitTier: 'default_claude_max_5x',
      accountUuid: 'not-shown',
    },
    projects: { '/x': {} },
  })
  expect(accountFromConfig(config)).toEqual({ email: 'persona@example.com', plan: 'Max 5x' })
  expect(accountFromConfig('{}')).toEqual({})
})

test('the email domain never reaches the screen', () => {
  expect(maskEmail('persona@example.com')).toBe('persona@•••')
  expect(maskEmail('sin-arroba')).toBe('sin-arroba')
  expect(accountPart({ email: 'a.b@empresa.co', plan: 'Pro' })).not.toContain('empresa')
})

test('the account leads the status line and the report', () => {
  const account = { email: 'persona@example.com', plan: 'Max 5x' }
  expect(statusLine({ window: 200_000 }, [], undefined, NOW, account)).toBe('persona@••• Max 5x · ctx –/200k')
  expect(report({ window: 200_000 }, [], undefined, NOW, null, account)).toContain('Cuenta: persona@••• Max 5x')
  expect(report({ window: 200_000 }, [], undefined, NOW)).toContain('Cuenta: no disponible')
})
