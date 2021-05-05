// include requirements
const async           = require('async'),
      sqlite3         = require('sqlite3').verbose(),
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

// process every single message
bot.on('message', (ctx) => {
  if(ctx) {
    if(ctx.message && ctx.message.text) {
      logger.info(JSON.stringify(ctx.message));

      sql = 'SELECT * FROM pun p LEFT JOIN puns_chats pc ON p.uuid=pc.pun_uuid WHERE (p.is_global=1 OR pc.chat_id=?) ORDER BY RANDOM()';
      let answer_with_pun = 0;
      db.all(sql, [ctx.message.chat.id], (err, rows) => {
        if (err) { throw err; }
        rows.every( row => {
          logger.info(JSON.stringify(row, null, 2));
          try {
            logger.info(`Processing pun trigger: ${row.trigger}`);
            let re = new RegExp(row.trigger);
            if (re.test(ctx.message.text)) {
              logger.info('Trigger matches. Sending answer');
              ctx.reply(row.pun, {reply_to_message_id: ctx.message.message_id });
              answer_with_pun = 1;
              return false;
            }
            logger.info('Trigger doesn\'t matches. Skipping...');
          } catch(e) {
            logger.info(`Error processing pun trigger: ${row.trigger}`);
          }
          return true;
        });

        if (answer_with_pun == 0) {
          ctx.reply('Por poco!');
        }
      });
    }
  }
});

// catch errors
bot.catch(error => {
  logger.error(`Telegraf error ${error.response} ${error.parameters} ${error.on || error}`);
});

// main function
async function startup() {
  await bot.launch();
  logger.info(`Bot started as ${ bot.botInfo.first_name } (@${ bot.botInfo.username })`);
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
