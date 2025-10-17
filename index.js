// index.js
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { RestClient, FuturesClientV2 } = require('bitmart-api');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BITMART_API_KEY = process.env.BITMART_API_KEY;
const BITMART_API_SECRET = process.env.BITMART_API_SECRET;
const BITMART_API_MEMO = process.env.BITMART_API_MEMO || undefined;

if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}
if (!BITMART_API_KEY || !BITMART_API_SECRET) {
  console.error('Missing BitMart API keys in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Initialize BitMart clients
const restClient = new RestClient({
  apiKey: BITMART_API_KEY,
  apiSecret: BITMART_API_SECRET,
  apiMemo: BITMART_API_MEMO,
});
const futuresClient = new FuturesClientV2({
  apiKey: BITMART_API_KEY,
  apiSecret: BITMART_API_SECRET,
  apiMemo: BITMART_API_MEMO,
});

bot.start((ctx) => {
  ctx.reply(`Hello ${ctx.from.first_name || 'trader'}! Available commands:\n/balance\n/spot-buy symbol side amount price\n/spot-sell symbol side amount price\n/withdraw currency address amount\n/futures-order symbol side size price (for futures)`);
});

// 1) Get balances
bot.command('balance', async (ctx) => {
  try {
    const res = await restClient.getAccountBalancesV1();
    // res structure per SDK — print summary
    const balances = (res && res.data) ? res.data : res;
    // Build readable message (show only non-zero balances)
    const nonZero = (balances || []).filter(b => parseFloat(b.available) + parseFloat(b.frozen) > 0);
    if (nonZero.length === 0) {
      return ctx.reply('No non-zero balances found.');
    }
    const lines = nonZero.map(b => `${b.currency}: available=${b.available} frozen=${b.frozen}`);
    ctx.reply(lines.join('\n'));
  } catch (err) {
    console.error('balance error', err);
    ctx.reply('Error fetching balances: ' + (err.message || JSON.stringify(err)));
  }
});

/*
  Example usage:
  /spot-buy BTC_USDT buy 0.001 30000
  /spot-sell BTC_USDT sell 0.001 35000
*/
bot.command('spot-buy', async (ctx) => {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 5) return ctx.reply('Usage: /spot-buy SYMBOL side size price\nExample: /spot-buy BTC_USDT buy 0.001 30000');
  const [, symbol, side, size, price] = parts;
  try {
    const res = await restClient.submitSpotOrderV2({
      symbol,
      side, // 'buy' or 'sell'
      type: 'limit',
      size: String(size),
      price: String(price),
    });
    ctx.reply('Spot order response: ' + JSON.stringify(res));
  } catch (err) {
    console.error('spot-buy error', err);
    ctx.reply('Error placing spot buy: ' + (err.message || JSON.stringify(err)));
  }
});

bot.command('spot-sell', async (ctx) => {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 5) return ctx.reply('Usage: /spot-sell SYMBOL side size price\nExample: /spot-sell BTC_USDT sell 0.001 35000');
  const [, symbol, side, size, price] = parts;
  try {
    const res = await restClient.submitSpotOrderV2({
      symbol,
      side,
      type: 'limit',
      size: String(size),
      price: String(price),
    });
    ctx.reply('Spot sell response: ' + JSON.stringify(res));
  } catch (err) {
    console.error('spot-sell error', err);
    ctx.reply('Error placing spot sell: ' + (err.message || JSON.stringify(err)));
  }
});

/*
  Withdraw (example):
  /withdraw USDT <address> 10
  Note: many exchanges require whitelist, email/code confirmation, etc. Withdrawals may not work via API depending on key perms.
*/
bot.command('withdraw', async (ctx) => {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 4) return ctx.reply('Usage: /withdraw CURRENCY address amount\nExample: /withdraw USDT Txxxx 10');
  const [, currency, address, amount] = parts;
  try {
    // SDK method name may differ; check docs/examples. Many SDKs expose a withdraw/createWithdrawal endpoint.
    // Here we attempt a generic endpoint call. Replace with SDK withdraw method if available.
    const payload = {
      currency,
      amount: String(amount),
      address,
      // network?: 'TRC20', // add network param if required
      // destination?: 'address', // check API docs
    };
    // Some SDKs have createWithdrawalV1 or similar. We'll try a common naming convention:
    let res;
    if (typeof restClient.createWithdrawalV1 === 'function') {
      res = await restClient.createWithdrawalV1(payload);
    } else if (typeof restClient.submitWithdrawV1 === 'function') {
      res = await restClient.submitWithdrawV1(payload);
    } else {
      // Fallback: call raw REST path via SDK's generic request method (if present)
      if (typeof restClient.request === 'function') {
        res = await restClient.request('POST', '/wallet/withdrawal', payload);
      } else {
        throw new Error('Withdrawal method not available on installed SDK; check your SDK docs and adjust code.');
      }
    }
    ctx.reply('Withdraw response: ' + JSON.stringify(res));
  } catch (err) {
    console.error('withdraw error', err);
    ctx.reply('Error submitting withdrawal: ' + (err.message || JSON.stringify(err)));
  }
});

/*
  Futures order:
  /futures-order BTCUSDT long 1 30000
  Adapt to your contract symbol formatting as BitMart expects.
*/
bot.command('futures-order', async (ctx) => {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 5) return ctx.reply('Usage: /futures-order SYMBOL side size price\nExample: /futures-order BTCUSDT buy 1 30000');
  const [, symbol, side, size, price] = parts;
  try {
    // Example: using FuturesClientV2's typical submit method (check SDK for exact signature)
    if (typeof futuresClient.submitContractOrder === 'function') {
      const res = await futuresClient.submitContractOrder({
        symbol,
        side: side.toLowerCase(), // 'buy'/'sell' or 'open_long' — check SDK docs
        size: String(size),
        price: String(price),
        order_type: 'limit',
      });
      ctx.reply('Futures order response: ' + JSON.stringify(res));
    } else {
      // Some SDKs expose createOrderV2, placeOrder, etc. See docs if this branch triggers.
      throw new Error('Futures order method not found in SDK. See SDK docs for exact function name.');
    }
  } catch (err) {
    console.error('futures-order error', err);
    ctx.reply('Error placing futures order: ' + (err.message || JSON.stringify(err)));
  }
});

// Basic error handling
bot.catch((err, ctx) => {
  console.error(`Bot error for ${ctx.updateType}`, err);
});

// Launch
bot.launch()
  .then(() => console.log('Bot started'))
  .catch(err => console.error('Failed to start bot', err));

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
