require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'youradminusername';
const PAYMENT_PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN;
const RATE = 0.0039; // 1 Star = 0.0039 USDT (≈ 250 Stars = 0.98 USDT)

// Database setup
const db = new Database('./sales.db');
db.exec(`
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  username TEXT,
  stars INTEGER,
  usdt REAL,
  usdt_address TEXT,
  paid INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// START
bot.start((ctx) => {
  ctx.reply(
    `👋 Hello ${ctx.from.first_name}!\n\nWelcome to the *Stars to USDT Exchange Bot*.\nYou can instantly sell your Telegram Stars balance and receive USDT (TRC20).\n\nClick the button below to start.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💫 Sell Stars for USDT', 'sell_stars')]
      ])
    }
  );
});

// SELL ACTION
bot.action('sell_stars', async (ctx) => {
  await ctx.editMessageText(
    'Select the amount of *Stars* you want to sell:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('250 Stars', 'stars_250'), Markup.button.callback('500 Stars', 'stars_500')],
        [Markup.button.callback('1000 Stars', 'stars_1000'), Markup.button.callback('2500 Stars', 'stars_2500')],
        [Markup.button.callback('5000 Stars', 'stars_5000'), Markup.button.callback('10000 Stars', 'stars_10000')],
        [Markup.button.callback('25000 Stars', 'stars_25000'), Markup.button.callback('50000 Stars', 'stars_50000')],
        [Markup.button.callback('100000 Stars', 'stars_100000')]
      ])
    }
  );
});

// When user selects amount
bot.action(/stars_(\d+)/, async (ctx) => {
  const stars = parseInt(ctx.match[1]);
  const usdt = (stars * RATE).toFixed(2);

  ctx.session = { stars, usdt };

  await ctx.editMessageText(
    `You chose *${stars} Stars*.\nThis equals *${usdt} USDT (TRC20)* 💵\n\nNow, please enter your *USDT TRC20 wallet address* where you’ll receive the payment.`,
    { parse_mode: 'Markdown' }
  );
});

// Get USDT address
bot.on('text', async (ctx) => {
  if (!ctx.session || !ctx.session.stars) return ctx.reply('Use /start to begin again.');

  const address = ctx.message.text.trim();
  const { stars, usdt } = ctx.session;

  // Confirm order
  await ctx.replyWithInvoice({
    title: `Sell ${stars} Stars`,
    description: `Exchange ${stars} Stars for ${usdt} USDT (TRC20)`,
    provider_token: PAYMENT_PROVIDER_TOKEN,
    currency: 'XTR', // for Stars
    prices: [{ label: `${stars} Stars`, amount: stars * 100000 }], // Telegram uses integer micro-units
    payload: JSON.stringify({ stars, usdt, address }),
    need_name: false,
    need_phone_number: false,
    need_email: false,
    is_flexible: false
  });

  await ctx.reply(
    `Please pay using your Stars balance to confirm your sell order.\nOnce paid, the admin will send ${usdt} USDT to:\n\`${address}\``,
    { parse_mode: 'Markdown' }
  );
});

// Handle pre-checkout
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

// Handle successful payment
bot.on('successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;
  const data = JSON.parse(payment.invoice_payload);

  db.prepare(`INSERT INTO sales (user_id, username, stars, usdt, usdt_address, paid)
              VALUES (?, ?, ?, ?, ?, 1)`)
    .run(String(ctx.from.id), ctx.from.username || '-', data.stars, data.usdt, data.address);

  await ctx.reply(
    `✅ Payment received!\nYou sold *${data.stars} Stars* for *${data.usdt} USDT*.\nAdmin will send your payment soon to:\n\`${data.address}\``,
    { parse_mode: 'Markdown' }
  );

  // Notify admin
  await bot.telegram.sendMessage(
    `@${ADMIN_USERNAME}`,
    `💰 *NEW SALE*\n\n👤 User: @${ctx.from.username || ctx.from.id}\n💫 Stars: ${data.stars}\n💵 USDT: ${data.usdt}\n🏦 Wallet: \`${data.address}\`\n\n✅ Payment completed via Stars.`,
    { parse_mode: 'Markdown' }
  );

  ctx.session = {};
});

bot.launch();
console.log('🚀 Bot is running and ready to accept Stars payments!');
