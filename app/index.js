// include requirements
const sqlite3         = require('sqlite3').verbose(),
      { Telegraf }    = require('telegraf'),
      TelegrafSession = require('telegraf-session-local'),
      winston         = require('winston');

// configuration variables with default values
const database_filename = 'data/database.db',
      loglevel          = process.env.LOGLEVEL || 'info',
      reply_format      = {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      },
      reply_timeout     = process.env.REPLY_TIMEOUT || 5,
      session_filename  = 'data/session.json',
      telegram_key      = process.env.TELEGRAM_KEY;

// initialize some components (datbase, bot, winston, etc.)
const db = new sqlite3.Database(database_filename);
const bot = new Telegraf(telegram_key);
const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      level: loglevel,
      handleExceptions: true,
      format: winston.format.combine(
        winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`+(info.splat!==undefined? `${info.splat}.` : '.'))
      )
    })
  ]
});

// enable session storage
bot.use((new TelegrafSession({ database: session_filename })).middleware());

// info command
bot.command('info', (ctx) => {
  ctx.reply('Hola')
  console.log(ctx)
});

// process every matched message
function processMessage(ctx, triggeredPun) {
  logger.info(`${ctx.update.update_id} - Matched message for ${triggeredPun.trigger} in channel ${ctx.message.chat.title} (${ctx.message.chat.id}) written by ${ctx.from.first_name} ${ctx.from.last_name} (@${ctx.from.username} - ${ctx.from.id})`);
  logger.debug(`${ctx.update.update_id} - ${JSON.stringify(ctx)}`);

  // get the chat configuration
  sql = 'SELECT * FROM chat WHERE id=?';
  db.get(sql, [ctx.message.chat.id], (err, chat) => {
    if (err) { throw err; }
    logger.debug(`${ctx.update.update_id} - ${JSON.stringify(chat)}`);

    // load/create chat configuration
    let chatConfiguration = '';
    let defaultChatConfiguration = {silent: 0, effectivity: 75, chatty: 1, use_globals: 1};
    if (! chat) {
      chatConfiguration = defaultChatConfiguration;
      sql = `INSERT INTO chat VALUES (?, ?, strftime('%s','now'))`;
      db.run(sql, [ctx.message.chat.id, JSON.stringify(chatConfiguration)], function(err) {
        if (err) { throw err; }

        logger.info(`${ctx.update.update_id} - Chat configuration is missing. Using the default configuration`);
      });
    }
    else {
      chatConfiguration = Object.assign(defaultChatConfiguration, JSON.parse(chat.config));
    }
    logger.debug(`${ctx.update.update_id} - ${JSON.stringify(chatConfiguration)}`);

    // exit if chat is silent
    if (chatConfiguration.silent == 1) {
      logger.info(`${ctx.update.update_id} - Not answering as the chat is configured as silent`);
      return;
    }

    // exit if effectivity applies
    randomEffectivity = Math.floor(Math.random() * 100) + 1;
    randomChattiness = Math.floor(Math.random() * 100) + 1;
    logger.debug(`${ctx.update.update_id} - ${randomEffectivity} ${randomChattiness}`);
    if (randomEffectivity > chatConfiguration.effectivity) {
      logger.info(`${ctx.update.update_id} - Not anwering as the effectivity (${chatConfiguration.effectivity}) is lower than random number (${randomEffectivity})`);

      // if chatty is enabled, send a funny text in 1/10 times
      if (chatConfiguration.chatty == 1 && randomChattiness > 90) {
        logger.info(`${ctx.update.update_id} - Sending tempting message`);
        randomAnswers = ["\u{1F910}", 'Tú juega y verás...', 'No me tientes...', 'Esta te la paso...', 'Mejor no digo nada...', 'Te estoy vigilando...'];
        ctx.reply(randomAnswers[randomEffectivity % randomAnswers.length], {reply_to_message_id: ctx.message.message_id});
      }

      return
    }

    // get the first pun randomly
    if (chatConfiguration.use_globals == 1) {
      sql = 'SELECT * FROM pun p LEFT JOIN puns_chats pc ON p.uuid=pc.pun_uuid WHERE (p.is_global=1 OR pc.chat_id=?) AND p.trigger=? ORDER BY RANDOM() LIMIT 1';
    }
    else {
      sql = 'SELECT * FROM pun p LEFT JOIN puns_chats pc ON p.uuid=pc.pun_uuid WHERE pc.chat_id=? AND p.trigger=? ORDER BY RANDOM() LIMIT 1';
    }
    db.get(sql, [ctx.message.chat.id, triggeredPun.trigger], (err, pun) => {
      if (err) { throw err; }
      logger.debug(`${ctx.update.update_id} - ${JSON.stringify(pun)}`);

      // send the answer
      logger.info(`${ctx.update.update_id} - Sending answer: ${pun.answer}`);
      ctx.reply(pun.answer, {reply_to_message_id: ctx.message.message_id});

      // update the stats
      sql = 'INSERT INTO punstats(uuid, counter, last_used_chat_id) VALUES (?, 1, ?) ON CONFLICT(uuid) DO UPDATE SET counter=counter+1';
      db.run(sql, [pun.uuid, ctx.message.chat.id], (err) => {
        if (err) { throw err; }
      });
    });
  });
}

// catch errors
bot.catch(error => {
  logger.error(`Telegraf error ${error.response} ${error.parameters} ${error.on || error}`);
});

// main function
async function startup() {
  await bot.launch();
  logger.info(`Bot started as ${ bot.botInfo.first_name } (@${ bot.botInfo.username })`);

  // register the callback function for all unique triggers
  let sql = 'select * from pun group by trigger;';
  db.each(sql, (err, pun) => {
    if (err) { throw err; }
    logger.info(`Registering callback for ${ pun.trigger }`);
    bot.hears(new RegExp(pun.trigger, 'i'), (ctx) => processMessage(ctx, pun));
  });
}
startup();

// graceful stop
process.once('SIGINT', () => {
  logger.info('Received SIGINT. Stopping bot..');
  db.close();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  logger.info('Received SIGTERM. Stopping bot..');
  db.close();
  bot.stop('SIGTERM');
});
