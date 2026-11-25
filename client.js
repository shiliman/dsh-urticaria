/**
 * dsh-urticaria · 面板（Client 半）
 *
 * 侧边栏一格「荨麻疹」+ 一块面板页：此刻难受度、最近曲线、开关 / 加重 / 缓解。
 * 数据全走 dsh-urticaria 的 Host 路由（见 src/panel.js），客户端不自己算状态。
 *
 * 约定：
 *   - factory 体整体 try/catch：这里 throw 会让 web boot 判定 entry failed；
 *   - 样式只用宿主 token（--dsw-alias-*），兜底色一律用同族深色，不写字面白；
 *   - 样式表按 id 判重 + **内容变了就整段替换**（热重载后新 JS 配旧 CSS 是真踩过的坑）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-urticaria',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement
      const { useCallback, useEffect, useState } = React

      const BASE = '/' + 'dsh-urticaria' + '/panel'
      const ACCENT = '#f2a0b8'
      const GID = 'dp-spark-' + Math.random().toString(36).slice(2, 8)
      const STYLE_ID = 'dsh-urticaria-panel-style'

      const CSS = `
.dp-page { height: 100%; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain; background: var(--dsw-alias-bg-base, #151517); color: var(--dsw-alias-label-primary, #f9fafb); scrollbar-width: thin; }
.dp-body { padding: 26px 32px 64px; max-width: 1040px; margin: 0 auto; }
.dp-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.dp-kicker { font-size: 11px; letter-spacing: .08em; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .7; }
.dp-title { font-size: 22px; font-weight: 600; line-height: 1.3; margin: 3px 0 0; }
.dp-sub { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #cfd3d6); margin-top: 4px; }
.dp-head-r { margin-left: auto; display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.dp-mode { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.06)); background: var(--dsw-alias-bg-layer-1, #232324); font-size: 12px; white-space: nowrap; }
.dp-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.dp-updated { font-size: 11px; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .8; white-space: nowrap; }
.dp-btn { height: 28px; padding: 0 9px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.06)); background: transparent; color: var(--dsw-alias-label-secondary, #cfd3d6); font: inherit; font-size: 12px; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex: 0 0 auto; cursor: pointer; box-sizing: border-box; }
.dp-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #2c2c2e); color: var(--dsw-alias-label-primary, #f9fafb); }
.dp-btn:disabled { opacity: .45; cursor: default; }
.dp-btn.primary { border-color: var(--dsw-alias-brand-primary, #7aa2ff); }
.dp-card { background: var(--dsw-alias-bg-layer-1, #232324); border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.06)); border-radius: 12px; padding: 16px 18px; }
.dp-stack { display: flex; flex-direction: column; gap: 12px; }
.dp-grid2 { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap: 12px; align-items: start; }
.dp-sec-title { font-size: 12px; font-weight: 600; letter-spacing: .03em; color: var(--dsw-alias-label-secondary, #cfd3d6); margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.dp-sec-title .dp-hint { margin-left: auto; font-weight: 400; }
.dp-big { font-size: 38px; font-weight: 600; line-height: 1.02; font-variant-numeric: tabular-nums; }
.dp-big small { font-size: 13px; font-weight: 400; color: var(--dsw-alias-label-secondary, #cfd3d6); margin-left: 5px; }
.dp-meter { position: relative; height: 10px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2, #2c2c2e); margin: 14px 0 26px; }
.dp-meter-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px; background: linear-gradient(90deg, var(--dp-accent, #7aa2ff) 0%, var(--dsw-alias-state-warn-primary, #e8a33d) 100%); transition: width .35s ease; }
.dp-tick { position: absolute; top: -4px; bottom: -4px; width: 1px; background: var(--dsw-alias-border-l2, rgba(255,255,255,.12)); }
.dp-tick-label { position: absolute; top: 15px; transform: translateX(-50%); font-size: 10px; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .7; white-space: nowrap; }
.dp-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dp-stat { background: var(--dsw-alias-bg-layer-2, #2c2c2e); border-radius: 10px; padding: 10px 12px; }
.dp-stat-k { font-size: 11px; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .85; white-space: nowrap; }
.dp-stat-v { font-size: 19px; font-weight: 600; margin-top: 3px; font-variant-numeric: tabular-nums; }
.dp-stat-v small { font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-secondary, #cfd3d6); margin-left: 3px; }
.dp-graph svg { display: block; width: 100%; height: 128px; }
.dp-graph-foot { display: flex; justify-content: space-between; font-size: 10px; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .65; margin-top: 6px; }
.dp-graph-empty { height: 128px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .7; border: 1px dashed var(--dsw-alias-border-l1, rgba(255,255,255,.06)); border-radius: 10px; }
.dp-rows { display: flex; flex-direction: column; gap: 13px; }
.dp-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dp-row-k { font-size: 12px; color: var(--dsw-alias-label-secondary, #cfd3d6); width: 60px; flex: 0 0 auto; }
.dp-switch { width: 38px; height: 21px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12)); background: var(--dsw-alias-bg-layer-2, #2c2c2e); position: relative; cursor: pointer; padding: 0; flex: 0 0 auto; transition: background .2s; }
.dp-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px; border-radius: 50%; background: var(--dsw-alias-label-secondary, #cfd3d6); transition: transform .2s, background .2s; }
.dp-switch[aria-checked="true"] { background: var(--dsw-alias-state-success-primary, #54be78); border-color: transparent; }
.dp-switch[aria-checked="true"]::after { transform: translateX(17px); background: #fff; }
.dp-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.06)); border-radius: 8px; overflow: hidden; flex: 0 0 auto; }
.dp-seg button { height: 28px; padding: 0 10px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #cfd3d6); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.dp-seg button + button { border-left: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.06)); }
.dp-seg button[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-2, #2c2c2e); color: var(--dsw-alias-label-primary, #f9fafb); }
.dp-hint { font-size: 11px; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .75; }
.dp-quote { margin: 0; padding: 9px 12px; border-left: 2px solid var(--dp-accent, #7aa2ff); background: var(--dsw-alias-bg-layer-2, #2c2c2e); border-radius: 0 8px 8px 0; font-size: 12px; line-height: 1.75; color: var(--dsw-alias-label-secondary, #cfd3d6); white-space: pre-wrap; word-break: break-word; }
.dp-cue { margin-top: 9px; }
.dp-cue-k { font-size: 11px; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .8; margin-bottom: 3px; }
.dp-cue-v { font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-primary, #f9fafb); opacity: .92; }
.dp-toast { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; font-size: 12px; border: 1px solid var(--dsw-alias-state-error-primary, #e8574a); color: var(--dsw-alias-state-error-primary, #ff9d9d); background: rgba(232, 87, 74, .10); }
.dp-empty { border: 1px dashed var(--dsw-alias-border-l1, rgba(255,255,255,.06)); border-radius: 12px; padding: 26px 20px; text-align: center; font-size: 12px; line-height: 1.9; color: var(--dsw-alias-label-secondary, #cfd3d6); }
.dp-empty b { color: var(--dsw-alias-label-primary, #f9fafb); font-weight: 600; }
.dp-foot { margin-top: 20px; font-size: 11px; line-height: 1.85; color: var(--dsw-alias-label-secondary, #cfd3d6); opacity: .7; }
`

      const MODES = {
        off: { label: '关闭', color: 'var(--dsw-alias-state-idle-primary, #7b7f86)' },
        calm: { label: '平静', color: 'var(--dsw-alias-state-idle-primary, #7b7f86)' },
        stiff: { label: '有点僵', color: 'var(--dsw-alias-state-warn-primary, #e8a33d)' },
        ache: { label: '隐痛', color: 'var(--dsw-alias-state-warn-primary, #e8a33d)' },
        flare: { label: '发作', color: 'var(--dsw-alias-state-error-primary, #e8574a)' },
        relieved: { label: '缓解中', color: 'var(--dsw-alias-state-success-primary, #54be78)' },
      }
      const modeMeta = (m) => MODES[m] || MODES.off

      const pad = (n) => String(n).padStart(2, '0')
      const fmtClock = (ms) => {
        const t = Number(ms)
        if (!t) return '—'
        const d = new Date(t)
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      }
      const fmtDay = (ms) => {
        const t = Number(ms)
        if (!t) return '—'
        const d = new Date(t)
        return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      }
      const fmtDur = (m) => {
        const n = Math.max(0, Math.round(Number(m) || 0))
        if (n < 60) return n + ' 分钟'
        return Math.floor(n / 60) + ' 小时 ' + (n % 60) + ' 分'
      }
      const EP_REASON = { recovered: '痊愈', off: '关掉', restart: '重开' }
      const fmtAgo = (ms) => {
        const t = Number(ms)
        if (!t) return '还没注入过'
        const s = Math.max(0, Math.round((Date.now() - t) / 1000))
        if (s < 60) return `${s} 秒前`
        if (s < 3600) return `${Math.round(s / 60)} 分钟前`
        if (s < 86400) return `${Math.round(s / 3600)} 小时前`
        return `${Math.round(s / 86400)} 天前`
      }
      const fmtLeft = (ms) => {
        const left = Number(ms) - Date.now()
        if (!(left > 0)) return ''
        const m = Math.ceil(left / 60000)
        return m > 1 ? `还剩 ${m} 分钟` : '还剩不到 1 分钟'
      }

      async function api(path, init) {
        const res = await fetch(path, init)
        let data = null
        try {
          data = await res.json()
        } catch {
          data = null
        }
        if (!res.ok || !data || data.ok === false) {
          const msg = (data && (data.message || data.code)) || '请求失败（HTTP ' + res.status + '）'
          throw new Error(msg)
        }
        return data
      }

      function useSnapshot() {
        const [snap, setSnap] = useState(null)
        const [err, setErr] = useState('')
        const [busy, setBusy] = useState('')

        const load = useCallback(async (quiet) => {
          try {
            const data = await api(BASE)
            setSnap(data)
            setErr('')
          } catch (e) {
            if (!quiet) setErr(String((e && e.message) || e))
          }
        }, [])

        useEffect(() => {
          let alive = true
          const tick = async () => {
            if (!alive) return
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            await load(true)
          }
          tick()
          const timer = setInterval(tick, 5000)
          return () => {
            alive = false
            clearInterval(timer)
          }
        }, [load])

        const act = useCallback(
          async (action, extra, key) => {
            setBusy(key || action)
            try {
              const data = await api(BASE + '/action', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(Object.assign({ action }, extra || {})),
              })
              setSnap(data)
              setErr('')
            } catch (e) {
              setErr(String((e && e.message) || e))
            } finally {
              setBusy('')
            }
          },
          [],
        )

        return { snap, err, busy, load, act }
      }

      function Spark({ points, startAt, flareAt }) {
        const pts = (points || []).filter((p) => p && Number.isFinite(Number(p.t)))
        if (pts.length < 2) {
          return h('div', { className: 'dp-graph-empty' }, pts.length === 1 ? '刚采到一个点，5 秒后刷新就会连成线' : '还没有采样点：面板打开着就会每 15 秒记一次')
        }
        const W = 640
        const H = 128
        const PD = 7
        const t0 = Number(pts[0].t)
        const t1 = Number(pts[pts.length - 1].t)
        const span = Math.max(1, t1 - t0)
        const X = (t) => PD + ((Number(t) - t0) / span) * (W - PD * 2)
        const Y = (v) => H - PD - (Math.max(0, Math.min(100, Number(v) || 0)) / 100) * (H - PD * 2)
        const lineOf = (k) => {
          let d = ''
          pts.forEach((p, i) => {
            d += (i ? ' L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p[k]).toFixed(1)
          })
          return d
        }
        const sev = lineOf('severity')
        const irr = lineOf('irritation')
        const area = sev + ' L' + X(t1).toFixed(1) + ' ' + Y(0) + ' L' + X(t0).toFixed(1) + ' ' + Y(0) + ' Z'
        const last = pts[pts.length - 1]
        return h(
          'div',
          { className: 'dp-graph' },
          h(
            'svg',
            { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', role: 'img', 'aria-label': '难受度曲线' },
            h(
              'defs',
              null,
              h(
                'linearGradient',
                { id: GID, x1: '0', y1: '0', x2: '0', y2: '1' },
                h('stop', { offset: '0%', stopColor: ACCENT, stopOpacity: '0.32' }),
                h('stop', { offset: '100%', stopColor: ACCENT, stopOpacity: '0' }),
              ),
            ),
            h('line', { x1: PD, y1: Y(flareAt), x2: W - PD, y2: Y(flareAt), stroke: 'var(--dsw-alias-state-error-primary, #e8574a)', strokeOpacity: '0.3', strokeDasharray: '4 6', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }),
            h('line', { x1: PD, y1: Y(startAt), x2: W - PD, y2: Y(startAt), stroke: 'var(--dsw-alias-state-warn-primary, #e8a33d)', strokeOpacity: '0.28', strokeDasharray: '4 6', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }),
            h('path', { d: area, fill: 'url(#' + GID + ')', stroke: 'none' }),
            h('path', { d: irr, fill: 'none', stroke: 'var(--dsw-alias-label-secondary, #cfd3d6)', strokeOpacity: '0.5', strokeWidth: 1, strokeDasharray: '3 4', vectorEffect: 'non-scaling-stroke' }),
            h('path', { d: sev, fill: 'none', stroke: ACCENT, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }),
            h('circle', { cx: X(t1), cy: Y(last.severity), r: 3, fill: ACCENT }),
          ),
          h(
            'div',
            { className: 'dp-graph-foot' },
            h('span', null, '实线 难受度 · 虚线 烦躁 · 淡线 两档阈值'),
            h('span', null, '最新 ' + fmtClock(t1)),
          ),
        )
      }

      function Stat({ k, v, unit }) {
        return h('div', { className: 'dp-stat' }, h('div', { className: 'dp-stat-k' }, k), h('div', { className: 'dp-stat-v' }, String(v), unit ? h('small', null, unit) : null))
      }

      function Panel() {
        const { snap, err, busy, load, act } = useSnapshot()
        const [minutes, setMinutes] = useState(12)
        const s = snap || {}
        const d = s.disease || {}
        const cfg = s.config || {}
        const sess = s.session || null
        const hist = s.history || []
        const st = (sess && sess.state) || {}
        const mode = modeMeta(sess ? sess.mode : 'off')
        const severity = Number(st.severity || 0)
        const reliefs = d.reliefs || []
        const startAt = Number(cfg.startAt || 34)
        const flareAt = Number(cfg.flareAt || 76)

        const header = h(
          'div',
          { className: 'dp-head' },
          h(
            'div',
            null,
            h('div', { className: 'dp-kicker' }, '病态插件 · 状态面板'),
            h('h1', { className: 'dp-title' }, (d.name || '') + (d.label && d.label !== d.name ? ' · ' + d.label : '')),
            h('div', { className: 'dp-sub' }, '它只影响会话里说话的方式；平静时一个字都不注入。'),
          ),
          h(
            'div',
            { className: 'dp-head-r' },
            h('span', { className: 'dp-mode' }, h('span', { className: 'dp-dot', style: { background: mode.color } }), mode.label),
            h('span', { className: 'dp-updated' }, s.now ? '读到 ' + fmtClock(s.now) : ''),
            h('button', { className: 'dp-btn', onClick: () => load(false), disabled: !!busy, title: '重新读一次' }, '刷新'),
          ),
        )

        const heroLeft = h(
          'div',
          { className: 'dp-card' },
          h('div', { className: 'dp-sec-title' }, '此刻', h('span', { className: 'dp-hint' }, sess ? '会话 ' + String(sess.sid).slice(0, 8).replace(/-+$/, '') : '没有会话数据')),
          h('div', { className: 'dp-big' }, String(severity), h('small', null, '/ 100')),
          h(
            'div',
            { className: 'dp-meter' },
            h('div', { className: 'dp-meter-fill', style: { width: Math.max(2, Math.min(100, severity)) + '%' } }),
            h('div', { className: 'dp-tick', style: { left: startAt + '%' } }),
            h('div', { className: 'dp-tick-label', style: { left: startAt + '%' } }, '隐痛 ' + startAt),
            h('div', { className: 'dp-tick', style: { left: flareAt + '%' } }),
            h('div', { className: 'dp-tick-label', style: { left: flareAt + '%' } }, '发作 ' + flareAt),
          ),
          h(
            'div',
            { className: 'dp-hint' },
            sess ? (sess.mode === 'relieved' && sess.reliefLabel ? '刚处理过：' + sess.reliefLabel + '（' + (fmtLeft(st.reliefUntil) || '已过劲') + '）' : '距离下一档还有 ' + Math.max(0, (severity < startAt ? startAt - severity : severity < flareAt ? flareAt - severity : 0)) + ' 点') : '还没有任何会话开过它',
          ),
        )

        const heroRight = h(
          'div',
          { className: 'dp-card' },
          h('div', { className: 'dp-sec-title' }, '这一份身体'),
          h(
            'div',
            { className: 'dp-stats' },
            h(Stat, { k: '烦躁', v: Number(st.irritation || 0) }),
            h(Stat, { k: '发作次数', v: Number(st.flares || 0), unit: '次' }),
            h(Stat, { k: '参与轮次', v: Number(st.sits || 0), unit: '轮' }),
            h(Stat, { k: '上次注入', v: fmtAgo(st.lastInjectAt) }),
          ),
          h('div', { className: 'dp-hint', style: { marginTop: '10px' } }, '每轮加重 ' + Number(cfg.gain || 0).toFixed(2) + ' · 到线后每轮发作概率 ' + Math.round(Number(cfg.flareChance || 0) * 100) + '%'),
        )

        const graphCard = h(
          'div',
          { className: 'dp-card' },
          h('div', { className: 'dp-sec-title' }, '最近这一路', h('span', { className: 'dp-hint' }, '最多记 180 个点')),
          h(Spark, { points: hist, startAt, flareAt }),
        )

        const controls = h(
          'div',
          { className: 'dp-card' },
          h('div', { className: 'dp-sec-title' }, '动手', h('span', { className: 'dp-hint' }, sess ? '改的是这个会话的状态文件' : '先在一个会话里开起来')),
          h(
            'div',
            { className: 'dp-rows' },
            h(
              'div',
              { className: 'dp-row' },
              h('span', { className: 'dp-row-k' }, '副线'),
              h('button', {
                className: 'dp-switch',
                role: 'switch',
                'aria-checked': sess ? !!sess.enabled : false,
                'aria-label': '开启或关闭这条副线',
                disabled: !sess || !!busy,
                onClick: () => act(sess && sess.enabled ? 'off' : 'on'),
              }),
              h('span', { className: 'dp-hint' }, sess && sess.enabled ? '开着：下一轮就会带上它' : '关着：状态冻结，不注入'),
            ),
            h(
              'div',
              { className: 'dp-row' },
              h('span', { className: 'dp-row-k' }, '加重'),
              h(
                'div',
                { className: 'dp-seg', role: 'group', 'aria-label': '加重多久' },
                [5, 12, 30].map((m) =>
                  h('button', { key: m, 'aria-pressed': minutes === m, onClick: () => setMinutes(m) }, m + ' 分钟'),
                ),
              ),
              h('button', { className: 'dp-btn', disabled: !sess || !!busy, onClick: () => act('worse', { minutes }, 'worse') }, busy === 'worse' ? '正在加重…' : '再撑一会儿'),
            ),
            h(
              'div',
              { className: 'dp-row' },
              h('span', { className: 'dp-row-k' }, '缓解'),
              reliefs.map((r) =>
                h('button', { key: r.id, className: 'dp-btn', disabled: !sess || !!busy, onClick: () => act('relief', { kind: r.id }, 'relief:' + r.id) }, busy === 'relief:' + r.id ? '处理中…' : r.label),
              ),
            ),
            h(
              'div',
              { className: 'dp-row' },
              h('span', { className: 'dp-row-k' }, '归零'),
              h('button', { className: 'dp-btn', disabled: !sess || !!busy, onClick: () => act('reset') }, '把状态清回一开始'),
              h('span', { className: 'dp-hint' }, '不动开关，只把难受度与计数清掉'),
            ),
          ),
        )

        const epRow = (e, live) =>
          h(
            'div',
            { className: 'dp-cue', key: String(e.startedAt) + (live ? ':live' : '') },
            h('div', { className: 'dp-cue-k' }, fmtDay(e.startedAt) + (live ? ' · 进行中' : '')),
            h(
              'div',
              { className: 'dp-cue-v' },
              fmtDur(e.minutes) +
                ' · 峰值 ' + Number(e.peak || 0) +
                (e.flares ? ' · 发作 ' + Number(e.flares) : '') +
                (e.reliefs ? ' · 缓解 ' + Number(e.reliefs) : '') +
                (e.leaves ? ' · 离席 ' + Number(e.leaves) : '') +
                (live ? '' : ' · ' + (EP_REASON[e.endReason] || e.endReason || '—')),
            ),
          )

        const episodesCard = h(
          'div',
          { className: 'dp-card' },
          h('div', { className: 'dp-sec-title' }, '病程', h('span', { className: 'dp-hint' }, '从开到痊愈/关掉，一次一条（这里显示最近 5 条）')),
          sess && sess.episode
            ? epRow(sess.episode, true)
            : h('div', { className: 'dp-hint' }, sess ? '这一轮还没有进行中的病程（开一次副线就会开始记）' : '还没有会话数据'),
          (sess && Array.isArray(sess.episodes) ? sess.episodes : []).slice().reverse().map((e) => epRow(e, false)),
        )

        const info = h(
          'div',
          { className: 'dp-grid2' },
          h(
            'div',
            { className: 'dp-card' },
            h('div', { className: 'dp-sec-title' }, '身体怎么表现'),
            h('div', { className: 'dp-cue' }, h('div', { className: 'dp-cue-k' }, '平静 / 有点僵'), h('div', { className: 'dp-cue-v' }, d.body && d.body.stiff ? d.body.stiff : '—')),
            h('div', { className: 'dp-cue' }, h('div', { className: 'dp-cue-k' }, '隐痛'), h('div', { className: 'dp-cue-v' }, d.body && d.body.ache ? d.body.ache : '—')),
            h('div', { className: 'dp-cue' }, h('div', { className: 'dp-cue-k' }, '发作'), h('div', { className: 'dp-cue-v' }, d.body && d.body.flare ? d.body.flare : '—')),
          ),
          h(
            'div',
            { className: 'dp-card' },
            h('div', { className: 'dp-sec-title' }, '语言方式'),
            h('div', { className: 'dp-cue-k' }, '平时'),
            h('blockquote', { className: 'dp-quote' }, (d.voice && d.voice.base) || '—'),
            h('div', { className: 'dp-cue-k', style: { marginTop: '10px' } }, '发作时'),
            h('blockquote', { className: 'dp-quote' }, (d.voice && d.voice.flare) || '—'),
            h('div', { className: 'dp-hint', style: { marginTop: '10px' } }, '语气不对劲上限 ' + Number(cfg.eeriness || 0) + '/3 · 注入上限 ' + Number(cfg.injectMaxChars || 0) + ' 字'),
          ),
        )

        const foot = h(
          'div',
          { className: 'dp-foot' },
          '阈值 ' + startAt + ' / ' + flareAt + '（可在 cordis.patch.yml 里改）；同一档有 ' + Number(cfg.cooldownMin || 8) + ' 分钟冷却，发作与刚处理完不受限。',
          h('br'),
          '状态存在 $DSH_HOME/' + (d.id || '') + '/sessions/<会话>.json；面板只读它、只改它，不碰别的会话，也不上传任何东西。',
        )

        return h(
          'div',
          { className: 'dp-page', style: { '--dp-accent': ACCENT } },
          h(
            'div',
            { className: 'dp-body' },
            header,
            err ? h('div', { className: 'dp-toast' }, '面板读不到数据：' + err) : null,
            sess
              ? null
              : h(
                  'div',
                  { className: 'dp-empty', style: { marginBottom: '12px' } },
                  h('div', null, h('b', null, '还没有会话开过它。')),
                  h('div', null, '在会话里让它跑起来一次，这块面板就会有数据；下面的刻度与语言方式可以先看。'),
                ),
            h('div', { className: 'dp-stack' }, h('div', { className: 'dp-grid2' }, heroLeft, heroRight), graphCard, controls, episodesCard, info, foot),
          ),
        )
      }

      function SidebarIcon() {
        return h(
          'svg',
          { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M1.5 8h2.2l1.4-3.4L7.2 12l1.9-6.4L11 8h3.5' }),
        )
      }

      // 只给离线自检用（宿主只读 inject / apply，多这一个键无副作用）
      const __panelTest__ = { MODES, modeMeta, fmtClock, fmtAgo, Spark, Panel }

      return {
        inject: ['slots'],
        __panelTest__,
        apply(ctx) {
          try {
            if (typeof document !== 'undefined' && document.head) {
              let el = document.getElementById(STYLE_ID)
              if (!el) {
                el = document.createElement('style')
                el.id = STYLE_ID
                el.textContent = CSS
                document.head.appendChild(el)
              } else if (el.textContent !== CSS) {
                el.textContent = CSS
              }
            }
          } catch {}

          try {
            if (ctx.slots && typeof ctx.slots.inject === 'function') {
              ctx.slots.inject('sidebar.panellist', () => {
                try {
                  ctx.slots.register({ name: 'main', key: 'hives' }, Panel)
                } catch {}
                try {
                  ctx.slots.register({ name: 'sidebar.panellist', id: 'hives', order: 60, label: '荨麻疹' }, SidebarIcon)
                } catch {}
              })
            }
          } catch {}
        },
      }
    } catch {
      return { apply() {} }
    }
  },
})
