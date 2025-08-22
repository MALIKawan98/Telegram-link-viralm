const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');

// Firebase config from prompt
const firebaseConfig = {
  apiKey: "AIzaSyCoFDfCGbPpxT0ZOAICoqOyxW_qxn3rUl4",
  authDomain: "movies-web-site-e69c7.firebaseapp.com",
  databaseURL: "https://movies-web-site-e69c7-default-rtdb.firebaseio.com",
  projectId: "movies-web-site-e69c7",
  storageBucket: "movies-web-site-e69c7.appspot.com",
  messagingSenderId: "541854385779",
  appId: "1:541854385779:web:61c8dc1a5348e374744c06",
  measurementId: "G-D0WNK7RZ6P"
};

admin.initializeApp(firebaseConfig);
const db = admin.database();

// Bot token from env or hardcoded (use env in production)
const botToken = process.env.BOT_TOKEN || '8052117965:AAFXA2jDbplWU98ODy5UrcdbGLfjBpyLszc';
const bot = new Telegraf(botToken);

// Configurable admins (add your Telegram user IDs here)
const admins = []; // e.g., [123456789, 987654321]

// Helper functions for DB operations
async function getUser(userId) {
  const snap = await db.ref(`users/${userId}`).once('value');
  return snap.val() || { points: 0, joinedChannels: [], submissions: [], lastSeen: Date.now(), adminFlag: false, state: '', lastVerify: 0 };
}

async function setUser(userId, data) {
  data.lastSeen = Date.now();
  await db.ref(`users/${userId}`).set(data);
}

async function logAudit(action, byUserId, details) {
  const logId = db.ref('audit').push().key;
  await db.ref(`audit/${logId}`).set({ action, byUserId, timestamp: Date.now(), details });
}

// Initial required channels (add to DB if not exist)
const initialRequired = [
  { link: 'https://t.me/hackt2632' },
  { link: 'https://t.me/tirckandtip' },
  { link: 'https://t.me/viphack987_bot' }
];

(async () => {
  const requiredSnap = await db.ref('required_channels').once('value');
  if (!requiredSnap.exists()) {
    initialRequired.forEach(async (chan, index) => {
      const id = db.ref('required_channels').push().key;
      await db.ref(`required_channels/${id}`).set({ ...chan, addedBy: 'system', addedAt: Date.now() });
    });
  }
})();

// /start command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  let user = await getUser(userId);
  user.username = ctx.from.username;
  await setUser(userId, user);

  const welcomeText = `🎉 Welcome!\n👉 To continue, you MUST subscribe to the channels listed below.\n📢 The more channels you join, the more subscribers you'll receive back!\n⚠️ Important: Add this BOT as Admin in your own channel to receive subscribers automatically.`;
  await ctx.reply(welcomeText, Markup.inlineKeyboard([[Markup.button.callback('🚀 Continue', 'continue')]]));
});

// Continue button
bot.action('continue', async (ctx) => {
  await ctx.answerCbQuery();
  await checkRequiredJoins(ctx);
});

// Check and display required channels
async function checkRequiredJoins(ctx) {
  const userId = ctx.from.id;
  const requiredSnap = await db.ref('required_channels').once('value');
  const required = Object.values(requiredSnap.val() || {});

  const notJoined = [];
  for (let chan of required) {
    try {
      const chatId = chan.link.replace('https://t.me/', '@');
      const member = await retryGetChatMember(ctx.telegram, chatId, userId);
      if (!['member', 'administrator', 'creator'].includes(member.status)) {
        notJoined.push(chan);
      }
    } catch (e) {
      await logAudit('error', userId, `Required join check failed: ${e.message}`);
      ctx.reply('⚠️ Error checking membership. Try again.');
      return;
    }
  }

  if (notJoined.length > 0) {
    const text = '⚠️ You must join these required channels:';
    const keyboard = notJoined.map(chan => [Markup.button.url('Open Channel', chan.link)]);
    keyboard.push([Markup.button.callback('Verify', 'verify_required')]);
    await ctx.reply(text, Markup.inlineKeyboard(keyboard));
  } else {
    await showDynamicChannels(ctx);
  }
}

// Verify required button
bot.action('verify_required', async (ctx) => {
  await ctx.answerCbQuery();
  await checkRequiredJoins(ctx);
});

// Show dynamic 10 channels
async function showDynamicChannels(ctx) {
  const userId = ctx.from.id;
  const user = await getUser(userId);

  const poolSnap = await db.ref('pool_channels').once('value');
  let pool = Object.entries(poolSnap.val() || {}).map(([id, chan]) => ({ id, ...chan })).filter(c => c.approved);

  // Randomize and select 10 unique
  pool = pool.sort(() => 0.5 - Math.random()).slice(0, 10);
  user.currentPool = pool.map(c => c.link);
  await setUser(userId, user);

  const joined = user.joinedChannels || [];
  const progress = joined.filter(j => user.currentPool.includes(j)).length;
  let text = `🎯 Progress: ${progress}/10 channels joined ✅\nKeep going!`;

  const keyboard = [];
  for (let chan of pool) {
    const isJoined = joined.includes(chan.link);
    keyboard.push([
      Markup.button.url('Join Channel', chan.link),
      Markup.button.callback(isJoined ? '✅ Verified' : 'Verify Join', `verify_${chan.id}`)
    ]);
  }

  if (progress >= 10) {
    keyboard.push([Markup.button.callback('Submit Your Channel', 'submit')]);
  }

  await ctx.reply(text, Markup.inlineKeyboard(keyboard));
}

// Verify join for dynamic channel
bot.action(/verify_(.+)/, async (ctx) => {
  const channelId = ctx.match[1];
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const user = await getUser(userId);

  // Rate limit: 30s per verification
  if (Date.now() - user.lastVerify < 30000) {
    return ctx.reply('⚠️ Please wait 30 seconds before verifying again.');
  }
  user.lastVerify = Date.now();
  await setUser(userId, user);

  const chanSnap = await db.ref(`pool_channels/${channelId}`).once('value');
  const chan = chanSnap.val();
  if (!chan) return ctx.reply('⚠️ Invalid channel.');

  try {
    const chatId = chan.link.replace('https://t.me/', '@');
    const member = await retryGetChatMember(ctx.telegram, chatId, userId);
    if (['member', 'administrator', 'creator'].includes(member.status)) {
      if (!user.joinedChannels.includes(chan.link)) {
        user.joinedChannels.push(chan.link);
        user.points += 1;
        await setUser(userId, user);
        await db.ref(`pool_channels/${channelId}/verifiedJoinCount`).transaction(count => (count || 0) + 1);
        await logAudit('join_verified', userId, `Joined ${chan.link}`);
      }
      await showDynamicChannels(ctx);
    } else {
      ctx.reply('⚠️ Verification failed. Please make sure you joined the channel and that the bot is allowed to see your membership. Try again.');
    }
  } catch (e) {
    await logAudit('error', userId, `Verify failed: ${e.message}`);
    ctx.reply('⚠️ Error verifying. Try again.');
  }
});

// Submit channel button
bot.action('submit', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const user = await getUser(userId);
  user.state = 'submitting';
  await setUser(userId, user);
  await ctx.reply('Please submit your channel link (e.g., https://t.me/yourchannel or @yourchannel)');
});

// Handle text for submission
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const user = await getUser(userId);
  if (user.state !== 'submitting') return;

  let link = ctx.message.text.trim();
  if (!link.startsWith('https://t.me/') && !link.startsWith('@')) {
    return ctx.reply('⚠️ Invalid link format. Must start with https://t.me/ or @username.');
  }
  if (link.startsWith('@')) link = `https://t.me/${link.slice(1)}`;

  const chatId = link.replace('https://t.me/', '@');
  try {
    // Check if bot is admin in the channel
    const botMember = await retryGetChatMember(ctx.telegram, chatId, ctx.botInfo.id);
    if (!['administrator', 'creator'].includes(botMember.status)) {
      return ctx.reply('⚠️ Please add the bot as an administrator in your channel first.');
    }

    // Add to submissions (optional manual approve)
    const subId = db.ref('submissions').push().key;
    await db.ref(`submissions/${subId}`).set({
      ownerUserId: userId,
      link,
      status: 'pending', // Change to 'approved' if auto-approve
      addedAt: Date.now()
    });

    // For simplicity, auto-add to pool (admin can remove if needed)
    const poolId = db.ref('pool_channels').push().key;
    await db.ref(`pool_channels/${poolId}`).set({
      link,
      ownerUserId: userId,
      approved: true,
      addedAt: Date.now(),
      verifiedJoinCount: 0
    });

    user.submissions.push(link);
    user.state = '';
    await setUser(userId, user);
    await logAudit('submission', userId, `Submitted ${link}`);
    ctx.reply('🎉 Channel submitted! It will be shown to other users soon.');
  } catch (e) {
    await logAudit('error', userId, `Submission failed: ${e.message}`);
    ctx.reply('⚠️ Error: Invalid channel, private channel, or bot not admin. Try again.');
  }
});

// Admin commands
bot.command('add_required_channel', async (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  const link = ctx.message.text.split(' ').slice(1).join(' ');
  if (!link) return ctx.reply('Usage: /add_required_channel <link>');
  const id = db.ref('required_channels').push().key;
  await db.ref(`required_channels/${id}`).set({ link, addedBy: ctx.from.id, addedAt: Date.now() });
  await logAudit('add_required', ctx.from.id, link);
  ctx.reply('Added required channel.');
});

bot.command('remove_required_channel', async (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  const link = ctx.message.text.split(' ').slice(1).join(' ');
  const requiredSnap = await db.ref('required_channels').once('value');
  const toRemove = Object.entries(requiredSnap.val() || {}).find(([id, chan]) => chan.link === link);
  if (toRemove) {
    await db.ref(`required_channels/${toRemove[0]}`).remove();
    await logAudit('remove_required', ctx.from.id, link);
    ctx.reply('Removed required channel.');
  } else {
    ctx.reply('Channel not found.');
  }
});

bot.command('list_required_channels', async (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  const requiredSnap = await db.ref('required_channels').once('value');
  const list = Object.values(requiredSnap.val() || {}).map(chan => chan.link).join('\n');
  ctx.reply(`Required channels:\n${list || 'None'}`);
});

bot.command('set_pool_size', async (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  const size = parseInt(ctx.message.text.split(' ')[1]);
  if (isNaN(size) || size < 1) return ctx.reply('Usage: /set_pool_size <number>');
  await db.ref('config/pool_size').set(size);
  await logAudit('set_pool_size', ctx.from.id, size);
  ctx.reply(`Pool size set to ${size}.`);
});

bot.command('stats', async (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  const usersSnap = await db.ref('users').once('value');
  const submissionsSnap = await db.ref('submissions').once('value');
  const totalUsers = Object.keys(usersSnap.val() || {}).length;
  const totalSubs = Object.keys(submissionsSnap.val() || {}).length;
  // Pending verifications: simplistic, count pending submissions
  const pending = Object.values(submissionsSnap.val() || {}).filter(s => s.status === 'pending').length;
  ctx.reply(`Stats:\nTotal users: ${totalUsers}\nTotal submissions: ${totalSubs}\nPending: ${pending}`);
});

bot.command('approve_submission', async (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  const subId = ctx.message.text.split(' ')[1];
  if (!subId) return ctx.reply('Usage: /approve_submission <submissionId>');
  const subSnap = await db.ref(`submissions/${subId}`).once('value');
  if (subSnap.exists()) {
    await db.ref(`submissions/${subId}/status`).set('approved');
    const sub = subSnap.val();
    const poolId = db.ref('pool_channels').push().key;
    await db.ref(`pool_channels/${poolId}`).set({
      link: sub.link,
      ownerUserId: sub.ownerUserId,
      approved: true,
      addedAt: Date.now(),
      verifiedJoinCount: 0
    });
    await logAudit('approve_submission', ctx.from.id, subId);
    ctx.reply('Approved.');
  } else {
    ctx.reply('Not found.');
  }
});

bot.command('ban_channel', async (ctx) => {
  if (!admins.includes(ctx.from.id)) return;
  const link = ctx.message.text.split(' ').slice(1).join(' ');
  const poolSnap = await db.ref('pool_channels').once('value');
  const toBan = Object.entries(poolSnap.val() || {}).find(([id, chan]) => chan.link === link);
  if (toBan) {
    await db.ref(`pool_channels/${toBan[0]}`).remove();
    await logAudit('ban_channel', ctx.from.id, link);
    ctx.reply('Banned channel.');
  } else {
    ctx.reply('Not found.');
  }
});

// Retry wrapper for getChatMember with exponential backoff
async function retryGetChatMember(telegram, chatId, userId, retries = 3, delay = 1000) {
  try {
    return await telegram.getChatMember(chatId, userId);
  } catch (e) {
    if (retries > 0 && e.code === 'ETELEGRAM' && e.description.includes('retry')) { // Telegram-specific retry errors
      await new Promise(res => setTimeout(res, delay));
      return retryGetChatMember(telegram, chatId, userId, retries - 1, delay * 2);
    }
    throw e;
  }
}

// Launch bot (polling by default)
const launchOptions = {};
if (process.env.WEBHOOK_URL && process.env.PORT) {
  launchOptions.webhook = {
    domain: process.env.WEBHOOK_URL,
    port: parseInt(process.env.PORT)
  };
}
bot.launch(launchOptions);
console.log('Bot started.');

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
