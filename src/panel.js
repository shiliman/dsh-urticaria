/**
 * 病态插件 · 面板运行时（Host 半）
 *
 * 每个插件共用同一份，由 _tools/gen-panels.mjs 原样复制到 <插件>/src/panel.js。
 * 它只做三件事：
 *   1. 读 <baseDir>/sessions/*.json（引擎自己落盘的状态），挑最近活跃的那个会话；
 *   2. 记一条轻量历史（每 15s 最多一条，最多 180 条，按 sid 分开存），给面板画曲线；
 *   3. 注册两个 HTTP 路由：GET  <路由>           -> 快照
 *                        POST <路由>/action    -> 开关 / 加重 / 缓解 / 重置
 *
 * 约束（很关键）：
 *   - 状态只通过 api.loadRt / api.saveRt 改，**不能直接写 sessions/*.json**。
 *     引擎在内存里缓存着同一份 rt，绕过它写盘会在下一次 saveRt 时被覆盖，
 *     面板上点了没反应就是这么来的。
 *   - 面板是可选增强：webServer 拿不到、路由注册失败，都只是没有面板，
 *     绝不能让插件本身起不来（这是用户明确要求过的）。
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HISTORY_MAX = 180
const SAMPLE_MIN_MS = 15_000

const sendJson = (res, status, obj) => {
  try {
    const body = JSON.stringify(obj)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  } catch {
    try {
      res.statusCode = 500
      res.end('{"ok":false,"message":"serialize failed"}')
    } catch {}
  }
}

const readBody = (req) =>
  new Promise((resolve) => {
    let buf = ''
    let size = 0
    let done = false
    const finish = (v) => {
      if (done) return
      done = true
      resolve(v)
    }
    try {
      req.on('data', (chunk) => {
        if (done) return
        size += chunk.length
        if (size > 128 * 1024) {
          finish('')
          return
        }
        buf += chunk
      })
      req.on('end', () => finish(buf))
      req.on('error', () => finish(''))
    } catch {
      finish('')
    }
  })

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

export function attachPanel(ctx, api) {
  const DATA = api.DATA
  const baseDir = api.baseDir
  const routePath = `/${DATA.id}/panel`

  // ── 历史（按会话分开存；只给面板画曲线用，丢了不影响身体状态）──────────────
  const historyFile = join(baseDir, 'panel-history.json')

  const readHistoryAll = () => {
    try {
      const raw = JSON.parse(readFileSync(historyFile, 'utf8'))
      if (!raw || typeof raw !== 'object') return {}
      const out = {}
      for (const [sid, points] of Object.entries(raw)) {
        if (!Array.isArray(points)) continue
        out[sid] = points
          .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.severity)))
          .map((p) => ({ t: num(p.t), severity: num(p.severity), irritation: num(p.irritation) }))
          .slice(-HISTORY_MAX)
      }
      return out
    } catch {
      return {}
    }
  }

  const writeHistoryAll = (all) => {
    try {
      mkdirSync(baseDir, { recursive: true })
      const tmp = `${historyFile}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
      renameSync(tmp, historyFile)
      return true
    } catch {
      return false
    }
  }

  const pushSample = (sid, state, now) => {
    const all = readHistoryAll()
    const points = all[sid] || []
    const last = points[points.length - 1]
    if (last && now - last.t < SAMPLE_MIN_MS) {
      const merged = points.slice(0, -1)
      merged.push({ t: now, severity: Math.round(num(state.severity)), irritation: Math.round(num(state.irritation)) })
      all[sid] = merged.slice(-HISTORY_MAX)
    } else {
      points.push({ t: now, severity: Math.round(num(state.severity)), irritation: Math.round(num(state.irritation)) })
      all[sid] = points.slice(-HISTORY_MAX)
    }
    writeHistoryAll(all)
    return all[sid]
  }

  // ── 会话列表 ───────────────────────────────────────────────────────────────
  const sessionsDir = join(baseDir, 'sessions')

  const listSessions = () => {
    try {
      return readdirSync(sessionsDir)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
        .map((f) => {
          let mtime = 0
          try {
            mtime = statSync(join(sessionsDir, f)).mtimeMs
          } catch {}
          return { sid: f.slice(0, -5), mtime: Math.round(mtime) }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  }

  const pickSid = (want) => {
    const list = listSessions()
    const wanted = String(want || '').trim()
    if (wanted) {
      const hit = list.find((x) => x.sid === wanted)
      if (hit) return hit.sid
    }
    return list[0]?.sid || ''
  }

  const diseasePayload = () => ({
    id: DATA.id,
    name: DATA.name,
    label: DATA.label,
    prefix: DATA.prefix,
    eeriness: api.cfg?.eeriness ?? DATA.defaultEeriness ?? 2,
    reliefs: (DATA.reliefs || []).map((r) => ({ id: r.id, label: r.label, relief: num(r.relief), minutes: num(r.minutes), calm: num(r.calm) })),
    voice: { base: DATA.voice?.base || '', flare: DATA.voice?.flare || '' },
    body: { stiff: DATA.body?.stiff || '', ache: DATA.body?.ache || '', flare: DATA.body?.flare || '' },
  })

  const configPayload = () => ({
    enabled: api.cfg?.enabled !== false,
    defaultEnabled: api.cfg?.defaultEnabled === true,
    gain: num(api.cfg?.gain),
    flareChance: num(api.cfg?.flareChance),
    flareGain: num(api.cfg?.flareGain),
    startAt: num(api.cfg?.startAt, 34),
    flareAt: num(api.cfg?.flareAt, 76),
    perTurnMin: num(api.cfg?.perTurnMin, 12),
    cooldownMin: num(api.cfg?.cooldownMin, 8),
    eeriness: num(api.cfg?.eeriness, 2),
    injectMaxChars: num(api.cfg?.injectMaxChars, 360),
  })

  const snapshot = (wantSid, { sample = true } = {}) => {
    const now = Date.now()
    const sessions = listSessions()
    const sid = pickSid(wantSid)
    const base = { ok: true, disease: diseasePayload(), config: configPayload(), sessions, now }
    if (!sid) return { ...base, session: null, history: [] }

    const rt = api.loadRt(sid)
    const st = rt.state || {}
    const mode = api.modeOf(st, api.cfg, now)
    const relief = (DATA.reliefs || []).find((r) => r.id === st.reliefKind)
    if (sample) pushSample(sid, st, now)
    return {
      ...base,
      session: {
        sid,
        enabled: rt.enabled === true,
        mode,
        eerie: api.eerinessOf(st, api.cfg),
        reliefKind: st.reliefKind || '',
        reliefLabel: relief?.label || '',
        state: {
          severity: Math.round(num(st.severity)),
          irritation: Math.round(num(st.irritation)),
          flares: Math.round(num(st.flares)),
          sits: Math.round(num(st.sits)),
          triggerMin: Math.round(num(st.triggerMin)),
          reliefUntil: num(st.reliefUntil),
          lastInjectAt: num(st.lastInjectAt),
          lastFlareAt: num(st.lastFlareAt),
          updatedAt: num(st.updatedAt),
        },
        // 病程：进行中的那一条 + 最近几条已结束的
        episode: st.episode
          ? {
              startedAt: num(st.episode.startedAt),
              minutes: Math.max(0, Math.round((now - num(st.episode.startedAt)) / 60_000)),
              peak: Math.round(num(st.episode.peak)),
              flares: Math.round(num(st.episode.flares)),
              reliefs: Math.round(num(st.episode.reliefs)),
              leaves: Math.round(num(st.episode.leaves)),
            }
          : null,
        episodes: Array.isArray(st.episodes) ? st.episodes.slice(-5) : [],
      },
      history: readHistoryAll()[sid] || [],
    }
  }

  // ── 动作 ───────────────────────────────────────────────────────────────────
  const runAction = (body) => {
    const action = String(body?.action || '').trim()
    const now = Date.now()
    const sid = pickSid(body?.sid)
    const allowed = ['on', 'off', 'worse', 'relief', 'reset']
    if (!allowed.includes(action)) return { status: 400, payload: { ok: false, code: 'BAD_ACTION', message: `不认识的动作：${action || '(空)'}` } }
    if (!sid) return { status: 409, payload: { ok: false, code: 'NO_SESSION', message: '这个插件还没在任何会话里开过，先让它在会话里跑起来。' } }

    const rt = api.loadRt(sid)
    if (action === 'on') {
      rt.enabled = true
      if (!rt.state?.episode && typeof api.beginEpisode === 'function') rt.state = api.beginEpisode(rt.state, now)
      try {
        api.attach(rt)
      } catch {}
      api.saveRt(rt)
    } else if (action === 'off') {
      rt.enabled = false
      if (typeof api.sealEpisode === 'function') rt.state = api.sealEpisode(rt.state, now, 'off')
      try {
        rt.detach?.()
      } catch {}
      rt.detach = null
      api.saveRt(rt)
    } else if (action === 'worse') {
      const minutes = Math.max(1, Math.min(240, Math.round(num(body?.minutes, api.cfg?.perTurnMin ?? 12))))
      const r = api.aggravate(rt.state, api.cfg, minutes, now)
      rt.state = r.state
      api.saveRt(rt)
    } else if (action === 'relief') {
      const id = String(body?.kind || (DATA.reliefs?.[0]?.id ?? 'rest'))
      const r = api.relieveById(rt.state, api.cfg, id, now)
      if (!r.ok) return { status: 400, payload: { ok: false, code: 'NO_SUCH_RELIEF', message: `没有这种方式：${id}` } }
      rt.state = r.state
      api.saveRt(rt)
    } else if (action === 'reset') {
      const fresh = api.normalizeState(null, now)
      fresh.enabled = rt.enabled === true
      rt.state = fresh
      api.saveRt(rt)
    }
    pushSample(sid, rt.state || {}, Date.now())
    return { status: 200, payload: snapshot(sid, { sample: false }) }
  }

  // ── 路由注册 ───────────────────────────────────────────────────────────────
  const registerRoutes = (webServer, webCtx) => {
    const register = (route) => {
      try {
        webCtx.effect(() => webServer.register(route), `${DATA.id}: ${route.path}`)
      } catch {
        /* 单条路由失败不致命 */
      }
    }

    register({
      kind: 'exact',
      path: routePath,
      handler: async (req, res) => {
        if (req?.method && req.method !== 'GET') return sendJson(res, 405, { ok: false, message: '只支持 GET' })
        try {
          const url = String(req?.url || '')
          const qs = url.includes('?') ? new URLSearchParams(url.slice(url.indexOf('?') + 1)) : null
          sendJson(res, 200, snapshot(qs?.get('sid') || ''))
        } catch (err) {
          sendJson(res, 500, { ok: false, message: String(err?.message || err) })
        }
      },
    })

    register({
      kind: 'exact',
      path: `${routePath}/action`,
      handler: async (req, res) => {
        if (req?.method && req.method !== 'POST') return sendJson(res, 405, { ok: false, message: '只支持 POST' })
        try {
          const raw = await readBody(req)
          let body = {}
          try {
            body = raw ? JSON.parse(raw) : {}
          } catch {
            return sendJson(res, 400, { ok: false, code: 'BAD_JSON', message: '请求体不是合法 JSON' })
          }
          const r = runAction(body)
          sendJson(res, r.status, r.payload)
        } catch (err) {
          sendJson(res, 500, { ok: false, message: String(err?.message || err) })
        }
      },
    })
  }

  try {
    ctx.inject(['webServer'], (webCtx) => {
      const server = webCtx?.webServer
      if (server && typeof server.register === 'function') registerRoutes(server, webCtx)
    })
  } catch {
    /* 没有 webServer：面板不存在，插件照常工作 */
  }
}

export const __panelTest__ = { HISTORY_MAX, SAMPLE_MIN_MS }
