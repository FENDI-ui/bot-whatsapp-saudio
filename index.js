import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage
} from '@whiskeysockets/baileys'
import pino from 'pino'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const PREFIX = '!'
const OWNER_FILE = './owner.json'
const SESSION_DIR = './session'
const TEMP_DIR = path.join(os.tmpdir(), 'saudio-bot')
const AUTO_REPLY_COOLDOWN_MS = 30_000

let ownerNumber = ''
let botMode = 'public' // public | self
const autoReplyAt = new Map()
const ffmpegPath = ffmpegInstaller.path

await mkdir(TEMP_DIR, { recursive: true })

try {
  const cfg = JSON.parse(await readFile(OWNER_FILE, 'utf8'))
  ownerNumber = String(cfg.ownerNumber || '').replace(/\D/g, '')
  botMode = cfg.mode === 'self' ? 'self' : 'public'
} catch {}

async function saveConfig() {
  await writeFile(OWNER_FILE, JSON.stringify({ ownerNumber, mode: botMode }, null, 2))
}

function jidNumber(jid = '') {
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '')
}
function isOwner(jid) {
  return Boolean(ownerNumber) && jidNumber(jid) === ownerNumber
}
function unwrapMessage(message = {}) {
  let m = message
  while (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage) {
    m = m.ephemeralMessage?.message || m.viewOnceMessage?.message ||
        m.viewOnceMessageV2?.message || m.documentWithCaptionMessage?.message || m
  }
  return m
}
function getText(message = {}) {
  const m = unwrapMessage(message)
  return m.conversation || m.extendedTextMessage?.text ||
    m.imageMessage?.caption || m.videoMessage?.caption ||
    m.documentMessage?.caption || ''
}
function getQuotedMessage(message = {}) {
  const m = unwrapMessage(message)
  return m.extendedTextMessage?.contextInfo?.quotedMessage ||
    m.imageMessage?.contextInfo?.quotedMessage ||
    m.videoMessage?.contextInfo?.quotedMessage || null
}
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-y', ...args])
    let err = ''
    proc.stderr.on('data', d => err += d.toString())
    proc.on('error', reject)
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(-1800) || `FFmpeg exit ${code}`)))
  })
}
async function downloadToFile(sock, msg, filePath) {
  const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
    logger: pino({ level: 'silent' }),
    reuploadRequest: sock.updateMediaMessage
  })
  await writeFile(filePath, buffer)
  return filePath
}
function parseTime(value) {
  if (!/^\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) {
    throw new Error('Format waktu harus HH:MM:SS, contoh 00:00:05')
  }
  return value
}
function helpText() {
  return `╭─「 SAUDIO BOT 」\n│ Mode: ${botMode.toUpperCase()}\n│ Prefix: ${PREFIX}\n├─ AUTO\n│ Chat biasa: balasan otomatis\n├─ STICKER\n│ !sticker (balas/kirim gambar atau video pendek)\n├─ AUDIO\n│ !toaudio (balas video untuk ekstrak audio)\n│ !tomp3 (balas audio/video untuk MP3)\n│ !saudio --crop MULAI AKHIR (balas audio/video)\n├─ VIDEO\n│ !crop MULAI AKHIR (balas video)\n├─ OWNER\n│ !public  - izinkan semua pengguna\n│ !self    - khusus pemilik\n│ !menu    - tampilkan menu\n╰────────────────`
}
async function sendHelp(sock, jid) {
  await sock.sendMessage(jid, { text: helpText() })
}
async function handleMediaCommand(sock, msg, jid, command, args) {
  const quoted = getQuotedMessage(msg.message)
  const sourceMsg = quoted ? { ...msg, message: quoted } : msg
  const raw = unwrapMessage(sourceMsg.message)
  const image = raw.imageMessage
  const video = raw.videoMessage
  const audio = raw.audioMessage
  if (command === 'sticker') {
    if (!image && !video) throw new Error('Kirim atau balas gambar/video pendek dengan !sticker.')
    if (video && (video.seconds || 0) > 10) throw new Error('Video stiker maksimal 10 detik.')
    const inputFile = path.join(TEMP_DIR, `${Date.now()}_in`)
    const outputFile = path.join(TEMP_DIR, `${Date.now()}.webp`)
    await downloadToFile(sock, sourceMsg, inputFile)
    if (image) {
      await runFfmpeg(['-i', inputFile, '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-vcodec', 'libwebp', '-lossless', '1', outputFile])
    } else {
      await runFfmpeg(['-i', inputFile, '-t', '10', '-vf', 'fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-vcodec', 'libwebp', '-loop', '0', '-an', '-vsync', '0', outputFile])
    }
    await sock.sendMessage(jid, { sticker: await readFile(outputFile) }, { quoted: msg })
    await unlink(inputFile).catch(()=>{}); await unlink(outputFile).catch(()=>{})
    return
  }
  if (command === 'toaudio' || command === 'tomp3' || command === 'saudio' || command === 'crop') {
    if (!image && !video && !audio) throw new Error(`Kirim atau balas media terlebih dahulu. Lihat !menu.`)
    const inputFile = path.join(TEMP_DIR, `${Date.now()}_input`)
    const outputFile = path.join(TEMP_DIR, `${Date.now()}_${command}.${command === 'crop' ? 'mp4' : 'mp3'}`)
    await downloadToFile(sock, sourceMsg, inputFile)
    if (command === 'crop') {
      if (!video) throw new Error('!crop digunakan untuk video. Balas video dengan !crop 00:00:05 00:00:15')
      if (args.length < 2) throw new Error('Format: !crop 00:00:05 00:00:15')
      const start = parseTime(args[0]), end = parseTime(args[1])
      await runFfmpeg(['-ss', start, '-to', end, '-i', inputFile, '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', outputFile])
      await sock.sendMessage(jid, { video: await readFile(outputFile), caption: 'Video berhasil dipotong.' }, { quoted: msg })
    } else {
      if (command === 'saudio') {
        if (args[0] !== '--crop' || args.length < 3) throw new Error('Format: !saudio --crop 00:00:05 00:00:15')
        const start = parseTime(args[1]), end = parseTime(args[2])
        await runFfmpeg(['-ss', start, '-to', end, '-i', inputFile, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', outputFile])
      } else {
        await runFfmpeg(['-i', inputFile, '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k', outputFile])
      }
      await sock.sendMessage(jid, { audio: await readFile(outputFile), mimetype: 'audio/mpeg', fileName: 'saudio.mp3' }, { quoted: msg })
    }
    await unlink(inputFile).catch(()=>{}); await unlink(outputFile).catch(()=>{})
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log('SAUDIO BOT ONLINE 🔥 Mode:', botMode)
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode
      if (status !== DisconnectReason.loggedOut) {
        console.log('Koneksi terputus, mencoba menyambung kembali...')
        setTimeout(startBot, 3000)
      } else {
        console.log('Sesi keluar. Hapus folder session hanya jika ingin menautkan ulang.')
      }
    }
  })

  if (!state.creds.registered) {
    const rl = createInterface({ input: stdin, output: stdout })
    const number = await rl.question('Nomor WhatsApp bot (format 62xxxxxxxx): ')
    const clean = number.replace(/\D/g, '')
    if (!/^\d{10,15}$/.test(clean)) throw new Error('Nomor tidak valid. Gunakan kode negara, contoh 62812...')
    const code = await sock.requestPairingCode(clean)
    console.log('KODE TAUTAN (rahasia):', code)
    rl.close()
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue
        const jid = msg.key.remoteJid
        if (!jid || jid === 'status@broadcast') continue
        const senderIsOwner = isOwner(jid)
        if (botMode === 'self' && !senderIsOwner) continue

        const body = getText(msg.message).trim()
        const isCommand = body.startsWith(PREFIX)
        if (!isCommand) {
          if (botMode === 'public') {
            const now = Date.now()
            const last = autoReplyAt.get(jid) || 0
            if (now - last >= AUTO_REPLY_COOLDOWN_MS) {
              autoReplyAt.set(jid, now)
              await sock.sendMessage(jid, { text: 'Halo! 👋 Pesan kamu sudah diterima. Ketik !menu untuk melihat fitur SAUDIO BOT.' }, { quoted: msg })
            }
          }
          continue
        }

        const [rawCommand, ...args] = body.slice(PREFIX.length).split(/\s+/)
        const command = rawCommand.toLowerCase()

        if (['public', 'self'].includes(command)) {
          if (!senderIsOwner) {
            await sock.sendMessage(jid, { text: 'Perintah ini khusus pemilik bot.' }, { quoted: msg })
            continue
          }
          botMode = command
          await saveConfig()
          await sock.sendMessage(jid, { text: `Mode bot sekarang: ${botMode.toUpperCase()}` }, { quoted: msg })
          continue
        }
        if (command === 'menu' || command === 'help') {
          await sendHelp(sock, jid); continue
        }
        if (command === 'owner') {
          await sock.sendMessage(jid, { text: ownerNumber ? `Owner: wa.me/${ownerNumber}` : 'Owner belum diatur.' }, { quoted: msg })
          continue
        }
        if (['sticker', 'toaudio', 'tomp3', 'saudio', 'crop'].includes(command)) {
          await sock.sendMessage(jid, { text: 'Sedang memproses media, tunggu sebentar...' }, { quoted: msg })
          await handleMediaCommand(sock, msg, jid, command, args)
          continue
        }
        await sock.sendMessage(jid, { text: 'Perintah tidak dikenal. Ketik !menu.' }, { quoted: msg })
      } catch (err) {
        console.error('Gagal memproses pesan:', err.message)
        const jid = msg.key.remoteJid
        if (jid) await sock.sendMessage(jid, { text: `Gagal: ${err.message}` }).catch(()=>{})
      }
    }
  })
}

const rl = createInterface({ input: stdin, output: stdout })
if (!ownerNumber) {
  ownerNumber = (await rl.question('Nomor pemilik bot (format 62xxxxxxxx): ')).replace(/\D/g, '')
  await saveConfig()
}
rl.close()

startBot().catch(err => {
  console.error('Bot gagal dijalankan:', err)
  process.exitCode = 1
})
