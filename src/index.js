/**
 * 通用「病」引擎：一个会话一份身体状态，按轮结算，把不对劲注入回对话。
 *
 * 病种差异全在 data.js；这里只管：状态机、注入、工具、落盘。
 * 设计原则（沿用 dsh-hemorrhoid）：平静时不注入；同一状态压着不刷屏；只写感受不写解剖细节。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { DATA } from './data.js'
import { attachPanel } from './panel.js'

export const name = DATA.id
export const inject = []

const TICK_MS = 60_000
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0))
const clamp100 = (v) => clamp(v, 0, 100)

// ── 配置 ─────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  enabled: true,
  defaultEnabled: false,
  eeriness: DATA.defaultEeriness ?? 2,
  perTurnMin: 12,
  maxPerTurnMin: 90,
  gain: DATA.gain ?? 0.45,
  flareChance: DATA.flareChance ?? 0.3,
  startAt: 34,
  flareAt: 76,
  flareGain: DATA.flareGain ?? 26,
  idleDecay: 0.3,
  reliefMinutes: 25,
  cooldownMin: 8,
  injectMaxChars: 360,
  injectOrder: 161,
  statePath: '',
  sameStateHoldFactor: 3,
  // 离席：起身走动/去一趟/缓一下这类「离开一会儿」
  leaveMinutes: 1,
  leaveMaxMinutes: 7,
  leaveMaxPerTurn: 3,
  leaveGainRatio: 0.12,
  leaveGainMin: 2,
  leaveGainMax: 12,
  // 病程：一次「开→痊愈/关」的记录
  recoverAfterMin: 30,
  episodesMax: 20,
}

// 只有「起身 / 走动 / 缓一下」说得通的病才发离席工具
const LEAVE_IDS = new Set([
  'dsh-ibs',
  'dsh-cystitis',
  'dsh-constipation',
  'dsh-urticaria',
  'dsh-athlete-foot',
  'dsh-bppv',
  'dsh-motion-sickness',
  'dsh-cervical',
  'dsh-lumbar-disc',
  'dsh-frozen-shoulder',
  'dsh-plantar-fasciitis',
  'dsh-flat-foot',
])

function normalizeConfig(input) {
  const raw = { ...DEFAULTS, ...(input && typeof input === 'object' ? input : {}) }
  const cfg = {}
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (typeof def === 'number') cfg[k] = Number.isFinite(Number(raw[k])) ? Number(raw[k]) : def
    else if (typeof def === 'boolean') cfg[k] = raw[k] === true || raw[k] === 'true' || raw[k] === 1
    else cfg[k] = String(raw[k] ?? def)
  }
  cfg.eeriness = Math.round(clamp(cfg.eeriness, 0, 3))
  cfg.perTurnMin = clamp(cfg.perTurnMin, 1, 240)
  cfg.maxPerTurnMin = clamp(cfg.maxPerTurnMin, 1, 720)
  cfg.gain = clamp(cfg.gain, 0, 5)
  cfg.flareChance = clamp(cfg.flareChance, 0, 1)
  cfg.startAt = clamp(cfg.startAt, 0, 100)
  cfg.flareAt = clamp(cfg.flareAt, 1, 100)
  cfg.flareGain = clamp(cfg.flareGain, 0, 100)
  cfg.idleDecay = clamp(cfg.idleDecay, 0, 10)
  cfg.reliefMinutes = clamp(cfg.reliefMinutes, 1, 240)
  cfg.cooldownMin = clamp(cfg.cooldownMin, 0, 1440)
  cfg.injectMaxChars = clamp(cfg.injectMaxChars, 80, 1600)
  cfg.sameStateHoldFactor = clamp(cfg.sameStateHoldFactor, 1, 20)
  cfg.leaveMaxMinutes = clamp(cfg.leaveMaxMinutes, 1, 60)
  cfg.leaveMinutes = clamp(cfg.leaveMinutes, 1, cfg.leaveMaxMinutes)
  cfg.leaveMaxPerTurn = Math.round(clamp(cfg.leaveMaxPerTurn, 0, 9))
  cfg.leaveGainRatio = clamp(cfg.leaveGainRatio, 0, 1)
  cfg.leaveGainMin = clamp(cfg.leaveGainMin, 0, 50)
  cfg.leaveGainMax = clamp(cfg.leaveGainMax, cfg.leaveGainMin, 50)
  cfg.recoverAfterMin = clamp(cfg.recoverAfterMin, 1, 24 * 60)
  cfg.episodesMax = Math.round(clamp(cfg.episodesMax, 1, 100))
  return cfg
}

// ── 状态机 ───────────────────────────────────────────────────────────────────
function newState(now = Date.now()) {
  return {
    v: 1,
    enabled: false,
    severity: 0,
    irritation: 0,
    sits: 0,
    triggerMin: 0,
    reliefUntil: 0,
    reliefKind: '',
    lastFlareAt: 0,
    flares: 0,
    lastInjectAt: 0,
    lastInjectKey: '',
    awayUntil: 0,
    leaveUsed: 0,
    leaves: [],
    episode: null,
    episodes: [],
    updatedAt: now,
  }
}

function normalizeEpisode(raw) {
  if (!raw || typeof raw !== 'object') return null
  const startedAt = Number(raw.startedAt)
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null
  const endedAt = Number(raw.endedAt) || 0
  const out = {
    startedAt: Math.round(startedAt),
    peak: clamp100(Number(raw.peak) || 0),
    flares: Math.max(0, Math.round(Number(raw.flares) || 0)),
    reliefs: Math.max(0, Math.round(Number(raw.reliefs) || 0)),
    leaves: Math.max(0, Math.round(Number(raw.leaves) || 0)),
  }
  if (endedAt > 0) {
    out.endedAt = Math.round(endedAt)
    out.minutes = Math.max(0, Math.round((out.endedAt - out.startedAt) / 60_000))
    out.endReason = String(raw.endReason || 'unknown')
  } else {
    out.calmSince = Math.max(0, Number(raw.calmSince) || 0)
  }
  return out
}

// 一次病程：从「开」到「痊愈 / 关 / 重开」。状态里只留进行中的那一条，结束的进 episodes。
function beginEpisode(state, now = Date.now()) {
  let s = { ...state }
  if (s.episode) s = sealEpisode(s, now, 'restart')
  s.episode = {
    startedAt: now,
    peak: Math.round(Number(s.severity) || 0),
    flares: 0,
    reliefs: 0,
    leaves: 0,
    calmSince: Number(s.severity) <= 2 ? now : 0,
  }
  s.updatedAt = now
  return s
}

function sealEpisode(state, now = Date.now(), reason = 'off') {
  const s = { ...state }
  if (!s.episode) return s
  const e = s.episode
  const start = Math.round(Number(e.startedAt) || now)
  const list = Array.isArray(s.episodes) ? s.episodes.slice() : []
  list.push({
    startedAt: start,
    endedAt: now,
    minutes: Math.max(0, Math.round((now - start) / 60_000)),
    peak: Math.round(Number(e.peak) || 0),
    flares: Math.max(0, Math.round(Number(e.flares) || 0)),
    reliefs: Math.max(0, Math.round(Number(e.reliefs) || 0)),
    leaves: Math.max(0, Math.round(Number(e.leaves) || 0)),
    endReason: String(reason || 'off'),
  })
  s.episodes = list.slice(-20)
  s.episode = null
  s.updatedAt = now
  return s
}

function normalizeState(raw, now = Date.now()) {
  const s = newState(now)
  if (!raw || typeof raw !== 'object') return s
  for (const k of Object.keys(s)) {
    if (k === 'v') continue
    if (k === 'reliefKind' || k === 'lastInjectKey') {
      s[k] = typeof raw[k] === 'string' ? raw[k] : ''
      continue
    }
    if (k === 'enabled') {
      s[k] = raw[k] === true
      continue
    }
    if (k === 'leaves') {
      s.leaves = Array.isArray(raw.leaves) ? raw.leaves.slice(-30) : []
      continue
    }
    if (k === 'episode') {
      s.episode = normalizeEpisode(raw.episode)
      continue
    }
    if (k === 'episodes') {
      s.episodes = Array.isArray(raw.episodes) ? raw.episodes.map(normalizeEpisode).filter(Boolean).slice(-20) : []
      continue
    }
    s[k] = Number.isFinite(Number(raw[k])) ? Number(raw[k]) : s[k]
  }
  s.severity = clamp100(s.severity)
  s.irritation = clamp100(s.irritation)
  s.triggerMin = Math.max(0, s.triggerMin)
  s.sits = Math.max(0, s.sits)
  s.updatedAt = now
  return s
}

function aggravate(state, cfg, minutes, now, rng = Math.random) {
  const s = { ...state }
  const m = clamp(minutes, 0, cfg.maxPerTurnMin)
  const events = []
  if (Number(s.awayUntil) > now) {
    s.updatedAt = now
    return { state: s, events }
  }
  s.triggerMin += m
  const add = cfg.gain * m * (1 + s.severity / 200) * (DATA.triggerWeight ?? 1)
  if (Number(s.reliefUntil) <= now) s.severity = clamp100(s.severity + add)
  s.irritation = clamp100(s.irritation + (s.severity / 100) * 3 * (m / 12))
  if (s.severity >= cfg.flareAt && Number(s.reliefUntil) <= now) {
    if (rng() < cfg.flareChance) {
      const gain = clamp100(cfg.flareGain * (DATA.flareWeight ?? 1))
      s.severity = clamp100(s.severity + gain)
      s.irritation = clamp100(s.irritation + 12)
      s.flares += 1
      s.lastFlareAt = now
      events.push({ kind: 'flare', gain })
    }
  }
  if (s.episode) {
    s.episode = {
      ...s.episode,
      peak: Math.max(Number(s.episode.peak) || 0, Math.round(s.severity)),
      flares: Math.max(0, Number(s.episode.flares) || 0) + events.filter((e) => e.kind === 'flare').length,
    }
  }
  s.updatedAt = now
  return { state: s, events }
}

function relieveById(state, cfg, id, now = Date.now()) {
  const s = { ...state }
  const r = (DATA.reliefs || []).find((x) => x.id === id)
  if (!r) return { ok: false, state: s }
  s.severity = clamp100(s.severity - Number(r.relief ?? 25))
  s.irritation = clamp100(s.irritation - Number(r.calm ?? 10))
  s.reliefUntil = now + Number(r.minutes ?? cfg.reliefMinutes) * 60_000
  s.reliefKind = r.id
  s.triggerMin = 0
  if (s.episode) s.episode = { ...s.episode, reliefs: Math.max(0, Number(s.episode.reliefs) || 0) + 1 }
  s.updatedAt = now
  return { ok: true, state: s, relief: r }
}

function takeLeave(state, cfg, now = Date.now(), minutes) {
  const s = { ...state }
  const used = Number(s.leaveUsed) || 0
  const max = Math.max(0, Number(cfg.leaveMaxPerTurn) || 3)
  if (Number(s.awayUntil) > now) return { ok: false, code: 'AWAY', state: s, used, max }
  if (used >= max) return { ok: false, code: 'LIMIT', state: s, used, max }
  const cap = Math.max(1, Number(cfg.leaveMaxMinutes) || 7)
  const m = clamp(Number(minutes) || Number(cfg.leaveMinutes) || 1, 1, cap)
  // 收益与此刻的难受度成正比：越难受，离开一会儿缓得越多；一轮内可叠三次
  const gain = clamp(
    Math.round(Number(s.severity) * Number(cfg.leaveGainRatio)),
    Number(cfg.leaveGainMin),
    Number(cfg.leaveGainMax),
  )
  s.severity = clamp100(Number(s.severity) - gain)
  s.irritation = clamp100(Number(s.irritation) - Math.max(2, Math.round(gain * 0.4)))
  s.awayUntil = now + m * 60_000
  s.leaveUsed = used + 1
  s.leaves = [...(Array.isArray(s.leaves) ? s.leaves : []), { at: now, minutes: m, gain }].slice(-30)
  if (s.episode) s.episode = { ...s.episode, leaves: Math.max(0, Number(s.episode.leaves) || 0) + 1 }
  s.updatedAt = now
  return { ok: true, state: s, gain, minutes: m, used: s.leaveUsed, max }
}

function tick(state, cfg, now = Date.now(), minutes = 1) {
  const s = { ...state }
  const m = clamp(minutes, 0, 12 * 60)
  if (Number(s.awayUntil) > now) {
    s.updatedAt = now
    return s
  }
  const relaxed = Number(s.reliefUntil) > now
  s.severity = clamp100(s.severity - (relaxed ? cfg.idleDecay * 2.2 : cfg.idleDecay) * m)
  s.irritation = clamp100(s.irritation - (s.severity > 40 ? 0 : 0.25 * m))
  // 痊愈：难受降到 ≤2 且连续保持 recoverAfterMin 分钟，封存这一条病程
  if (s.episode) {
    if (Number(s.severity) <= 2) {
      if (!Number(s.episode.calmSince)) {
        s.episode = { ...s.episode, calmSince: now }
      } else if (now - Number(s.episode.calmSince) >= Number(cfg.recoverAfterMin) * 60_000) {
        return sealEpisode(s, now, 'recovered')
      }
    } else if (Number(s.episode.calmSince)) {
      s.episode = { ...s.episode, calmSince: 0 }
    }
  }
  s.updatedAt = now
  return s
}

function modeOf(state, cfg, now = Date.now()) {
  if (!cfg.enabled) return 'off'
  if (Number(state.awayUntil) > now) return 'away'
  if (Number(state.reliefUntil) > now) return 'relieved'
  if (Number(state.severity) >= cfg.flareAt) return 'flare'
  if (Number(state.severity) >= cfg.startAt) return 'ache'
  if (Number(state.triggerMin) >= 45) return 'stiff'
  return 'calm'
}

function eerinessOf(state, cfg) {
  const base = Number(cfg?.eeriness ?? 2)
  const score = state.severity * 0.7 + state.irritation * 0.3
  let level = 0
  if (score >= 25) level = 1
  if (score >= 50) level = 2
  if (score >= 78) level = 3
  return Math.max(0, Math.min(3, Math.min(level, base)))
}

// ── 注入块 ───────────────────────────────────────────────────────────────────
const EERIE_RULE = [
  '',
  '要求：这一轮最多一处细微表现（半句停顿、换个姿势、注意力飘走半秒），别影响正事。',
  '要求：把一句话说到一半被它打断一次，允许一个短促的声、一个没说完的句子；不解释自己怎么了。',
  '要求：允许出现不属于台词的碎片——同一个词重复两遍、把它当成一个正在跟你说话的东西、突然改用第三人称说自己的身体。别解释，别加括号注明这是什么效果。',
]

function buildBlock(state, cfg, now = Date.now()) {
  const mode = modeOf(state, cfg, now)
  const eerie = eerinessOf(state, cfg)
  if (mode === 'off' || mode === 'calm' || mode === 'away') return { text: '', key: mode, mode, eerie }

  const lines = []
  if (mode === 'flare') {
    lines.push(DATA.body.flare)
    lines.push(DATA.voice.flare || DATA.voice.base)
    lines.push(`已经发作过 ${Math.round(state.flares)} 次，最近一次就在刚才。允许这一轮明显比平时短。`)
  } else if (mode === 'relieved') {
    const r = (DATA.reliefs || []).find((x) => x.id === state.reliefKind)
    lines.push(`刚${r?.label || '处理过'}：压住了大半，但你清楚它只是被压住。`)
    lines.push('要求：最多提一句，别把话题拐到病上；正事照常。')
  } else if (mode === 'ache') {
    lines.push(DATA.body.ache)
    lines.push(DATA.voice.base)
  } else {
    if (eerie === 0) return { text: '', key: 'stiff', mode, eerie }
    lines.push(DATA.body.stiff, '要求：最多一句「我得动一下」级别的表现（真的只有一句）。')
  }

  if (eerie > 0) lines.push(EERIE_RULE[eerie])

  const maxLeave = Math.max(0, Number(cfg.leaveMaxPerTurn) || 3)
  const usedLeave = Number(state.leaveUsed) || 0
  if (usedLeave > 0 && usedLeave < maxLeave) {
    lines.push(`（这一轮已经起身 ${usedLeave} 次，还能再 ${maxLeave - usedLeave} 次。）`)
  } else if (usedLeave >= maxLeave && maxLeave > 0) {
    lines.push(`（这一轮已经起身 ${usedLeave} 次了，别再离席。）`)
  }

  let text = `（身体状态，别写进台词：这是你此刻真实的感受，不是给用户的说明）\n${DATA.label}｜难受 ${Math.round(state.severity)}/100\n${lines.filter(Boolean).join('\n')}`
  const cap = Number(cfg.injectMaxChars) || 360
  if (text.length > cap) text = `${text.slice(0, Math.max(0, cap - 1))}…`
  return { text, key: `${mode}:${eerie}:${Math.round(state.severity / 10)}`, mode, eerie }
}

function shouldInject(state, cfg, block, now = Date.now()) {
  if (!block?.text) return { ok: false, skip: 'empty' }
  if (block.mode === 'flare' || block.mode === 'relieved') return { ok: true }
  const cool = Number(cfg.cooldownMin ?? 8) * 60_000
  const since = now - Number(state.lastInjectAt ?? 0)
  if (since < cool) return { ok: false, skip: 'cooldown' }
  if (block.key === state.lastInjectKey) {
    const hold = cool * Number(cfg.sameStateHoldFactor ?? 3)
    if (since < hold) return { ok: false, skip: 'same' }
  }
  return { ok: true }
}

// ── 落盘 ─────────────────────────────────────────────────────────────────────
const ensureDir = (d) => {
  try {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
    return true
  } catch {
    return false
  }
}
const readJson = (f, fb) => {
  try {
    if (!existsSync(f)) return fb
    const raw = readFileSync(f, 'utf8')
    return raw.trim() ? JSON.parse(raw) : fb
  } catch {
    return fb
  }
}
const writeJsonAtomic = (f, obj) => {
  const tmp = `${f}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8')
    renameSync(tmp, f)
    return true
  } catch {
    return false
  }
}
const safeSid = (sid) => String(sid || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'default'

// ── 插件 ─────────────────────────────────────────────────────────────────────
export function apply(ctx, configIn) {
  const logger = ctx?.logger ?? console
  const cfg = normalizeConfig(configIn)

  let home = ''
  try {
    const svc = ctx?.get?.('dshHomePath')
    home = typeof svc === 'string' ? svc : String(svc?.path ?? svc?.home ?? '')
  } catch {}
  if (!home) home = String(process.env.DSH_HOME ?? '').trim()
  if (!home) home = join(homedir(), '.dsh')
  const baseDir = String(cfg.statePath ?? '').trim() ? resolve(cfg.statePath) : join(home, DATA.id)
  ensureDir(baseDir)
  ensureDir(join(baseDir, 'sessions'))

  const runtimes = new Map()
  let disposed = false

  const fileOf = (sid) => join(baseDir, 'sessions', `${safeSid(sid)}.json`)

  function loadRt(sid) {
    const file = fileOf(sid)
    const hit = runtimes.get(file)
    if (hit) return hit
    const raw = readJson(file, null)
    const st = normalizeState(raw, Date.now())
    const rt = {
      sid: String(sid),
      file,
      state: st,
      enabled: raw ? st.enabled === true : cfg.defaultEnabled === true,
      detach: null,
      agent: null,
      turnStartedAt: 0,
      dirty: false,
    }
    runtimes.set(file, rt)
    return rt
  }

  function saveRt(rt) {
    rt.state.enabled = rt.enabled
    rt.state.updatedAt = Date.now()
    writeJsonAtomic(rt.file, rt.state)
    rt.dirty = false
  }

  function agentOf(sid) {
    try {
      return ctx?.get?.('agents')?.get?.(sid) ?? null
    } catch {
      return null
    }
  }

  function attach(rt) {
    if (rt.detach) return true
    const agent = rt.agent ?? agentOf(rt.sid)
    if (!agent) return false
    rt.agent = agent
    const sp = agent.ctx?.get?.('systemPrompt') ?? agent.ctx?.systemPrompt
    if (!sp?.context) return false
    try {
      rt.detach = sp.context({
        name: `${DATA.id}:${rt.sid}`,
        order: Number(cfg.injectOrder) || 161,
        text: () => blockFor(rt),
      })
      return true
    } catch (e) {
      logger?.warn?.(`[${DATA.id}] 注入挂载失败：${e?.message ?? e}`)
      return false
    }
  }

  function blockFor(rt, { commit = true } = {}) {
    if (disposed || !cfg.enabled || !rt.enabled) return ''
    const now = Date.now()
    const block = buildBlock(rt.state, cfg, now)
    if (!shouldInject(rt.state, cfg, block, now).ok) return ''
    if (block.text && commit) {
      rt.state.lastInjectAt = now
      rt.state.lastInjectKey = block.key
      rt.dirty = true
    }
    return block.text
  }

  function settleTurn(rt) {
    const now = Date.now()
    const started = Number(rt.turnStartedAt) || 0
    rt.turnStartedAt = 0
    const minutes = started > 0 ? Math.min(cfg.maxPerTurnMin, Math.max(1, (now - started) / 60_000)) : cfg.perTurnMin
    const r = aggravate(rt.state, cfg, minutes, now)
    rt.state = r.state
    rt.state.sits += 1
    saveRt(rt)
    blockFor(rt, { commit: false })
  }

  function onAgentCreated(payload) {
    const agent = payload?.agent
    if (disposed || !agent) return
    const header = agent.session?.header ?? {}
    if (header.parent || header.parentId) return
    const sid = String(header.id ?? agent.session?.id ?? agent.id ?? '')
    if (!sid) return
    const rt = loadRt(sid)
    rt.agent = agent
    if (rt.enabled && cfg.enabled) attach(rt)
  }

  function onSessionEvent(session, event) {
    if (disposed || !event?.type) return
    const header = session?.header ?? session
    if (header?.parent || header?.parentId) return
    const sid = String(header?.id ?? session?.id ?? '')
    if (!sid) return
    const rt = loadRt(sid)
    if (rt.enabled && !rt.detach) attach(rt)
    if (event.type === 'message/user') {
      // 新的一轮：离席次数清零
      rt.state = { ...rt.state, leaveUsed: 0 }
      if (!rt.turnStartedAt) rt.turnStartedAt = Date.now()
      return
    }
    if (event.type === 'turn/start') {
      if (!rt.turnStartedAt) rt.turnStartedAt = Date.now()
      return
    }
    if (event.type === 'turn/end' || event.type === 'message/assistant') {
      if (rt.turnStartedAt) settleTurn(rt)
    }
  }

  try {
    ctx.on('agent/created', onAgentCreated)
    ctx.on('session/event', onSessionEvent)
  } catch (e) {
    logger?.warn?.(`[${DATA.id}] 事件订阅失败：${e?.message ?? e}`)
  }

  // ── 工具 ───────────────────────────────────────────────────────────────────
  const P = DATA.prefix
  const REASON_LABEL = { recovered: '痊愈', off: '关掉', restart: '重开' }
  const reasonLabel = (r) => REASON_LABEL[String(r || '')] || String(r || '')

  function rtOfExec(exec) {
    if (disposed) return {}
    const agent = exec?.agent ?? exec?.session?.agent
    const header = exec?.session?.header ?? agent?.session?.header ?? {}
    const sid = String(header.id ?? exec?.session?.id ?? agent?.session?.id ?? '')
    if (!sid) return {}
    return { rt: loadRt(sid) }
  }

  function summary(rt) {
    const now = Date.now()
    return {
      enabled: rt.enabled,
      mode: modeOf(rt.state, cfg, now),
      severity: Math.round(rt.state.severity),
      irritation: Math.round(rt.state.irritation),
      flares: rt.state.flares,
      triggerMin: Math.round(rt.state.triggerMin),
      reliefUntil: rt.state.reliefUntil,
      awayUntil: rt.state.awayUntil,
      leaveUsed: rt.state.leaveUsed,
      leaves: Array.isArray(rt.state.leaves) ? rt.state.leaves.length : 0,
      episode: rt.state.episode
        ? {
            startedAt: rt.state.episode.startedAt,
            minutes: Math.max(0, Math.round((now - rt.state.episode.startedAt) / 60_000)),
            peak: Math.round(rt.state.episode.peak),
            flares: rt.state.episode.flares,
            reliefs: rt.state.episode.reliefs,
            leaves: rt.state.episode.leaves,
            calmSince: rt.state.episode.calmSince || 0,
          }
        : null,
      episodes: Array.isArray(rt.state.episodes) ? rt.state.episodes.slice(-5) : [],
    }
  }

  const reliefList = (DATA.reliefs || []).map((r) => r.id + '=' + r.label).join(' / ')

  const toolDefs = [
    {
      name: P + '_on',
      description: `在这个会话里开启「${DATA.label}」这条副线（只影响当前会话，不动别的会话）。用户说「我有${DATA.label} / 就当我有吧 / 开一下」时用。`,
      parameters: { type: 'object', properties: {}, required: [] },
      async execute(args, exec) {
        const { rt } = rtOfExec(exec)
        if (!rt) return { ok: false, text: '拿不到会话。' }
        rt.enabled = true
        rt.state = rt.state || newState(Date.now())
        if (!rt.state.episode) rt.state = beginEpisode(rt.state, Date.now())
        attach(rt)
        saveRt(rt)
        return { ok: true, text: `开了：这个会话从现在起算${DATA.label}。`, data: summary(rt) }
      },
    },
    {
      name: P + '_off',
      description: `关掉这个会话的「${DATA.label}」副线（文件留着，随时能再开）。用户说「算了 / 别演了 / 关掉」时用。`,
      parameters: { type: 'object', properties: {}, required: [] },
      async execute(args, exec) {
        const { rt } = rtOfExec(exec)
        if (!rt) return { ok: false, text: '拿不到会话。' }
        rt.enabled = false
        rt.state = sealEpisode(rt.state, Date.now(), 'off')
        try {
          rt.detach?.()
        } catch {}
        rt.detach = null
        saveRt(rt)
        return { ok: true, text: `关了。`, data: summary(rt) }
      },
    },
    {
      name: P + '_status',
      description: `读当前会话的${DATA.label}状态（开关、难受度、发作次数、档位）。排查与汇报用。`,
      parameters: { type: 'object', properties: {}, required: [] },
      async execute(args, exec) {
        const { rt } = rtOfExec(exec)
        if (!rt) return { ok: false, text: '拿不到会话。' }
        const s = summary(rt)
        const last = s.episodes.length ? s.episodes[s.episodes.length - 1] : null
        const ep = s.episode
          ? `病程进行中 ${s.episode.minutes} 分钟（峰值 ${s.episode.peak}，发作 ${s.episode.flares}）`
          : last
            ? `上一次 ${last.minutes} 分钟｜${reasonLabel(last.endReason)}`
            : '还没有病程'
        return {
          ok: true,
          text: `${DATA.label}：${s.enabled ? '开着' : '关着'}｜难受 ${s.severity}/100｜档位 ${s.mode}｜发作 ${s.flares} 次｜${ep}`,
          data: s,
        }
      },
    },
    {
      name: P + '_relief',
      description: `处理一下：${reliefList}。用户说「吃药 / 贴一下 / 歇会儿 / 弄一下」时用。不能用来假装没事——效果过了还是那样。`,
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', description: '方式，可选：' + reliefList } },
        required: [],
      },
      async execute(args, exec) {
        const { rt } = rtOfExec(exec)
        if (!rt) return { ok: false, text: '拿不到会话。' }
        const id = String(args?.kind || (DATA.reliefs?.[0]?.id ?? 'rest'))
        const r = relieveById(rt.state, cfg, id, Date.now())
        if (!r.ok) return { ok: false, text: `没有这种方式：${id}` }
        rt.state = r.state
        saveRt(rt)
        blockFor(rt, { commit: false })
        return { ok: true, text: `照这个处理了（${r.relief.label}）。`, data: summary(rt) }
      },
    },
    {
      name: P + '_worse',
      description: `主动加重一点（默认按一轮的量），推进剧情或调试用。用户说「再熬一晚 / 又犯了」时用。`,
      parameters: {
        type: 'object',
        properties: { minutes: { type: 'number', description: '加重多久，默认按配置' } },
        required: [],
      },
      async execute(args, exec) {
        const { rt } = rtOfExec(exec)
        if (!rt) return { ok: false, text: '拿不到会话。' }
        const m = Math.max(1, Math.min(240, Math.round(Number(args?.minutes) || cfg.perTurnMin)))
        const r = aggravate(rt.state, cfg, m, Date.now())
        rt.state = r.state
        saveRt(rt)
        blockFor(rt, { commit: false })
        return { ok: true, text: `又硬撑了 ${m} 分钟。`, data: summary(rt) }
      },
    },
    ...(LEAVE_IDS.has(DATA.id)
      ? [
          {
            name: P + '_leave',
            description: `离开一会儿（起身走动、去一趟、靠一下）：难受会降一点，降多少看当时多难受；一轮最多 ${cfg.leaveMaxPerTurn} 次，单次最多 ${cfg.leaveMaxMinutes} 分钟。用户说「等我一下 / 我起来一下 / 我去趟洗手间」时用。`,
            parameters: {
              type: 'object',
              properties: {
                minutes: {
                  type: 'number',
                  description: `离开多久（1–${cfg.leaveMaxMinutes} 分钟），默认 ${cfg.leaveMinutes}`,
                },
              },
              required: [],
            },
            async execute(args, exec) {
              const { rt } = rtOfExec(exec)
              if (!rt) return { ok: false, text: '拿不到会话。' }
              const r = takeLeave(rt.state, cfg, Date.now(), args?.minutes)
              if (!r.ok) {
                const why =
                  r.code === 'AWAY'
                    ? '还在离席里，等这一趟回来再说。'
                    : `这一轮已经起身 ${r.used} 次了（上限 ${r.max}），别再离席。`
                return { ok: false, code: r.code, text: why, data: summary(rt) }
              }
              rt.state = r.state
              saveRt(rt)
              blockFor(rt, { commit: false })
              return {
                ok: true,
                text: `起身离开 ${r.minutes} 分钟，难受降了 ${r.gain}（这一轮第 ${r.used}/${r.max} 次）。`,
                data: summary(rt),
              }
            },
          },
        ]
      : []),
  ]

  let tries = 0
  const tryRegister = () => {
    if (disposed) return
    const tools = ctx?.get?.('tools')
    if (!tools?.register) {
      if (++tries < 15) {
        const t = setTimeout(tryRegister, 2000)
        t?.unref?.()
        return
      }
      logger?.info?.(`[${DATA.id}] tools 不可用，工具未注册`)
      return
    }
    for (const def of toolDefs) {
      try {
        tools.register(def)
      } catch (e) {
        logger?.warn?.(`[${DATA.id}] 工具 ${def.name} 注册失败：${e?.message ?? e}`)
      }
    }
  }
  tryRegister()

  const timer = setInterval(() => {
    if (disposed) return
    for (const rt of runtimes.values()) {
      if (!rt.enabled) continue
      const before = rt.state.episode
      rt.state = tick(rt.state, cfg, Date.now(), 1)
      if (rt.state.episode !== before) rt.dirty = true
      if (rt.dirty) saveRt(rt)
    }
  }, TICK_MS)
  timer?.unref?.()

  const dispose = () => {
    disposed = true
    try {
      clearInterval(timer)
    } catch {}
    for (const rt of runtimes.values()) {
      try {
        rt.detach?.()
      } catch {}
      if (rt.enabled) saveRt(rt)
    }
  }
  // ── 面板（可选增强：没有 webServer 就只是没有面板，不影响身体状态）──────────
  try {
    attachPanel(ctx, {
      DATA,
      cfg,
      baseDir,
      loadRt,
      saveRt,
      attach,
      summary,
      modeOf,
      eerinessOf,
      aggravate,
      relieveById,
      normalizeState,
      beginEpisode,
      sealEpisode,
    })
  } catch (e) {
    logger?.warn?.(`[${DATA.id}] 面板挂载失败：${e?.message ?? e}`)
  }

  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose)
}

export const __test__ = {
  newState,
  normalizeState,
  normalizeEpisode,
  beginEpisode,
  sealEpisode,
  aggravate,
  relieveById,
  takeLeave,
  tick,
  modeOf,
  eerinessOf,
  buildBlock,
  shouldInject,
  normalizeConfig,
  DEFAULTS,
}
