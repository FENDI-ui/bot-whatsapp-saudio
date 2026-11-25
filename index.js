
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'

import pino from 'pino'
import qrcode from 'qrcode-terminal'

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState('./session')

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('SCAN QR WHATSAPP:')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      console.log('BOT BERHASIL ONLINE! 🔥')
    }

    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode

      if (status !== DisconnectReason.loggedOut) {
        console.log('Menghubungkan ulang...')
        await new Promise(r => setTimeout(r, 3000))
        startBot()
      } else {
        console.log('Login ulang diperlukan.')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m?.message || m.key.fromMe) return

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text || ''

    if (text.trim().toLowerCase() === '.ping') {
      await sock.sendMessage(m.key.remoteJid, {
        text: 'Bot aktif! 🔥'
      })
    }
  })
}

startBot().catch(console.error)
  
