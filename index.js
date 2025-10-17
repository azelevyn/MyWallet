// index.js
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const CoinPayments = require('coinpayments');
const express = require('express');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');

// --- config
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const cpPublic = process.env.CP_PUBLIC_KEY;
const cpPrivate = process.env.CP_PRIVATE_KEY;
const PORT = process.env.PORT || 3000;

if (!botToken || !cpPublic || !cpPrivate) {
  console.error('Missing TELEGRAM_BOT_TOKEN or CP_PUBLIC_KEY or CP_PRIVATE_KEY in .env');
  process.exit(1);
}

// --- DB (simple)
const db = new Database('./wallets.db');
db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY,
  telegram_id TEXT UNIQUE,
  username TEXT,
  currency TEXT,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// prepared statements
const insertWallet = db.prepare('INSERT OR REPLACE INTO wallets (telegram_id, username, currency, address) VALUES (@telegram_id, @username, @currency, @address)');
const getWalletByUser = db.prepare('SELECT * FROM wallets WHERE telegram_id = ?');

// --- CoinPayments client (wrapper)
const cp = new CoinPayments({
  key: cpPublic,
  secret: cpPrivate
});

// --- Telegram bot (Telegraf)
const bot = new Telegraf(botToken);

// helper: supported options mapping (user-friendly -> CoinPayments currency code)
const SUPPORTED = {
  'USDT (TRC20)': 'USDT.TRC20',
  'USDT (ERC20)': 'USDT.ERC20',
  'USDT (BEP20)': 'USDT.BEP20',
  'BTC': 'BTC',
  'ETH': 'ETH'
};

// start
bot.start(async (ctx) => {
  const name = ctx.from.first_name || 'User';
  await ctx.reply(`Hi ${name}! 👋\nSaya boleh generate alamat deposit untuk CoinPayments.\nPilih matawang:`, Markup.inlineKeyboard(
    Object.keys(SUPPORTED).map(k => Markup.button.callback(k, `choose|${k}`)),
    {columns: 2}
  ));
});

// handle choice
bot.action(/choose\|(.+)/, async (ctx) => {
  const label = ctx.match[1];
  const currency = SUPPORTED[label];
  if (!currency) return ctx.answerCbQuery('Unsupported');

  // check if user already has address for this currency
  const existing = getWalletByUser.get(String(ctx.from.id));
  if (existing && existing.currency === currency) {
    return ctx.editMessageText(`Anda sudah ada alamat untuk ${label}:\n\n${existing.address}\n\nGunakan alamat ini untuk deposit.`);
  }

  await ctx.answerCbQuery('Generating address...');
  try {
    // CoinPayments: get_callback_address (will return deposit address)
    // wrapper supports method 'get_callback_address'
    const res = await cp.get_callback_address({ currency });
    // res should contain .address (per API docs)
    if (!res || !res.address) {
      console.error('No address in CP response:', res);
      return ctx.reply('Gagal dapatkan alamat. Sila cuba lagi kemudian.');
    }

    // save to DB
    insertWallet.run({
      telegram_id: String(ctx.from.id),
      username: ctx.from.username || `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`,
      currency,
      address: res.address
    });

    await ctx.editMessageText(`Berjaya! Alamat deposit untuk ${label}:\n\n${res.address}\n\nSila hantar deposit ke alamat ini. Anda akan menerima notifikasi bila deposit dikesan.`);
  } catch (err) {
    console.error('Error get_callback_address:', err);
    await ctx.reply('Ralat semasa generate alamat. Pastikan kunci CoinPayments betul dan akaun anda aktif.');
  }
});

// simple command to check saved address
bot.command('myaddress', (ctx) => {
  const row = getWalletByUser.get(String(ctx.from.id));
  if (!row) return ctx.reply('Tiada alamat disimpan. Gunakan /start untuk mula.');
  return ctx.reply(`Alamat anda (${row.currency}):\n\n${row.address}`);
});

// launch bot and express for IPN
bot.launch().then(()=> console.log('Bot launched'));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// --- optional: Express IPN listener (CoinPayments will POST IPN events here)
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

/*
  NOTE:
  - CoinPayments IPN needs to be configured in your merchant account to POST to:
    https://yourdomain.com/ipn
  - IPN verification with HMAC header is recommended (see CoinPayments doc).
  - Here we just accept POST and log. For production you must verify HMAC.
*/
app.post('/ipn', (req, res) => {
  console.log('IPN received:', req.body);

  // basic example: if txn_type / status indicates deposit, notify user
  // CoinPayments sends merchant 'merchant' and 'ipn_type', 'status', 'address', 'amount', 'currency'
  try {
    const body = req.body;
    const address = body.address;
    const currency = body.currency;
    const status = parseInt(body.status, 10); // status >=100 or =2 typically confirmed
    // find user by address
    const row = db.prepare('SELECT * FROM wallets WHERE address = ?').get(address);
    if (row) {
      // if confirmed
      if (status >= 100 || status === 2) {
        // notify via Telegram (fire-and-forget)
        bot.telegram.sendMessage(row.telegram_id, `Deposit diterima!\nCurrency: ${currency}\nAddress: ${address}\nJumlah: ${body.amount}`);
      } else {
        // pending
        bot.telegram.sendMessage(row.telegram_id, `Deposit diterima (pending).\nCurrency: ${currency}\nAddress: ${address}\nJumlah: ${body.amount}\nStatus: ${status}`);
      }
    }
  } catch (e) {
    console.error('IPN processing error', e);
  }

  res.status(200).send('OK');
});

app.listen(PORT, () => {
  console.log(`Express IPN server running on port ${PORT}`);
});
