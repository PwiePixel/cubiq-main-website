// Cubiq Studio – kleiner Server für die Team-Seite und den Team-Bereich (/admin): Anmeldung mit Benutzername und
// Passwort, Team-Seite bearbeiten, Zugänge verwalten. Nur Node-Bordmittel, keine Pakete. Erreichbar nur über nginx
// (/api/…) im internen Docker-Netz, nie direkt von außen.
//
// Daten als JSON in DATA_DIR: users.json (Passwörter nur als scrypt-Hash) und team.json.
// Rollen: „admin“ (Team-Seite und Zugänge) und „team“ (Team-Seite).
//
//   node server.mjs                             Server starten (Port 3000)
//   node server.mjs user <Name> [admin|team]    Zugang anlegen oder Passwort setzen (Passwort über stdin)
//   node server.mjs users                       Zugänge auflisten

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { join } from 'node:path'

const DATA_DIR = process.env.DATA_DIR || '/data'
const PORT = Number(process.env.PORT || 3000)
const COOKIE = '__Host-studio_session'
const SESSION_MS = 12 * 60 * 60 * 1000
const ROLES = ['admin', 'team']
const COLORS = ['green', 'lime', 'amber', 'blue', 'violet', 'rose']
const MAX_MEMBERS = 60
const MAX_BODY = 64 * 1024
// scrypt mit 32 MB Speicher je Hash – dazu höchstens 10 Fehlversuche je IP und Name in 15 Minuten.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const LIMIT = { tries: 10, windowMs: 15 * 60 * 1000 }

// ---------------------------------------------------------------- Daten

async function load(name, fallback) {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, name), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

// Schreiben nacheinander und atomar (erst .tmp, dann umbenennen).
let queue = Promise.resolve()
function save(name, value) {
  const run = queue.then(async () => {
    const file = join(DATA_DIR, name)
    await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await rename(file + '.tmp', file)
  })
  queue = run.catch(() => {})
  return run
}

const loadUsers = async () => (await load('users.json', { users: [] })).users ?? []
const saveUsers = (users) => save('users.json', { users })
const loadTeam = async () => (await load('team.json', { members: [] })).members ?? []
const findUser = (users, name) => users.find((u) => u.name.toLowerCase() === String(name).toLowerCase())

// ---------------------------------------------------------------- Passwörter

function hashPassword(password) {
  const salt = randomBytes(16)
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, SCRYPT, (err, key) => {
      if (err) reject(err)
      else resolve(['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$'))
    })
  })
}

function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split('$')
  if (kind !== 'scrypt' || !hash) return Promise.resolve(false)
  const expected = Buffer.from(hash, 'base64')
  return new Promise((resolve) => {
    scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem }, (err, key) => {
      resolve(!err && key.length === expected.length && timingSafeEqual(key, expected))
    })
  })
}

// Unbekannte Namen brauchen genauso lange wie bekannte (sonst ließen sich Namen erraten).
const dummyHash = hashPassword(randomBytes(16).toString('hex'))

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Das Passwort braucht mindestens 10 Zeichen.'
  if (password.length > 200) return 'Das Passwort ist zu lang.'
  return null
}

function checkName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_.-]{3,32}$/.test(name)
    ? null
    : 'Der Name braucht 3–32 Zeichen: Buchstaben, Ziffern, _ . -'
}

// ---------------------------------------------------------------- Sitzungen und Schutz gegen Passwort-Raten

const sessions = new Map() // sha256(Token) → { name, expires }
const attempts = new Map() // „ip:…“ / „name:…“ → { count, until }

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function cookieToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim()
  }
  return null
}

function startSession(res, name) {
  const token = randomBytes(32).toString('base64url')
  sessions.set(sha256(token), { name, expires: Date.now() + SESSION_MS })
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`)
}

function endSessions(name) {
  for (const [key, s] of sessions) if (s.name.toLowerCase() === name.toLowerCase()) sessions.delete(key)
}

async function currentUser(req) {
  const token = cookieToken(req)
  const s = token && sessions.get(sha256(token))
  if (!s || s.expires < Date.now()) return null
  // Rolle und Zugang immer frisch aus der Datei: Änderungen gelten sofort.
  return findUser(await loadUsers(), s.name) ?? null
}

function blocked(key) {
  const a = attempts.get(key)
  return Boolean(a && a.until > Date.now() && a.count >= LIMIT.tries)
}

function failed(key) {
  const a = attempts.get(key)
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + LIMIT.windowMs })
  else a.count++
}

// Aufräumen: abgelaufene Sitzungen und Zähler (nur im Arbeitsspeicher, nie auf der Festplatte).
setInterval(() => {
  const now = Date.now()
  for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k)
  for (const [k, a] of attempts) if (a.until < now) attempts.delete(k)
}, 10 * 60 * 1000).unref()

// Die echte Adresse setzt Cloudflare (nginx reicht den Header durch).
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '')

// Schreibende Anfragen nur von der eigenen Seite (zusätzlich zu SameSite=Strict).
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (site) return site === 'same-origin'
  const origin = req.headers.origin
  return !origin || origin === `https://${req.headers.host}` || origin === `http://${req.headers.host}`
}

// ---------------------------------------------------------------- Team-Seite

function text(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : ''
}

function cleanLink(link) {
  const label = text(link?.label, 30)
  const raw = text(link?.url, 300)
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!label || !['https:', 'mailto:'].includes(url.protocol)) return null
  return { label, url: url.toString() }
}

function cleanMember(m) {
  const name = text(m?.name, 40)
  if (!name) return null
  return {
    id: typeof m.id === 'string' && /^[a-z0-9]{8,24}$/.test(m.id) ? m.id : randomBytes(6).toString('hex'),
    name,
    role: { de: text(m.role?.de, 60), en: text(m.role?.en, 60) },
    about: { de: text(m.about?.de, 400), en: text(m.about?.en, 400) },
    color: COLORS.includes(m.color) ? m.color : 'green',
    links: (Array.isArray(m.links) ? m.links : []).map(cleanLink).filter(Boolean).slice(0, 3),
  }
}

const publicMember = ({ name, role, about, color, links }) => ({ name, role, about, color, links })

// ---------------------------------------------------------------- HTTP

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

const fail = (res, status, message) => send(res, status, { error: message })

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

async function login(req, res) {
  const body = await readBody(req)
  const name = text(body.name, 64)
  const ip = `ip:${clientIp(req)}`
  const who = `name:${name.toLowerCase()}`
  if (blocked(ip) || blocked(who)) return fail(res, 429, 'Zu viele Versuche – bitte in 15 Minuten noch einmal.')
  const user = findUser(await loadUsers(), name)
  const ok = await verifyPassword(String(body.password ?? ''), user ? user.hash : await dummyHash)
  if (!user || !ok) {
    failed(ip)
    failed(who)
    console.log('Anmeldung fehlgeschlagen')
    return fail(res, 401, 'Name oder Passwort stimmt nicht.')
  }
  attempts.delete(who)
  startSession(res, user.name)
  console.log(`Anmeldung: ${user.name}`)
  send(res, 200, { name: user.name, role: user.role })
}

async function handle(req, res) {
  const path = new URL(req.url, 'http://studio').pathname
  const method = req.method

  if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true })
  if (method === 'GET' && path === '/api/team') return send(res, 200, { members: (await loadTeam()).map(publicMember) })

  if (method !== 'GET' && !sameOrigin(req)) return fail(res, 403, 'Nur von der eigenen Seite.')
  if (method === 'POST' && path === '/api/login') return login(req, res)
  if (method === 'POST' && path === '/api/logout') {
    const token = cookieToken(req)
    if (token) sessions.delete(sha256(token))
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`)
    return send(res, 200, { ok: true })
  }

  const user = await currentUser(req)
  if (!user) return fail(res, 401, 'Bitte anmelden.')

  if (method === 'GET' && path === '/api/me') return send(res, 200, { name: user.name, role: user.role })

  if (method === 'POST' && path === '/api/me/password') {
    const body = await readBody(req)
    if (!(await verifyPassword(String(body.current ?? ''), user.hash))) return fail(res, 400, 'Das aktuelle Passwort stimmt nicht.')
    const problem = checkPassword(body.password)
    if (problem) return fail(res, 400, problem)
    const users = await loadUsers()
    const me = findUser(users, user.name)
    me.hash = await hashPassword(body.password)
    await saveUsers(users)
    endSessions(user.name)
    startSession(res, user.name)
    return send(res, 200, { ok: true })
  }

  if (path === '/api/admin/team') {
    if (method === 'GET') return send(res, 200, { members: await loadTeam() })
    if (method === 'PUT') {
      const body = await readBody(req)
      if (!Array.isArray(body.members)) return fail(res, 400, 'Ungültige Daten.')
      if (body.members.length > MAX_MEMBERS) return fail(res, 400, `Höchstens ${MAX_MEMBERS} Mitglieder.`)
      const members = body.members.map(cleanMember).filter(Boolean)
      await save('team.json', { members })
      console.log(`Team-Seite gespeichert von ${user.name}`)
      return send(res, 200, { members })
    }
  }

  if (path.startsWith('/api/admin/users')) {
    if (user.role !== 'admin') return fail(res, 403, 'Nur für Admins.')
    const users = await loadUsers()
    const admins = users.filter((u) => u.role === 'admin').length

    if (path === '/api/admin/users') {
      if (method === 'GET') return send(res, 200, { users: users.map(({ name, role, created }) => ({ name, role, created })) })
      if (method === 'POST') {
        const body = await readBody(req)
        const problem = checkName(body.name) || checkPassword(body.password)
        if (problem) return fail(res, 400, problem)
        if (findUser(users, body.name)) return fail(res, 409, 'Diesen Namen gibt es schon.')
        const role = ROLES.includes(body.role) ? body.role : 'team'
        users.push({ name: body.name, role, hash: await hashPassword(body.password), created: new Date().toISOString() })
        await saveUsers(users)
        console.log(`Zugang angelegt: ${body.name} (${role}) von ${user.name}`)
        return send(res, 201, { ok: true })
      }
    }

    const match = path.match(/^\/api\/admin\/users\/([^/]+)$/)
    const target = match && findUser(users, decodeURIComponent(match[1]))
    if (match && !target) return fail(res, 404, 'Diesen Zugang gibt es nicht.')
    if (target && method === 'PATCH') {
      const body = await readBody(req)
      if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) return fail(res, 400, 'Unbekannte Rolle.')
        if (target.role === 'admin' && body.role !== 'admin' && admins <= 1) return fail(res, 400, 'Der letzte Admin bleibt Admin.')
        target.role = body.role
      }
      if (body.password !== undefined) {
        const problem = checkPassword(body.password)
        if (problem) return fail(res, 400, problem)
        target.hash = await hashPassword(body.password)
        endSessions(target.name)
      }
      await saveUsers(users)
      return send(res, 200, { ok: true })
    }
    if (target && method === 'DELETE') {
      if (target.role === 'admin' && admins <= 1) return fail(res, 400, 'Der letzte Admin lässt sich nicht löschen.')
      await saveUsers(users.filter((u) => u !== target))
      endSessions(target.name)
      console.log(`Zugang gelöscht: ${target.name} von ${user.name}`)
      return send(res, 200, { ok: true })
    }
  }

  fail(res, 404, 'Nicht gefunden.')
}

// ---------------------------------------------------------------- Kommandozeile (auf dem Server über studio-server.sh)

async function cli(args) {
  if (args[0] === 'users') {
    for (const u of await loadUsers()) console.log(`${u.name} (${u.role})`)
    return
  }
  if (args[0] === 'user') {
    const [, name, role = 'admin'] = args
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
    const problem = checkName(name) || (ROLES.includes(role) ? null : 'Rolle: admin oder team') || checkPassword(password)
    if (problem) {
      console.error(`Fehler: ${problem}`)
      process.exit(1)
    }
    const users = await loadUsers()
    const existing = findUser(users, name)
    if (existing) {
      existing.hash = await hashPassword(password)
      existing.role = role
    } else {
      users.push({ name, role, hash: await hashPassword(password), created: new Date().toISOString() })
    }
    await saveUsers(users)
    console.log(`Zugang ${name} (${role}) gespeichert.`)
    return
  }
  console.error('Aufruf: node server.mjs [user <Name> [admin|team] | users]')
  process.exit(2)
}

if (process.argv.length > 2) {
  await cli(process.argv.slice(2))
} else {
  http
    .createServer((req, res) => {
      handle(req, res).catch((err) => {
        if (err.status) return fail(res, err.status, err.status === 413 ? 'Zu viele Daten.' : 'Ungültige Anfrage.')
        console.error(err)
        fail(res, 500, 'Serverfehler.')
      })
    })
    .listen(PORT, () => console.log(`Team-Server läuft auf Port ${PORT}`))
}
