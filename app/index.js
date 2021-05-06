// include requirements
const sqlite3         = require('sqlite3').verbose(),
      { Telegraf }    = require('telegraf'),
      TelegrafSession = require('telegraf-session-local'),
      winston         = require('winston');

// configuration variables with default values
const database_filename = 'data/database.db',
      loglevel          = process.env.LOGLEVEL || 'info',
      reply_timeout     = process.env.REPLY_TIMEOUT || 5,
      session_filename  = 'data/session.json',
      telegram_key      = process.env.TELEGRAM_KEY,
      version           = '1.0.0';

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

// hack to handle async / await operations
db.query = function (sql, params) {
  var that = this;
  return new Promise(function (resolve, reject) {
    that.all(sql, params, function (error, rows) {
      if (error)
        reject(error);
      else
        resolve({ rows: rows });
    });
  });
};

// enable session storage
bot.use((new TelegrafSession({ database: session_filename })).middleware());

// load chat configuration from database
async function getChatConfiguration(id) {
  let chatConfiguration = '';
  let defaultChatConfiguration = {silent: 0, effectivity: 75, chatty: 1, use_globals: 1};

  // get the chat configuration
  try {
    sql = 'SELECT * FROM chat WHERE id=?';
    const result = await db.query(sql, [id]);

    const chat = result.rows[0];
    if (! chat) {
      // if no results, create a new configuration
      chatConfiguration = defaultChatConfiguration;
      sql = `INSERT INTO chat (id, config) VALUES (?, ?)`;
      db.run(sql, [id, JSON.stringify(chatConfiguration)], function(err) {
        if (err) { throw err; }
      });
    }
    else {
      // override the default settings with those in the database
      chatConfiguration = Object.assign(defaultChatConfiguration, JSON.parse(chat.config));
    }

    return chatConfiguration;
  } catch (e) { return logger.error(e.message); }
}

// save chat configuration to database
async function saveChatConfiguration(id, chatConfiguration) {
  try {
    sql = 'INSERT INTO chat (id, config) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET config=?';
    //sql = `UPDATE chat SET config=? WHERE id=?`;
    db.run(sql, [id, JSON.stringify(chatConfiguration), JSON.stringify(chatConfiguration)], function(err) {
      if (err) { throw err; }
      return;
    });
  } catch (e) { return logger.error(e.message); }
}

// process a message which matched a trigger
function processMessage(ctx, triggeredPun) {
  logger.info(`${ctx.update.update_id} - Matched message for ${triggeredPun.trigger} in channel ${ctx.message.chat.title} (${ctx.message.chat.id}) written by ${ctx.from.first_name} ${ctx.from.last_name} (@${ctx.from.username} - ${ctx.from.id})`);
  logger.debug(`${ctx.update.update_id} - ${JSON.stringify(ctx)}`);

  // get the chat configuration
  getChatConfiguration(ctx.message.chat.id)
  .then( (chatConfiguration) => {
    // exit if chat is silent
    if (chatConfiguration.silent == 1) {
      logger.info(`${ctx.update.update_id} - Not answering because the chat is configured as silent`);
      return;
    }

    // exit if effectivity applies
    randomEffectivity = Math.floor(Math.random() * 100) + 1;
    randomChattiness = Math.floor(Math.random() * 100) + 1;
    logger.debug(`${ctx.update.update_id} - ${randomEffectivity} ${randomChattiness}`);
    if (randomEffectivity > chatConfiguration.effectivity) {
      logger.info(`${ctx.update.update_id} - Not anwering as the effectivity (${chatConfiguration.effectivity}) is lower than random number (${randomEffectivity})`);

      // if chatty is enabled, send a funny text in 1/4 times
      if (chatConfiguration.chatty == 1 && randomChattiness > 75) {
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

// help command
bot.command(['start', 'ayuda'], (ctx) => {
  message = `Quevedo (@puns2bot) es un bot que odiarás o amarás, \
sin términos medios. \
Es el tipico amigo gracioso (y pesado) que no puede evitar decirte _Por el \
culo te la hinco!_ cuando dices el número cinco.

Tiene unas cuantas rimas predefinidas (que puedes desactivar si no te \
gustan) y agregarle las tuyas propias para tu canal. Si se pone pesado, podrás \
mandarle callar un rato o bajar la frecuencia con la que contesta a las rimas.

Si necesitas más ayuda, o tienes sugerencias, o quieres desahogarte porque el \
dichoso bot te saca de quicio, puedes contactar con @Soukron.

Finalmente, si este bot te hace reir y te apetece pagarme una birra, puedes \
hacerlo en https://www.buymeacoffee.com/soukron, aunque también acepto sobornos \
para que Quevedo se cebe con alguien en concreto o para que le deje tranquilo.

*Comandos:*
 - para gestionar las rimas: /rimas
 - para cambiar la configuración: /configuracion
 - para ver esta ayuda otra vez: /ayuda
*Versión:* ${version}
*Chat Id:* ${ctx.message.chat.id}
`

  ctx.telegram.sendMessage(ctx.chat.id, message, {
    reply_to_message_id: ctx.message.message_id,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
});

// configuration command
bot.command('configuracion', (ctx) => {
  // TODO: make this more general
  effectivityText={10: 'Muy pocas', 25: 'Pocas', 50: 'La mitad de las', 75: 'Muchas'};

  // get the chat configuration
  getChatConfiguration(ctx.message.chat.id)
  .then( (chatConfiguration) => {
    message = `Esta es mi configuración actual:
 - *Rimas silenciadas:* ${chatConfiguration.silent > 0? 'Si' : 'No'}
 - *Frecuencia:* ${effectivityText[chatConfiguration.effectivity]} veces
 - *Rimas globales activas:* ${chatConfiguration.use_globals == 1? 'Si' : 'No'}

Si algo no te parece bien, puedes usar ajustar los parametros a tu gusto:`

    ctx.telegram.sendMessage(ctx.chat.id, message, {
      reply_to_message_id: ctx.message.message_id,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard:[
          [{text: 'Silenciar', callback_data: `menu-silent-${ctx.message.message_id}`}, {text: 'Frecuencia', callback_data: `menu-effectivity-${ctx.message.message_id}`}],
          [{text: 'Rimas globales', callback_data: `menu-globals-${ctx.message.message_id}`}],
          [{text: 'Cerrar', callback_data: `close-${ctx.message.message_id}`}],
        ]
      }
    });
  });
});

// callback to show a menu
bot.action(/^menu-(\w+)-(.*)$/i, (ctx) => {
  ctx.deleteMessage();
  switch(ctx.match[1]) {
    case 'silent':
      message = `Vaya vaya, alguien se ha mosqueado.
Cuánto tiempo quieres dejarme sin hablar?`
      reply_markup = {
        inline_keyboard:[
          [{text: '5 min.', callback_data: `set-silent-5-${ctx.match[2]}`}, {text: '10 min.', callback_data: `set-silent-10-${ctx.match[2]}`}],
          [{text: '30 min.', callback_data: `set-silent-30-${ctx.match[2]}`}, {text: '60 min.', callback_data: `set-silent-60-${ctx.match[2]}`}],
          [{text: 'No silenciar', callback_data: `set-silent-0-${ctx.match[2]}`}],
          [{text: 'Cerrar', callback_data: `close-${ctx.match[2]}`}],
        ]
      }
      break;

    case 'effectivity':
      message = `Algo me dice que no me estoy comportando bien.
Cuántas veces quieres que conteste con rimas?`
      reply_markup = {
        inline_keyboard:[
          [{text: 'Pocas', callback_data: `set-effectivity-10-${ctx.match[1]}`}, {text: 'Algunas', callback_data: `set-effectivity-25-${ctx.match[1]}`}],
          [{text: 'La mitad', callback_data: `set-effectivity-50-${ctx.match[1]}`}, {text: 'Muchas', callback_data: `set-effectivity-75-${ctx.match[1]}`}],
          [{text: 'Cerrar', callback_data: `close-${ctx.match[1]}`}],
        ]
      }
      break;

    case 'globals':
      message = `Quieres que utilice las rimas que ya me se? O solo las que me enseñes?`
      reply_markup = {
        inline_keyboard:[
          [{text: 'Todas', callback_data: `set-globals-1-${ctx.match[1]}`}, {text: 'Solo las del canal', callback_data: `set-globals-0-${ctx.match[1]}`}],
          [{text: 'Cerrar', callback_data: `close-${ctx.match[1]}`}],
        ]
      }
      break;

    default:
      message = `Ui, algo raro ha pasado...`;
  }

  ctx.telegram.sendMessage(ctx.chat.id, message, {
    reply_to_message_id: ctx.match[2],
    reply_markup
  });
});

// callback to set the configuration values 
bot.action(/^set-(\w+)-(\d+)-(.*)$/i, (ctx) => {
  ctx.deleteMessage();
  getChatConfiguration(ctx.update.callback_query.message.chat.id)
  .then( (chatConfiguration) => {
    switch(ctx.match[1]) {
      case 'silent':
        chatConfiguration.silent = Number(ctx.match[2]);
        if (ctx.match[2] > 0)
          message = `Ok cobarde! Estaré callado durante los próximos ${ctx.match[2]} minutos.`;
        else 
          message = `Via libre! Por cierto, alguien ha visto a mi abogado?`
        break;

      case 'effectivity':
        chatConfiguration.effectivity = Number(ctx.match[2]);
        effectivityText={10: 'muy pocas', 25: 'pocas', 50: 'la mitad de las', 75: 'muchas'};
        message = `Entendido! A partir de ahora contestaré con rimas b${effectivityText[ctx.match[2]]} veces.`;
        break;

      case 'globals':
        chatConfiguration.use_globals = Number(ctx.match[2]);
        if (ctx.match[2] > 0)
          message = `Entendido! A partir de ahora usaré toda mi sabiduría y gracia en este canal. Será divertodo.`;
        else 
          message = `Entendido! A partir de ahora usaré únicamente las rimas que se hayan agregado a este canal.`;
        break;

      default:
        message = `Ui, algo raro ha pasado...`;
    }
 
    saveChatConfiguration(ctx.update.callback_query.message.chat.id, chatConfiguration)
    .then( (result) => {
      logger.debug(JSON.stringify(chatConfiguration));
      ctx.reply(message, {reply_to_message_id: ctx.match[3]});
    });
  });
});

// puns management
bot.command('rimas', (ctx) => {
  ctx.reply(`La gestión de rimas está desactivada por ahora.`, {reply_to_message_id: ctx.message.message_id});
});

// callback to close a menu
bot.action(/^close-(.*)$/i, (ctx) => {
  ctx.deleteMessage();
  ctx.reply('Ok! Hasta la próxima!', {reply_to_message_id: ctx.match[1]});
});

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
