import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'

import pino from 'pino'
import readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const tanya = (teks) =>
  new Promise(resolve => rl.question(teks, resolve))

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState('./session')

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  })

  if (!state.creds.registered) {
    const nomor = await tanya(
      'Masukkan nomor WhatsApp (contoh 62812xxxx): '
    )

    const kode = await sock.requestPairingCode(
      nomor.replace(/\D/g, '')
    )

    console.log('\nKODE WHATSAPP KAMU:', kode)
    console.log('Masukkan kode tersebut di WhatsApp!')
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('BOT BERHASIL ONLINE! 🔥')
    }

    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode

      if (status !== DisconnectReason.loggedOut) {
        startBot()
      } else {
        console.log('Silakan login ulang.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]

    if (!m.message || m.key.fromMe) return

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      ''

    if (text.trim().toLowerCase() === 'ping') {
      await sock.sendMessage(m.key.remoteJid, {
        text: 'Bot aktif! 🔥'
      })
    }
  })
}

startBot().catch
