import { expect, test } from 'claude-code/testing'

import { CODEX_SCRIPT, parseCodexLimits } from './codex'
import { codexPart, report, statusLine } from './format'

const NOW = Date.parse('2026-10-19T06:00:00Z')

const answer = JSON.stringify({
  id: 2,
  result: {
    rateLimits: {
      primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: Date.parse('2026-10-19T09:25:00Z') / 1000 },
      secondary: { usedPercent: 64, windowDurationMins: 10080, resetsAt: Date.parse('2026-10-24T21:07:00Z') / 1000 },
      planType: 'plus',
    },
    rateLimitResetCredits: { availableCount: 2, credits: [] },
  },
})
const stdout = ['{"id":1,"result":{}}', 'not json', answer, ''].join('\n')

test('the rate-limit answer is found among the server lines', () => {
  const codex = parseCodexLimits(stdout)
  expect(codex?.plan).toBe('plus')
  expect(codex?.resetCredits).toBe(2)
  expect(codex?.windows).toEqual([
    { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-19T09:25:00.000Z' },
    { kind: 'seven_day', percentUsed: 64, resetsAt: '2026-10-24T21:07:00.000Z' },
  ])
})

test('no answer, or an error, gives no reading', () => {
  expect(parseCodexLimits('')).toBe(undefined)
  expect(parseCodexLimits('{"id":2,"error":{"message":"not logged in"}}')).toBe(undefined)
})

test('Codex follows the Claude windows in the status line', () => {
  const codex = parseCodexLimits(stdout)
  expect(codexPart(codex, NOW)).toBe('Codex 5h 30% → 04:25 · semana 64% → sáb 16:07')
  expect(statusLine({ window: 200_000 }, [], { usd: 1 }, NOW, undefined, codex)).toBe(
    'ctx –/200k · Codex 5h 30% → 04:25 · semana 64% → sáb 16:07 · US$1.00',
  )
})

test('the report names the Codex plan and the free resets, and says when there is no reading', () => {
  const text = report({ window: 200_000 }, [], undefined, NOW, null, undefined, parseCodexLimits(stdout))
  expect(text).toContain('Límites de Codex (plan plus):')
  expect(text).toContain('reinicios gratuitos disponibles: 2 (este mod nunca los usa)')
  expect(report({ window: 200_000 }, [], undefined, NOW)).toContain('sin lectura')
})

test('the script only reads the limits, it never consumes a reset', () => {
  expect(CODEX_SCRIPT).toContain('account/rateLimits/read')
  expect(CODEX_SCRIPT).not.toContain('rateLimitResetCredit/consume')
})
