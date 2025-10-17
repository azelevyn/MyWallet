require('dotenv').config();
const { Telegraf } = require('telegraf');
const { Spot, Contract } = require('@bitmartexchange/bitmart-node-sdk');

// === Environment Variables ===
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_KEY = process.env.BITMART_API_KEY;
const API_SECRET = process.env.BITMART_API_SECRET;
const API_MEMO = process.env.BITMART_API_MEMO;

if (!BOT_TOKEN || !API_KEY || !API_SECRET) {
  console.error('Missing .env values. Please set TELEGRAM_BOT_TOKEN and BitMart API keys.');
  process.exit(1);
}

// === Initialize Clients ===
const bot = new Telegraf(BOT_TOKEN);
const spotClient = new Spot({
  apiKey: API_KEY,
  apiSecret: API_SECRET,
  memo: API_MEMO,
});
const futuresClient = new Contract({
  apiKey: API_KEY,
  apiSecret: API_SECRET,
  memo: API_MEMO,
});

// === Start Command ===
bot.start((ctx) => {
  ctx.reply(
    `👋 Hello ${ctx.from.first_name || 'trader'}!\n\n` +
    `Here are available commands:\n` +
    `/balance - Check your account balances\n` +
    `/spotbuy BTC_USDT 0.001 30000 - Buy spot order\n` +
    `/spotsell BTC_USDT 0.001 35000 - Sell spot order\n` +
    `/withdraw USDT <address> 10 - Withdraw funds\n` +
    `/futures BTCUSDT buy 1 30000 - Futures order`
  );
});

// === Check Balance ===
bot.command('balance', async (ctx) => {
  try {
    const result = await spotClient.getAccountBalance();
    const balances = result.data?.balances || [];
    const nonZero = balances.filter(b => parseFloat(b.available) > 0 || parseFloat(b.frozen) > 0);
    if (nonZero.length === 0) return ctx.reply('No non-zero balances found.');

    let msg = '💰 Your Balances:\n';
    for (const b of nonZero) {
      msg += `${b.currency}: available=${b.available}, frozen=${b.frozen}\n`;
    }
    ctx.reply(msg);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Error getting balance: ' + err.message);
  }
});

// === Spot Buy ===
bot.command('spotbuy', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 4) return ctx.reply('Usage: /spotbuy SYMBOL SIZE PRICE\nExample: /spotbuy BTC_USDT 0.001 30000');
  const [, symbol, size, price] = parts;

  try {
    const res = await spotClient.submitOrder({
      symbol,
      side: 'buy',
      type: 'limit',
      size,
      price,
    });
    ctx.reply(`✅ Spot BUY order placed!\n${JSON.stringify(res, null, 2)}`);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Error placing buy order: ' + err.message);
  }
});

// === Spot Sell ===
bot.command('spotsell', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 4) return ctx.reply('Usage: /spotsell SYMBOL SIZE PRICE\nExample: /spotsell BTC_USDT 0.001 35000');
  const [, symbol, size, price] = parts;

  try {
    const res = await spotClient.submitOrder({
      symbol,
      side: 'sell',
      type: 'limit',
      size,
      price,
    });
    ctx.reply(`✅ Spot SELL order placed!\n${JSON.stringify(res, null, 2)}`);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Error placing sell order: ' + err.message);
  }
});

// === Withdraw ===
bot.command('withdraw', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 4)
    return ctx.reply('Usage: /withdraw CURRENCY ADDRESS AMOUNT\nExample: /withdraw USDT TXxxxxxx 10');

  const [, currency, address, amount] = parts;

  try {
    const res = await spotClient.submitWithdraw({
      currency,
      amount,
      address,
      network: 'TRC20', // modify based on your coin network
    });
    ctx.reply(`✅ Withdrawal submitted!\n${JSON.stringify(res, null, 2)}`);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Error submitting withdrawal: ' + err.message);
  }
});

// === Futures Order ===
bot.command('futures', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 5)
    return ctx.reply('Usage: /futures SYMBOL SIDE SIZE PRICE\nExample: /futures BTCUSDT buy 1 30000');

  const [, symbol, side, size, price] = parts;

  try {
    const res = await futuresClient.submitOrder({
      symbol,
      side: side.toUpperCase(),
      type: 'limit',
      size,
      price,
    });
    ctx.reply(`✅ Futures order placed!\n${JSON.stringify(res, null, 2)}`);
  } catch (err) {
    console.error(err);
    ctx.reply('❌ Error placing futures order: ' + err.message);
  }
});

// === Global Error Handling ===
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
});

// === Launch ===
bot.launch()
  .then(() => console.log('✅ Telegram Bot started successfully'))
  .catch(err => console.error('❌ Failed to start bot:', err));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
