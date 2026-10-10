const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')
const fs = require('fs')
const readline = require('readline')
const path = require('path')

const CONFIG = {
  host: 'infection.fun',
  port: 25565,
  username: 'sikigalvezBOT',
  version: false,
  auth: 'offline',

  password: 'aeiouarlo',
  loginDelayMs: 3000,
  pathfinderDelayMs: 3000,

  admins: ['sikigalvez', 'shzuulov'],

  banFile: path.join(__dirname, 'baneados.txt'),

  tpLogFile: path.join(__dirname, 'tp_destinos.txt'),
  kitPrefix: '$',
  cooldownMs: 60000,
  adminCooldownMs: 5000,
  vipCooldownMs: 20000,

  vipFile: path.join(__dirname, 'vips.txt'),

  spam: {
    windowMs: 10000,
    maxCommands: 4,
    muteMs: 120000,
    message: (player) => `/msg ${player} Spam detectado: te ignoro por 2 minutos.`
  },

  queue: {
    max: 10,
    reopenAt: 5,

    ignoreWhenAway: false,

    returnCommand: '/home bot',
    returnWaitMs: 4000,

    gapMs: 8000
  },

  chatGapMs: 1200,

  maxWalkDistance: 300,
  walkTimeoutMs: 90000,

  announce: { message: 'Kits gratis con $kit', everyMs: 12000 },

  kitListThrottleMs: 5000,

  noticeThrottleMs: 15000,
  queuedMessage: (player, pos, total, kit) =>
    pos === 1
      ? `/msg ${player} Voy por tu kit ${kit}. Acepta el TP cuando te llegue.`
      : `/msg ${player} Estás en la cola: puesto ${pos} de ${total}. Te aviso cuando sea tu turno.`,
  alreadyQueuedMessage: (player, pos) => `/msg ${player} Ya estás en la cola (puesto ${pos}).`,
  queueFullMessage: (player) => `/msg ${player} La cola está llena. Intenta de nuevo en un rato.`,
  cooldownMessage: (player, secs) => `/msg ${player} Espera ${secs} s para pedir otro kit.`,
  turnMessage: (player, kit) => `/msg ${player} Es tu turno, voy por tu kit ${kit}.`,

  banMessage: (player) => `/msg ${player} Quedaste baneado del bot por contenido inapropiado.`,
  inappropriateWords: [
    'porno', 'porn', 'pornhub', 'pornografia', 'xxx', 'hentai', 'onlyfans',
    'nude', 'nudes', 'desnuda', 'desnudo', 'desnudas', 'desnudos',
    'sexo', 'sex', 'sexual', 'dildo', 'vibrador', 'pene', 'penes', 'vagina',
    'verga', 'pija', 'tetas', 'tits', 'boobs', 'cock', 'dick', 'pussy', 'cum',
    'blowjob', 'anal'
  ],

  tpCommand: (player) => `/tpa ${player}`,
  tpTimeoutMs: 60000,

  killMessage: (player) => `/msg ${player} Mata al bot para recibir tu kit. Puede sufrir lagueos o bugs`,
  deliveredMessage: (player) => `/msg ${player} Bot entregado, disfruta tu kit`,

  notKilledMessage: (player) => `/msg ${player} No me mataste a tiempo. Vuelve a pedir el kit.`,
  waitForDeathMs: 120000,
  msgDelayMs: 200,

  reconnect: {
    enabled: true,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    stopOnBan: true
  },

  base: { x: -995794.5, y: -49.0, z: -992696.0, radius: 50 },

  bed: null,

  entry: { x: -22.41, y: 92.0, z: 57.41, yaw: -0.22, pitch: 12.18 },
  attackOnEntry: true,
  attackIgnoreAdmins: false,

  kits: {
    refill: { stand: { x: -995795.12, y: -49.0, z: -992696.11, yaw: 271.52, pitch: 43.94 } },
    cpvp: { stand: { x: -995794.24, y: -49.0, z: -992698.25, yaw: 272.12, pitch: 48.04 } },
    apvp: { stand: { x: -995794.24, y: -49.0, z: -992693.5, yaw: 271.0, pitch: 42.02 } },
    suministros: { stand: { x: -995795.59, y: -49.0, z: -992699.63, yaw: 274.51, pitch: 30.79 } },
    maparts: { stand: { x: -995794.99, y: -49.0, z: -992702.26, yaw: 266.04, pitch: 34.37 } },
    redstone: { stand: { x: -995795.24, y: -49.0, z: -992706.56, yaw: 271.4, pitch: 26.76 } },
    perceoo: { stand: { x: -995795.77, y: -49.0, z: -992688.79, yaw: 260.21, pitch: 29.12 } }
  }
}

const CONTAINERS = ['chest', 'trapped_chest', 'barrel']

let bot = null
let generation = 0
let reconnectAttempts = 0
let reconnectTimer = null
let banned = false

const queue = []
const lastRequest = new Map()
const lastKitList = new Map()
let busy = false
let activeRequest = null
let queueClosed = false
let announceTimer = null
const leftPlayers = new Set()
let restarting = false
let shuttingDown = false

class ChestEmptyError extends Error {
  constructor(kitName) {
    super(`el cofre del kit ${kitName} está vacío`)
    this.kitName = kitName
  }
}

function shutdown(reason) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[apagado] ${reason}`)
  stopAnnouncer()
  try { stopCombat() } catch (_) {}
  queue.length = 0

  const t0 = Date.now()
  const waitFlush = () => {
    if ((outbox.length > 0 || outboxTimer) && Date.now() - t0 < 8000) return setTimeout(waitFlush, 200)
    setTimeout(() => {
      try { bot.quit('apagado') } catch (_) {}
      setTimeout(() => process.exit(0), 500)
    }, 500)
  }
  setTimeout(waitFlush, 300)
}

function restart(reason) {
  if (shuttingDown || restarting) return
  restarting = true
  console.log(`[reinicio] ${reason}`)
  generation++
  try { stopCombat() } catch (_) {}
  stopAnnouncer()
  clearOutbox()
  queue.length = 0
  busy = false
  activeRequest = null
  queueClosed = false
  carried.clear()
  leftPlayers.clear()
  lastRequest.clear()
  lastNotice.clear()
  spamRecords.clear()
  reconnectAttempts = 0
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  const old = bot
  try { old.removeAllListeners('messagestr') } catch (_) {}
  try { old.quit('reinicio') } catch (_) {}
  setTimeout(() => {
    restarting = false
    if (!shuttingDown) connect()
  }, 3000)
}

function connect() {
  generation++
  const gen = generation
  const b = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
    auth: CONFIG.auth
  })
  bot = b
  b.loadPlugin(pathfinder)
  wireBot(b, gen)
}

function wireBot(b, gen) {
  let spawned = false

  b.once('spawn', () => {
    if (gen !== generation) return
    spawned = true
    const movements = new Movements(b)
    movements.canDig = false
    b.pathfinder.setMovements(movements)
    console.log(`[bot] conectado como ${b.username}`)

    setTimeout(() => {
      if (gen === generation) reconnectAttempts = 0
    }, 60000)

    setTimeout(() => {
      if (gen !== generation) return
      b.chat(`/login ${CONFIG.password}`)
      console.log('[auth] /login enviado')
      setTimeout(() => {
        if (gen !== generation) return
        startAnnouncer(gen)
        entrySequence(gen)
      }, CONFIG.pathfinderDelayMs)
    }, CONFIG.loginDelayMs)
  })

  b.on('messagestr', onChat)
  b.on('playerLeft', (p) => { if (p?.username) leftPlayers.add(p.username.toLowerCase()) })
  b.on('playerJoined', (p) => { if (p?.username) leftPlayers.delete(p.username.toLowerCase()) })

  b.on('kicked', (reason) => {
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason)
    console.log('[kick]', text)
    if (CONFIG.reconnect.stopOnBan && /\bban(ned)?\b/i.test(text)) banned = true
  })

  b.on('error', (err) => {
    console.log('[error]', err.message)

    if (!spawned) handleDisconnect(gen, `error: ${err.message}`)
  })

  b.on('end', (reason) => handleDisconnect(gen, reason))
}

function handleDisconnect(gen, reason) {
  if (shuttingDown) return
  if (gen !== generation) return
  console.log(`[bot] desconectado${reason ? ` (${reason})` : ''}`)

  generation++
  try { stopCombat() } catch (_) {}
  stopAnnouncer()
  queue.length = 0
  clearOutbox()
  busy = false
  activeRequest = null
  queueClosed = false
  carried.clear()
  leftPlayers.clear()

  if (banned) {
    console.log('[reconexión] parece un ban: no reintento')
    process.exit(1)
  }
  scheduleReconnect()
}

function scheduleReconnect() {
  if (!CONFIG.reconnect.enabled) process.exit(1)
  if (reconnectTimer) return
  const { baseDelayMs, maxDelayMs } = CONFIG.reconnect
  const delay = Math.min(baseDelayMs * 2 ** reconnectAttempts, maxDelayMs)
  reconnectAttempts++
  console.log(`[reconexión] intento ${reconnectAttempts} en ${Math.round(delay / 1000)} s`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

const NAME_RE = /^\.?[A-Za-z0-9_]{3,16}$/
const botBans = new Set()

function loadBans() {
  try {
    const lines = fs.readFileSync(CONFIG.banFile, 'utf8').split(/\r?\n/)
    const names = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    botBans.clear()
    for (const n of names) if (NAME_RE.test(n)) botBans.add(n.toLowerCase())
  } catch (_) {

  }
}

function saveBans() {
  const header = '# Jugadores baneados del bot. Un nombre por línea. Bórralos de aquí o usa "unban" en la consola.\n'
  const body = [...botBans].join('\n')
  try {
    fs.writeFileSync(CONFIG.banFile, header + body + (body ? '\n' : ''))
  } catch (err) {

    console.log(`[baneo] no pude guardar ${CONFIG.banFile}: ${err.message}`)
  }
}

function isBanned(name) {
  return botBans.has(String(name).toLowerCase())
}

function banPlayer(name, why) {
  const key = String(name).toLowerCase()
  botBans.add(key)
  saveBans()
  console.log(`[baneo] ${name} baneado del bot (${why})`)

  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].username.toLowerCase() === key) queue.splice(i, 1)
  }
  refreshQueueState()
}

function banCommand(args) {
  const sub = (args[0] || '').toLowerCase()
  const name = args[1]
  if (sub === 'ban') {
    if (!name || !NAME_RE.test(name)) return 'uso: ban <jugador> (3-16 letras, números o _)'
    if (isAdmin(name)) return `${name} es admin y no se puede banear`
    if (isBanned(name)) return `${name} ya estaba baneado`
    banPlayer(name, 'consola')
    return `${name} baneado del bot`
  }
  if (sub === 'unban') {
    if (!name) return 'uso: unban <jugador>'
    if (!botBans.delete(name.toLowerCase())) return `${name} no estaba baneado`
    saveBans()
    return `${name} desbaneado`
  }
  if (['banlist', 'list', 'lista'].includes(sub)) {
    return botBans.size ? `baneados: ${[...botBans].join(', ')}` : 'no hay baneados'
  }
  return 'comandos: ban <jugador> | unban <jugador> | banlist'
}

function normalizeText(t) {
  return String(t)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
}

const squeeze = (s) => s.replace(/(.)\1+/g, '$1')

function isInappropriate(text) {
  const tokens = normalizeText(text).split(/[^a-z]+/).filter(Boolean)

  const runs = []
  let cur = ''
  for (const t of tokens) {
    if (t.length === 1) cur += t
    else { if (cur) runs.push(cur); cur = '' }
  }
  if (cur) runs.push(cur)
  const cands = tokens.concat(runs)
  return CONFIG.inappropriateWords.some((w) => {
    const sw = squeeze(w)
    if (w.length <= 4) {

      return cands.some((t) => squeeze(t) === sw)
    }
    return cands.some((t) => t.includes(w) || squeeze(t).includes(sw))
  })
}

function logTeleportDestination(pos) {
  const line = `${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)}\n`
  try {
    fs.appendFileSync(CONFIG.tpLogFile, line)
  } catch (err) {
    console.log(`[tp] no pude guardar el destino: ${err.message}`)
  }
}

function isAdmin(name) {
  return CONFIG.admins.some((a) => a.toLowerCase() === String(name).toLowerCase())
}

const vips = new Set()

function loadVips() {
  try {
    const lines = fs.readFileSync(CONFIG.vipFile, 'utf8').split(/\r?\n/)
    const names = lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    vips.clear()
    for (const n of names) if (NAME_RE.test(n)) vips.add(n.toLowerCase())
  } catch (_) {

  }
}

function saveVips() {
  const header = '# VIP del bot (saltan la cola). Un nombre por línea. Bórralos de aquí o usa "unvip" en la consola.\n'
  const body = [...vips].join('\n')
  try {
    fs.writeFileSync(CONFIG.vipFile, header + body + (body ? '\n' : ''))
  } catch (err) {
    console.log(`[vip] no pude guardar ${CONFIG.vipFile}: ${err.message}`)
  }
}

function isVip(name) {
  return vips.has(String(name).toLowerCase())
}

function vipCommand(args) {
  const sub = (args[0] || '').toLowerCase()
  const name = args[1]
  if (sub === 'vip') {
    if (!name || !NAME_RE.test(name)) return 'uso: vip <jugador> (3-16 letras, números o _)'
    if (isAdmin(name)) return `${name} ya es admin`
    if (isVip(name)) return `${name} ya era VIP`
    vips.add(name.toLowerCase())
    saveVips()
    return `${name} ahora es VIP`
  }
  if (sub === 'unvip') {
    if (!name) return 'uso: unvip <jugador>'
    if (!vips.delete(name.toLowerCase())) return `${name} no era VIP`
    saveVips()
    return `${name} ya no es VIP`
  }
  if (['viplist', 'vips'].includes(sub)) {
    return vips.size ? `VIP: ${[...vips].join(', ')}` : 'no hay VIP'
  }
  return 'comandos: vip <jugador> | unvip <jugador> | viplist'
}

function priorityOf(name) {
  return isAdmin(name) ? 2 : isVip(name) ? 1 : 0
}

const spamRecords = new Map()

function isSpamming(name) {
  if (isAdmin(name)) return false
  const key = String(name).toLowerCase()
  const now = Date.now()
  const { windowMs, maxCommands, muteMs } = CONFIG.spam
  let rec = spamRecords.get(key)
  if (!rec) {
    rec = { times: [], mutedUntil: 0 }
    spamRecords.set(key, rec)
  }
  if (now < rec.mutedUntil) return true
  rec.times = rec.times.filter((t) => now - t < windowMs)
  rec.times.push(now)
  if (rec.times.length > maxCommands) {
    rec.mutedUntil = now + muteMs
    rec.times = []
    console.log(`[spam] ${name} silenciado ${Math.round(muteMs / 1000)} s`)
    sendChat(CONFIG.spam.message(name))
    return true
  }
  return false
}

loadBans()
if (!fs.existsSync(CONFIG.banFile)) saveBans()
if (!fs.existsSync(CONFIG.tpLogFile)) fs.writeFileSync(CONFIG.tpLogFile, '')

fs.watchFile(CONFIG.banFile, { interval: 2000 }, () => loadBans())
loadVips()
if (!fs.existsSync(CONFIG.vipFile)) saveVips()
fs.watchFile(CONFIG.vipFile, { interval: 2000 }, () => loadVips())

const outbox = []
let outboxTimer = null
let lastSentMsg = null
let holdUntil = 0
function say(text, opts = {}) {
  if (opts.droppable && (outbox.length > 0 || outboxTimer)) return
  outbox.push({ text, gen: generation, droppable: !!opts.droppable, tries: 0 })
  if (outboxTimer) return
  pump()
}
function pump() {
  outboxTimer = null
  const m = outbox.shift()
  if (!m) return
  const wait = holdUntil - Date.now()
  if (wait > 0) {
    outbox.unshift(m)
    outboxTimer = setTimeout(pump, wait)
    return
  }
  if (m.gen === generation) {
    try { bot.chat(m.text) } catch (_) {}
    lastSentMsg = { m, at: Date.now() }
  }
  outboxTimer = setTimeout(pump, CONFIG.chatGapMs)
}

function onRateLimit(secs) {
  holdUntil = Date.now() + Math.ceil(secs * 1000) + 250
  const l = lastSentMsg
  lastSentMsg = null
  if (l && Date.now() - l.at < 4000 && l.m.gen === generation && !l.m.droppable && l.m.tries < 4) {
    l.m.tries++
    outbox.unshift(l.m)
    console.log(`[chat] el servidor pidió esperar ${secs}s: reenvío "${l.m.text.slice(0, 40)}"`)
  }
  if (!outboxTimer) pump()
}
function clearOutbox() { outbox.length = 0 }

function sendChat(text) {
  console.log(`[bot dice] ${text}`)
  say(text)
}

function findPlayer(name) {
  return Object.values(bot.players).find((p) => p.username.toLowerCase() === name.toLowerCase())
}

function lookYawPitch(yawDeg, pitchDeg) {
  const twoPi = 2 * Math.PI
  const raw = Math.PI - (yawDeg * Math.PI) / 180
  const yaw = ((raw % twoPi) + twoPi) % twoPi
  const pitch = -(pitchDeg * Math.PI) / 180
  return bot.look(yaw, pitch, true)
}

let COMMANDS = {}
let TECH_RE = null
let KIT_RE = null

function findSenderName(zone, strict) {
  const botName = bot.username.toLowerCase()
  const candidates = new Set(CONFIG.admins)
  for (const p of Object.values(bot.players)) if (p.username) candidates.add(p.username)

  let sender = null
  let best = -1
  for (const name of candidates) {
    if (name.toLowerCase() === botName) continue
    const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(name)}(?![A-Za-z0-9_])`, 'gi')
    let m
    while ((m = re.exec(zone)) !== null) {
      if (m.index > best || (m.index === best && sender && name.length > sender.length)) {
        best = m.index
        sender = name
      }
    }
  }
  if (sender) return sender

  if (strict && Object.keys(bot.players).length <= 1) {
    const words = zone.match(/[A-Za-z0-9_]{3,16}/g)
    const last = words && words[words.length - 1]
    if (last && last.toLowerCase() !== botName) return last
  }
  return null
}

const SEPARATOR_RE = /[»›→➤➜➔❯❱▶►≫⟫:>]|\s[-–—]\s/

function parseChatCommand(message) {
  const kitM = KIT_RE.exec(message)
  const techM = TECH_RE.exec(message)
  let m
  let type
  if (kitM && (!techM || kitM.index <= techM.index)) {
    m = kitM
    type = 'kit'
  } else if (techM) {
    m = techM
    type = 'tech'
  } else {
    return null
  }

  const before = message.slice(0, m.index)
  const sepIdx = before.search(SEPARATOR_RE)
  const strict = sepIdx !== -1

  if (type === 'tech' && !strict) {
    console.log(`[chat] comando $ ignorado: no veo el separador (» : >) en esta línea: ${message}`)
    return null
  }

  const zone = strict ? before.slice(0, sepIdx) : before
  const sender = findSenderName(zone, strict)
  if (!sender) {
    console.log(`[chat] comando ignorado: no pude saber quién lo escribió: ${message}`)
    return null
  }

  const rest = message.slice(m.index + m[0].length).trim()
  return {
    type,
    cmd: type === 'kit' ? 'kit' : m[1].toLowerCase(),
    sender,
    rest,
    args: rest.split(/\s+/).filter(Boolean)
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isOwnMessage(message) {
  const sepIdx = message.search(SEPARATOR_RE)
  const head = sepIdx === -1 ? message : message.slice(0, sepIdx)
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(bot.username)}(?![A-Za-z0-9_])`, 'i')
  return re.test(head)
}

function onChat(message, position) {
  if (position === 'game_info') return
  const rl = /please wait\s+([\d.]+)\s*s?\s+to send another message/i.exec(message)
  if (rl) { onRateLimit(parseFloat(rl[1])); return }
  if (shuttingDown || restarting) return
  if (isOwnMessage(message)) return

  const c = parseChatCommand(message)
  if (!c) return

  if (c.type === 'kit') {
    handleKit(c.sender, c.args)
    return
  }

  if (!isAdmin(c.sender)) {
    console.log(`[permiso] ${c.sender} no puede usar $${c.cmd}`)
    return
  }

  console.log(`[cmd] ${c.sender}: $${c.cmd} ${c.rest}`)
  if (!['chat', 'atacar', 'stop', 'cola', 'e', 'limpiar', 'reiniciar', 'apagar', 'vip', 'unvip', 'viplist'].includes(c.cmd)) stopCombat()

  Promise.resolve()
    .then(() => COMMANDS[c.cmd]({ sender: c.sender, args: c.args, text: c.rest }))
    .catch((err) => console.log(`[error] $${c.cmd}: ${err.message}`))
}

function nearBase() {
  const b = CONFIG.base
  const p = bot.entity?.position
  if (!p) return false
  return Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) <= b.radius
}

function queueCount() {
  return queue.length + (activeRequest ? 1 : 0)
}

function refreshQueueState() {
  const n = queueCount()
  if (!queueClosed && n >= CONFIG.queue.max) {
    queueClosed = true
    console.log(`[cola] llena (${n}): no leo $kit hasta que baje a ${CONFIG.queue.reopenAt}`)
  } else if (queueClosed && n <= CONFIG.queue.reopenAt) {
    queueClosed = false
    console.log(`[cola] bajó a ${n}: vuelvo a leer $kit`)
  }
}

function sendKitList(sender) {
  const now = Date.now()
  if (now - (lastKitList.get(sender) || 0) < CONFIG.kitListThrottleMs) return
  lastKitList.set(sender, now)

  const avail = (names) => names.filter((n) => CONFIG.kits[n.toLowerCase()]).join(', ')
  const normies = avail(['redstone', 'cpvp', 'apvp', 'refill'])
  const exclusivos = avail(['Suministros', 'maparts', 'Perceoo'])
  const msg = `/msg ${sender} kits normies: ${normies}. | Kits exclusivos: ${exclusivos}.`
  sendChat(msg)
}

function handleKit(sender, args) {
  console.log(`[kit] ${sender} escribió: ${CONFIG.kitPrefix}kit ${args.join(' ')}`)

  if (isBanned(sender)) {
    console.log(`[kit] ${sender}: ignorado (baneado del bot)`)
    return
  }

  if (!isAdmin(sender) && isInappropriate(args.join(' '))) {
    banPlayer(sender, `pidió "${args.join(' ')}"`)
    sendChat(CONFIG.banMessage(sender))
    return
  }

  if (isSpamming(sender)) {
    console.log(`[kit] ${sender}: ignorado (spam)`)
    return
  }

  if (isQueued(sender)) {
    console.log(`[kit] ${sender}: ignorado (ya está en la cola)`)
    notify(sender, 'already', CONFIG.alreadyQueuedMessage(sender, queuePosition(sender)))
    return
  }

  if (queueClosed && !isAdmin(sender) && !isVip(sender)) {
    console.log(`[kit] ${sender}: ignorado (cola llena)`)
    notify(sender, 'full', CONFIG.queueFullMessage(sender))
    return
  }

  const kitName = (args[0] || '').toLowerCase()
  if (!CONFIG.kits[kitName]) {
    console.log(`[kit] ${sender}: kit inexistente "${kitName}", le mando la lista`)
    sendKitList(sender)
    return
  }
  requestKit(sender, kitName)
}

function requestKit(sender, kitName) {
  if (!bot.entity) return

  if (CONFIG.queue.ignoreWhenAway && (busy || queue.length > 0) && !nearBase()) {
    console.log(`[kit] ${sender} pidió ${kitName}: ignorado (en operación y lejos de la base)`)
    return
  }

  const cooldown = isAdmin(sender) ? CONFIG.adminCooldownMs : isVip(sender) ? CONFIG.vipCooldownMs : CONFIG.cooldownMs
  const now = Date.now()
  const wait = cooldown - (now - (lastRequest.get(sender) || 0))
  if (wait > 0) {
    console.log(`[kit] ${sender}: ignorado (cooldown, faltan ${Math.ceil(wait / 1000)} s)`)
    notify(sender, 'cooldown', CONFIG.cooldownMessage(sender, Math.ceil(wait / 1000)))
    return
  }
  lastRequest.set(sender, now)

  stopCombat()
  const wasWaiting = busy || queue.length > 0
  const req = { username: sender, kitName, wasWaiting }

  const pr = priorityOf(sender)
  let i = 0
  while (i < queue.length && priorityOf(queue[i].username) >= pr) i++
  queue.splice(i, 0, req)
  const pos = queuePosition(sender)
  console.log(`[kit] ${sender} pidió ${kitName} (cola: ${queueCount()})`)

  sendChat(CONFIG.queuedMessage(sender, pos, queueCount(), kitName))
  refreshQueueState()
  processQueue()
}

function isQueued(name) {
  const k = String(name).toLowerCase()
  return activeRequest?.username.toLowerCase() === k || queue.some((r) => r.username.toLowerCase() === k)
}

function queuePosition(name) {
  const k = String(name).toLowerCase()
  if (activeRequest?.username.toLowerCase() === k) return 1
  const i = queue.findIndex((r) => r.username.toLowerCase() === k)
  return i === -1 ? 0 : i + 1 + (activeRequest ? 1 : 0)
}

const lastNotice = new Map()
function notify(player, key, text) {
  const k = `${player.toLowerCase()}:${key}`
  const now = Date.now()
  if (now - (lastNotice.get(k) || 0) < CONFIG.noticeThrottleMs) return
  lastNotice.set(k, now)
  sendChat(text)
}

function startAnnouncer(gen) {
  stopAnnouncer()
  const { message, everyMs } = CONFIG.announce
  announceTimer = setInterval(() => {
    if (gen !== generation) return stopAnnouncer()
    say(message, { droppable: true })
  }, everyMs)
}

function stopAnnouncer() {
  if (announceTimer) clearInterval(announceTimer)
  announceTimer = null
}

async function processQueue() {
  if (busy) return
  busy = true
  const gen = generation
  while (gen === generation && queue.length > 0) {
    const req = queue.shift()
    activeRequest = req
    try {

      if (leftPlayers.has(req.username.toLowerCase())) {
        console.log(`[cola] ${req.username} ya no está conectado: lo salto`)
        lastRequest.delete(req.username)
        activeRequest = null
        refreshQueueState()
        continue
      }
      await returnToBase(gen)
      if (gen !== generation) return
      await serveRequest(req, gen)
    } catch (err) {
      if (gen !== generation) return
      if (err instanceof ChestEmptyError) {

        delete CONFIG.kits[req.kitName]
        carried.delete(req.kitName)
        lastRequest.delete(req.username)
        console.log(`[cofre] kit ${req.kitName} agotado: lo quito de la lista`)
        const left = Object.keys(CONFIG.kits)
        if (left.length === 0) {
          sendChat(`/msg ${req.username} El kit ${req.kitName} se agotó y ya no quedan kits. El bot se apagó.`)
          shutdown('se acabaron todos los kits')
          return
        }
        sendChat(`/msg ${req.username} El kit ${req.kitName} se agotó. Kits disponibles: ${left.join(', ')}`)
        activeRequest = null
        refreshQueueState()
        continue
      }
      console.log(`[error] ${req.username}/${req.kitName}: ${err.message}`)
      lastRequest.delete(req.username)
      sendChat(`/msg ${req.username} No pude entregar el kit ${req.kitName}: ${err.message}`)
    }
    if (gen !== generation) return
    activeRequest = null
    refreshQueueState()

    if (queue.length > 0 && CONFIG.queue.gapMs > 0) {
      await new Promise((r) => setTimeout(r, CONFIG.queue.gapMs))
    }
  }
  if (gen === generation) busy = false
}

async function returnToBase(gen) {
  if (!CONFIG.queue.returnCommand || nearBase()) return
  console.log('[cola] estoy lejos de la base: uso returnCommand')
  say(CONFIG.queue.returnCommand)
  await new Promise((r) => setTimeout(r, CONFIG.queue.returnWaitMs))
}

async function serveRequest({ username, kitName, wasWaiting }, gen) {
  const kit = CONFIG.kits[kitName]
  bot.pathfinder.setGoal(null)
  if (wasWaiting) sendChat(CONFIG.turnMessage(username, kitName))

  let item = refreshItem(carried.get(kitName))

  if (!item) {

    console.log(`[serve] ${username}: voy al cofre de ${kitName}`)
    await goToStand(kit)

    item = await takeFirstItem(kit)
    carried.set(kitName, item)
    console.log(`[serve] objeto tomado: ${describeItem(item)}`)
  }

  const teleported = waitForTeleport(CONFIG.tpTimeoutMs, username)
  say(CONFIG.tpCommand(username))
  console.log(`[tp] solicitud enviada a ${username}`)

  const tpOk = await teleported
  if (gen !== generation) return
  if (!tpOk) {

    lastRequest.delete(username)
    sendChat(`/msg ${username} No aceptaste el TP a tiempo. Vuelve a pedir el kit.`)
    return
  }

  logTeleportDestination(bot.entity.position)

  await bot.waitForTicks(10)
  const target = findPlayer(username)?.entity
  if (target) await bot.lookAt(target.position.offset(0, target.height, 0), true)

  item = refreshItem(item)
  if (!item) throw new Error('perdí el objeto antes de entregarlo')

  sendChat(CONFIG.killMessage(username))
  console.log(`[espera] esperando a que ${username} me mate...`)
  const died = await waitForDeathAndRespawn(CONFIG.waitForDeathMs)
  if (gen !== generation) return

  await bot.waitForTicks(Math.round(CONFIG.msgDelayMs / 50))
  if (gen !== generation) return
  if (died) {
    carried.delete(kitName)
    sendChat(CONFIG.deliveredMessage(username))
    console.log(`[muerte] ${kitName} entregado a ${username} (el bot murió y reapareció)`)
  } else {
    lastRequest.delete(username)
    sendChat(CONFIG.notKilledMessage(username))
    console.log('[espera] nadie me mató a tiempo, sigo con el kit encima')
  }
}

function waitForDeathAndRespawn(timeoutMs) {
  return new Promise((resolve) => {
    const b = bot
    let timer = null
    let respawnTimer = null
    const onSpawn = () => {
      clearTimeout(respawnTimer)
      resolve(true)
    }
    const onDeath = () => {
      if (timer) clearTimeout(timer)
      b.once('spawn', onSpawn)

      respawnTimer = setTimeout(() => {
        b.removeListener('spawn', onSpawn)
        resolve(true)
      }, 20000)
    }
    b.once('death', onDeath)
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        b.removeListener('death', onDeath)
        resolve(false)
      }, timeoutMs)
    }
  })
}

function withTimeout(promise, ms, msg) {
  let t
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

function distanceToStand(kit) {
  const s = kit.stand
  const p = bot.entity?.position
  return p ? Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) : Infinity
}

async function goToStand(kit) {
  const s = kit.stand
  let dist = distanceToStand(kit)

  if (dist > CONFIG.maxWalkDistance) {
    if (CONFIG.queue.returnCommand) {
      console.log(`[serve] estoy a ${Math.round(dist)} bloques del cofre: uso returnCommand`)
      say(CONFIG.queue.returnCommand)
      await new Promise((r) => setTimeout(r, CONFIG.queue.returnWaitMs))
      dist = distanceToStand(kit)
    }
    if (dist > CONFIG.maxWalkDistance) {
      console.log(`[error] el bot está a ${Math.round(dist)} bloques de los cofres. Ponlo cerca de la base (cama/spawn) o configura queue.returnCommand`)
      throw new Error('el bot está muy lejos de los cofres, avisa a un admin')
    }
  }

  try {
    await withTimeout(
      bot.pathfinder.goto(new goals.GoalBlock(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))),
      CONFIG.walkTimeoutMs,
      'tardó demasiado en llegar'
    )
  } catch (err) {
    try { bot.pathfinder.setGoal(null) } catch (_) {}
    throw new Error(`no pude llegar al cofre (${err.message})`)
  }
}

function snapshotInventory() {
  const snap = new Map()
  for (const it of bot.inventory.items()) snap.set(it.slot, { name: it.name, count: it.count })
  return snap
}

function kitNameOf(kit) {
  return Object.keys(CONFIG.kits).find((k) => CONFIG.kits[k] === kit) || '?'
}

async function takeFirstItem(kit) {
  try {
    return await takeFirstItemOnce(kit)
  } catch (err) {
    if (!(err instanceof ChestEmptyError)) throw err
    console.log('[cofre] se ve vacío, lo reviso una vez más...')
    await bot.waitForTicks(40)
    return takeFirstItemOnce(kit)
  }
}

async function takeFirstItemOnce(kit) {
  await lookYawPitch(kit.stand.yaw, kit.stand.pitch)

  let block = bot.blockAtCursor(5)
  if (!block || !CONTAINERS.includes(block.name)) {
    block = bot.findBlock({ matching: (b) => CONTAINERS.includes(b.name), maxDistance: 5 })
  }
  if (!block) throw new Error('no encontré el cofre')
  console.log(`[cofre] abriendo ${block.name} en ${block.position}`)

  const before = snapshotInventory()

  const chest = await withTimeout(bot.openContainer(block), 15000, 'el cofre no abrió')
  try {

    await waitForContents(chest)
    const items = chest.containerItems()
    console.log(`[cofre] contiene ${items.length} objetos: ${items.map(describeItem).join(' | ')}`)

    const item = items[0]
    if (!item) throw new ChestEmptyError(kit.name || kitNameOf(kit))
    console.log(`[cofre] tomando ${describeItem(item)}`)
    await bot.clickWindow(item.slot, 0, 1)
  } finally {
    chest.close()
  }

  const taken = await waitFor(
    () =>
      bot.inventory.items().find((i) => {
        const prev = before.get(i.slot)
        return !prev || prev.name !== i.name || i.count > prev.count
      }),
    3000
  )
  if (!taken) throw new Error('no pude sacar el objeto del cofre')
  return taken
}

async function waitForContents(chest, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (chest.containerItems().length > 0) return true
    await bot.waitForTicks(4)
  }
  return chest.containerItems().length > 0
}

async function waitFor(fn, timeoutMs, stepTicks = 4) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const value = fn()
    if (value) return value
    await bot.waitForTicks(stepTicks)
  }
  return fn() || null
}

const carried = new Map()

function refreshItem(item) {
  if (!item) return null
  const current = bot.inventory.slots[item.slot]
  return current && current.name === item.name ? current : null
}

function describeItem(item) {
  return `${item.count}x ${item.name}${item.customName ? ` "${item.customName}"` : ''}`
}

function waitForTeleport(timeoutMs, username) {
  return new Promise((resolve) => {
    const start = bot.entity.position.clone()
    const b = bot
    const cleanup = () => {
      clearTimeout(timer)
      b.removeListener('forcedMove', onMove)
      b.removeListener('playerLeft', onLeft)
    }

    const onLeft = (p) => {
      if (username && p.username.toLowerCase() === username.toLowerCase()) {
        cleanup()
        resolve(false)
      }
    }
    const onMove = () => {
      if (bot.entity.position.distanceTo(start) > 1.5) {
        cleanup()
        resolve(true)
      }
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, timeoutMs)
    b.on('forcedMove', onMove)
    b.on('playerLeft', onLeft)
  })
}

async function setSpawnAtBed() {
  if (!CONFIG.bed) return
  const block = bot.blockAt(CONFIG.bed)
  if (!block || !bot.isABed(block)) {
    console.log('[cama] no hay una cama en esa posición')
    return
  }
  await bot.pathfinder.goto(new goals.GoalNear(CONFIG.bed.x, CONFIG.bed.y, CONFIG.bed.z, 2))
  try {
    await bot.sleep(block)
    await bot.wake()
  } catch (err) {

    try { await bot.activateBlock(block) } catch (_) {}
  }
  console.log('[cama] intento de fijar spawn realizado')
}

async function entrySequence(gen) {
  try {
    await setSpawnAtBed()
  } catch (err) {
    console.log(`[cama] error: ${err.message}`)
  }

  const e = CONFIG.entry
  if (e) {
    try {
      await bot.pathfinder.goto(new goals.GoalNear(e.x, e.y, e.z, 1))
      await lookYawPitch(e.yaw, e.pitch)
      console.log('[entrada] llegó al punto de entrada')
    } catch (err) {
      console.log(`[entrada] no pude llegar: ${err.message}`)
    }
  }
  if (gen !== generation) return

  if (CONFIG.attackOnEntry && !busy && queue.length === 0) startCombat()
}

let combatTimer = null
let combatTargetId = null

function startCombat() {
  stopCombat()
  console.log('[combate] atacando al jugador más cercano')
  combatTimer = setInterval(combatTick, 650)
}

function stopCombat() {
  if (!combatTimer) return
  clearInterval(combatTimer)
  combatTimer = null
  combatTargetId = null
  bot.pathfinder.setGoal(null)
}

function combatTick() {
  const target = bot.nearestEntity(
    (e) =>
      e.type === 'player' &&
      e.username !== bot.username &&
      !(CONFIG.attackIgnoreAdmins && isAdmin(e.username))
  )
  if (!target) return

  if (target.id !== combatTargetId) {
    combatTargetId = target.id
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
  }

  if (bot.entity.position.distanceTo(target.position) <= 3.5) {
    bot.lookAt(target.position.offset(0, target.height * 0.9, 0), true)
    bot.attack(target)

    console.log(`[modo] primer golpe a ${target.username}: cambio de combate a kits`)
    stopCombat()
  }
}

function hold(control, secs) {
  const seconds = Math.min(Math.max(parseFloat(secs) || 1, 0.1), 30)
  bot.setControlState(control, true)
  setTimeout(() => bot.setControlState(control, false), seconds * 1000)
}

function tap(control, ms) {
  bot.setControlState(control, true)
  setTimeout(() => bot.setControlState(control, false), ms)
}

function toggle(control, arg) {
  const on = arg
    ? ['on', '1', 'si', 'sí', 'true'].includes(arg.toLowerCase())
    : !bot.controlState[control]
  bot.setControlState(control, on)
}

async function leftClick() {
  const ent = bot.entityAtCursor(4)
  if (ent) return bot.attack(ent)
  const block = bot.blockAtCursor(5)
  if (block) await bot.dig(block)
}

async function rightClick() {
  const ent = bot.entityAtCursor(4)
  if (ent) return bot.activateEntity(ent)
  const block = bot.blockAtCursor(5)
  if (block) return bot.activateBlock(block)
  bot.activateItem()
}

async function dropHeld(arg) {
  const item = bot.heldItem
  if (!item) return
  if (arg && ['stack', 'todo', 'all'].includes(arg.toLowerCase())) await bot.tossStack(item)
  else await bot.toss(item.type, null, 1)
}

function swapHands() {
  bot._client.write('block_dig', {
    status: 6,
    location: { x: 0, y: 0, z: 0 },
    face: 0,
    sequence: 0
  })
}

function showInventory(sender) {
  const items = bot.inventory.items().map((i) => `${i.count}x ${i.name}`)
  const text = items.length ? items.join(', ') : 'inventario vacío'
  console.log('[inv]', text)
  say(`/msg ${sender} ${text}`.slice(0, 250))
}

async function lookCommand(args) {
  if (args.length >= 2 && !isNaN(args[0]) && !isNaN(args[1])) {
    return lookYawPitch(parseFloat(args[0]), parseFloat(args[1]))
  }
  const p = args[0] && findPlayer(args[0])?.entity
  if (p) return bot.lookAt(p.position.offset(0, p.height, 0), true)
}

function stopAll() {
  stopCombat()
  bot.clearControlStates()
  bot.pathfinder.setGoal(null)
  console.log('[stop] todo detenido')
}

COMMANDS = {
  chat: ({ text }) => {
    if (text) say(text)
  },
  stop: () => stopAll(),
  atacar: () => startCombat(),
  w: ({ args }) => hold('forward', args[0]),
  a: ({ args }) => hold('left', args[0]),
  s: ({ args }) => hold('back', args[0]),
  d: ({ args }) => hold('right', args[0]),
  space: () => tap('jump', 200),
  shift: ({ args }) => toggle('sneak', args[0]),
  ctrl: ({ args }) => toggle('sprint', args[0]),
  lclick: () => leftClick(),
  rclick: () => rightClick(),
  q: ({ args }) => dropHeld(args[0]),
  f: () => swapHands(),
  e: ({ sender }) => showInventory(sender),
  mirar: ({ args }) => lookCommand(args),

  reiniciar: ({ sender }) => {
    sendChat(`/msg ${sender} Reiniciando el bot...`)
    setTimeout(() => restart(`pedido por ${sender}`), 1500)
  },
  apagar: ({ sender }) => {
    sendChat(`/msg ${sender} Apagando el bot...`)
    shutdown(`pedido por ${sender}`)
  },
  cola: ({ sender }) => {
    const n = queueCount()
    const names = [activeRequest, ...queue].filter(Boolean).map((r) => `${r.username}(${r.kitName})`)
    sendChat(`/msg ${sender} Cola: ${n}/${CONFIG.queue.max}${queueClosed ? ' (cerrada)' : ''}${names.length ? ' -> ' + names.join(', ') : ''}`)
  },
  vip: ({ sender, args }) => sendChat(`/msg ${sender} ${vipCommand(['vip', args[0]])}`.slice(0, 250)),
  unvip: ({ sender, args }) => sendChat(`/msg ${sender} ${vipCommand(['unvip', args[0]])}`.slice(0, 250)),
  viplist: ({ sender }) => sendChat(`/msg ${sender} ${vipCommand(['viplist'])}`.slice(0, 250)),
  limpiar: ({ sender }) => {
    const n = queue.length
    queue.length = 0
    refreshQueueState()
    sendChat(`/msg ${sender} Cola limpiada (${n} pedidos quitados).`)
  }
}
for (let i = 1; i <= 9; i++) COMMANDS[String(i)] = () => bot.setQuickBarSlot(i - 1)

const commandNames = Object.keys(COMMANDS).sort((x, y) => y.length - x.length)
TECH_RE = new RegExp(`\\$(${commandNames.join('|')})(?![A-Za-z0-9_])`, 'i')
KIT_RE = new RegExp(`${CONFIG.kitPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}kit(?![A-Za-z0-9_])`, 'i')

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const parts = line.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return
  const c = parts[0].toLowerCase()
  if (['reiniciar', 'restart', 'reboot'].includes(c)) return restart('consola')
  if (['apagar', 'stop', 'exit', 'quit', 'shutdown'].includes(c)) return shutdown('consola')
  if (['cola', 'queue'].includes(c)) {
    return console.log(`[cola] ${queueCount()}/${CONFIG.queue.max}${queueClosed ? ' (cerrada)' : ''}: ${[activeRequest, ...queue].filter(Boolean).map((r) => r.username + '(' + r.kitName + ')').join(', ') || 'vacía'}`)
  }
  if (['vip', 'unvip', 'viplist', 'vips'].includes(c)) return console.log(`[vip] ${vipCommand(parts)}`)
  console.log(`[baneos] ${banCommand(parts)}`)
})

process.on('uncaughtException', (err) => console.log('[error fatal evitado]', err && err.stack ? err.stack : err))
process.on('unhandledRejection', (err) => console.log('[promesa rechazada]', err && err.message ? err.message : err))

connect()
