# -*- coding: utf-8 -*-
import telebot
import os
import sqlite3
import uuid
import string
import unicodedata
import re
import sys
import random
import time

reload(sys)
sys.setdefaultencoding('utf-8')

allowed_chars_puns = string.ascii_letters + " " + string.digits + "áéíóúàèìòùäëïöü"
allowed_chars_triggers = allowed_chars_puns + "^$.*+?(){}\\[]<>=-"
version = "0.8.0-6375c1c"
required_validations = 5
default_listing = 10

if 'TOKEN' not in os.environ:
    print("missing TOKEN.Leaving...")
    os._exit(1)

if 'DBLOCATION' not in os.environ:
    print("missing DB.Leaving...")
    os._exit(1)

bot = telebot.TeleBot(os.environ['TOKEN'])
bot.skip_pending = True

def is_valid_regex(regexp=""):
    try:
        re.compile(regexp)
        is_valid = True
    except re.error:
        is_valid = False
    return is_valid


def load_default_puns(dbfile='puns.db', punsfile='puns.txt'):
    db = sqlite3.connect(dbfile)
    cursor = db.cursor()
    with open(os.path.expanduser(punsfile), 'r') as staticpuns:
        number = 0
        for line in staticpuns:
            number += 1
            if len(line.split('|')) == 2:
                trigger = line.split('|')[0].strip()
                if not is_valid_regex(trigger):
                    print "Incorrect regex trigger %s on line %s of file %s. Not added" % (trigger, str(number), punsfile)
                else:
                    pun = line.split('|')[1].strip()
                    answer = cursor.execute('''SELECT count(trigger) FROM puns WHERE pun = ? AND trigger = ? AND chatid = 0''', (pun.decode('utf8'), trigger.decode('utf8'),)).fetchone()
                    if answer[0] == 0:
                        cursor.execute('''INSERT INTO puns(uuid,chatid,trigger,pun) VALUES(?,?,?,?)''', (str(uuid.uuid4()), "0", trigger.decode('utf8'), pun.decode('utf8')))
                        db.commit()
                        print "Added default pun \"%s\" for trigger \"%s\"" % (pun, trigger)
            else:
                print "Incorrect line %s on file %s. Not added" % (str(number), punsfile)
    db.close()


def db_setup(dbfile='puns.db'):
    db = sqlite3.connect(dbfile)
    cursor = db.cursor()
    cursor.execute('CREATE TABLE IF NOT EXISTS puns (uuid text, chatid int, trigger text, pun text)')
    cursor.execute('CREATE TABLE IF NOT EXISTS validations (punid text, chatid int, userid text, karma int)')
    cursor.execute('CREATE TABLE IF NOT EXISTS chatoptions (chatid int, silence int, efectivity int, unique (chatid))')
    db.commit()
    db.close()
    for db_file in os.listdir('./defaultpuns/punsfiles'):
        load_default_puns(dbfile=punsdb, punsfile="./defaultpuns/punsfiles/" + db_file)


def is_chat_silenced(message="", dbfile='puns.db'):
    db = sqlite3.connect(dbfile)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT silence from chatoptions where chatid = ?''', (message.chat.id,)).fetchone()
    silence = int(answer[0] if answer is not None and answer[0] is not None else 0)
    return True if silence > time.time() else False


def silence_until(chatid=""):
    global punsdb
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT silence from chatoptions where chatid = ?''', (chatid,)).fetchone()
    return str(time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(answer[0]))) if answer is not None and answer[0] is not None and int(time.time()) < int(answer[0]) else "nunca"


def load_chat_options(chatid=""):
    global punsdb
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT chatid,silence,efectivity from chatoptions where chatid = ?''', (chatid,)).fetchone()
    db.close()
    chatoptions = {'chatid': chatid,
                   'silence': answer[1] if answer is not None and answer[1] is not None else None,
                   'efectivity': answer[2] if answer is not None and answer[2] is not None else None}
    return chatoptions


def set_chat_options(chatoptions=""):
    global punsdb
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    chatid = chatoptions['chatid'] if chatoptions['chatid'] is not None else None
    silence = chatoptions['silence'] if chatoptions['silence'] is not None else None
    efectivity = chatoptions['efectivity'] if chatoptions['efectivity'] is not None else None
    cursor.execute('''INSERT OR REPLACE INTO chatoptions(chatid,silence,efectivity) VALUES(?,?,?)''', (chatid, silence, efectivity))
    db.commit()
    db.close()


def is_efective(chatid=""):
    global punsdb
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    random.randrange(0, 101, 2)
    answer = cursor.execute('''SELECT efectivity from chatoptions where chatid = ?''', (chatid,)).fetchone()
    return True if answer is None or answer[0] is None or int(answer[0]) >= random.randint(0, 100) else False


def efectivity(chatid=""):
    global punsdb
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT efectivity from chatoptions where chatid = ?''', (chatid,)).fetchone()
    return answer[0] if answer is not None else "100"


def find_pun(message="", dbfile='puns.db'):
    db = sqlite3.connect(dbfile)
    cursor = db.cursor()
    answer_list = []
# First, remove emojis and any other char not in the allowed chars
    clean_text = "".join(c for c in message.text.lower() if c in allowed_chars_puns).split()
# Then, remove accents from letters, ó becomes on o to be compared with the triggers list
    if clean_text != []:
        last_clean = unicodedata.normalize('NFKD', clean_text[-1]).encode('ASCII', 'ignore')
        triggers = cursor.execute('''SELECT trigger from puns where (chatid = ? or chatid = 0) order by chatid desc''', (message.chat.id,)).fetchall()
        for i in triggers:
            if is_valid_regex(i[0]):
                regexp = re.compile('^' + i[0] + '$')
                if regexp.match(last_clean) is not None:
                    matches = cursor.execute('''SELECT uuid,pun,chatid from puns where trigger = ? AND (chatid = ? OR chatid = 0) ORDER BY chatid desc''', (i[0], message.chat.id)).fetchall()
                    for j in matches:
                        if j[1].split()[-1] != last_clean:
                            enabled = cursor.execute('''SELECT SUM(karma) from validations where punid = ? AND chatid = ?''', (j[0], message.chat.id)).fetchone()
                            if j[2] == 0 or enabled[0] >= required_validations or (bot.get_chat_members_count(message.chat.id) < required_validations and enabled[0] > 0):
                                answer_list.append(j[1])
        db.close()
        return None if answer_list == [] else random.choice(answer_list)


@bot.message_handler(commands=['ayuda', 'help'])
def help(message):
    if bot.get_chat_members_count(message.chat.id) >= required_validations:
        karma_message='''Las rimas necesitan más de %s puntos de karma para estar activas en este canal''' % (required_validations)
    else:
        karma_message='''Las rimas necesitan karma positivo para estar activas en este canal'''

    helpmessage = '''ℹ Estos son los comandos disponibles:
    /agregar - Agregar una rima
    /borrar - Borrar una rima
    /listar - Lista todas las rimas para este chat
    /secundar - Dar karma a una rima
    /rechazar - Dar o quitar karma a una rima
    /silenciar - Silenciar rimas durante un periodo de tiempo
    /ajustar - Ajustar la probabilidad de rimar a los mensajes
    /help o /ayuda - Mostar esta ayuda

⚙ Configuración actual
  - Rimas silenciadas en este canal hasta: %s.
  - Probabilidad de contestar a una rima: %s%%.
  - %s.

Version: %s
    ''' % (silence_until(message.chat.id), efectivity(message.chat.id), karma_message, version)
    bot.reply_to(message, helpmessage)


@bot.message_handler(commands=['punshelp', 'punapprove', 'punban', 'punadd', 'pundel', 'punsilence', 'punset', 'punlist'])
def deprecated(message):
    command = message.text.split(' ')[0]
    bot.reply_to(message, 'El comando %s está en desuso. Comprueba los nuevos comandos en la /ayuda.' % (command))


@bot.message_handler(commands=['secundar'])
def approve(message):
    global triggers
    global punsdb
    quote = message.text.replace('/secundar', '').strip()
    if quote == '':
        bot.reply_to(message, 'UUID no encontrado o sintaxis incorrecta: \"/secundar \"UUID\"')
        return
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT count(uuid) FROM puns WHERE chatid = ? AND uuid = ?''', (message.chat.id, quote.strip(),)).fetchone()
    if answer[0] != 1:
        bot.reply_to(message, 'UUID ' + quote.strip() + ' not found')
    else:
        answer = cursor.execute('''SELECT count(punid) FROM validations WHERE chatid = ? AND punid = ? AND userid = ? and karma = 1''', (message.chat.id, quote.strip(), message.from_user.id)).fetchone()
        if answer[0] >= 1:
            bot.reply_to(message, 'Ya has secundado a la rima ' + quote + '. Solo se permite hacerlo una vez por usuario.')
        else:
            cursor.execute('''INSERT INTO validations(punid,chatid,userid,karma) VALUES(?,?,?,1)''', (quote.strip(), message.chat.id, message.from_user.id))
            db.commit()
            answer = cursor.execute('''SELECT SUM(karma) FROM validations WHERE chatid = ? AND punid = ?''', (message.chat.id, quote.strip())).fetchone()
            bot.reply_to(message, 'Gracias por secundar a la rima ' + quote.strip() + '. Puntuación actual: ' + str(answer[0]))
    db.close()
    return


@bot.message_handler(commands=['rechazar'])
def ban(message):
    global triggers
    global punsdb
    quote = message.text.replace('/rechazar', '').strip()
    if quote == '':
        bot.reply_to(message, 'UUID no encontrado o sintaxis incorrecta: \"/rechazar \"UUID\"')
        return
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT count(uuid) FROM puns WHERE chatid = ? AND uuid = ?''', (message.chat.id, quote.strip(),)).fetchone()
    if answer[0] != 1:
        bot.reply_to(message, 'UUID ' + quote.strip() + ' not found')
    else:
        answer = cursor.execute('''SELECT count(punid) FROM validations WHERE chatid = ? AND punid = ? AND userid = ? and karma = -1''', (message.chat.id, quote.strip(), message.from_user.id)).fetchone()
        if answer[0] >= 1:
            bot.reply_to(message, 'Ya has rechazado la rima ' + quote + '. Solo se permite hacerlo una vez por usuario.')
        else:
            cursor.execute('''INSERT INTO validations(punid,chatid,userid,karma) VALUES(?,?,?,-1)''', (quote.strip(), message.chat.id, message.from_user.id))
            db.commit()
            answer = cursor.execute('''SELECT SUM(karma) FROM validations WHERE chatid = ? AND punid = ?''', (message.chat.id, quote.strip())).fetchone()
            bot.reply_to(message, 'Gracias por rechazar la rima ' + quote.strip() + '. Puntuación actual: ' + str(answer[0]))
    db.close()
    return


@bot.message_handler(commands=['agregar'])
def add(message):
    global triggers
    global punsdb
    quote = message.text.replace('/agregar', '')
    if quote == '' or len(quote.split('|')) != 2:
        bot.reply_to(message, 'UUID no encontrado o sintaxis incorrecta: \"/agregar \"texto_a_rimar\"|\"contestacion\"')
        return
    trigger = quote.split('|')[0].strip()
    for character in trigger:
        if character not in allowed_chars_triggers:
            bot.reply_to(message, 'Caracter invalido encontrado ' + character + '. Solo se permiten letras y/o numeros.')
            return
    if not is_valid_regex(trigger):
        bot.reply_to(message, 'No es una expresion regex valida: ' + trigger)
        return
    pun = quote.split('|')[1].strip()
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT count(trigger) FROM puns WHERE trigger = ? AND chatid = ? AND pun = ?''', (trigger, message.chat.id, pun)).fetchone()
    db.commit()
    if answer[0] != 0:
        bot.reply_to(message, 'Ya existe una rima con ese texto.')
    else:
        punid = uuid.uuid4()
        cursor.execute('''INSERT INTO puns(uuid,chatid,trigger,pun) VALUES(?,?,?,?)''', (str(punid), message.chat.id, trigger.decode('utf8'), pun.decode('utf8')))
        cursor.execute('''INSERT INTO validations(punid,chatid,userid,karma) VALUES(?,?,?,1)''', (str(punid), message.chat.id, message.from_user.id))
        db.commit()
        if bot.get_chat_members_count(message.chat.id) >= required_validations:
            bot.reply_to(message, 'Rima ' + str(punid) + ' agregada al canal. Debe ser secundada por al menos ' + str(required_validations) + ' personas diferentes para activarla.')
        else:
            bot.reply_to(message, 'Rima ' + str(punid) + ' agregada al canal. Debe estar más secundada que rechazada para activarla.')
        print "Pun \"%s\" with trigger \"%s\" added to channel %s" % (pun, trigger, message.chat.id)
    db.close()
    return


@bot.message_handler(commands=['borrar'])
def delete(message):
    global triggers
    global punsdb
    quote = message.text.replace('/borrar', '').strip()
    if quote == '':
        bot.reply_to(message, 'UUID no encontrado o sintaxis incorrecta: \"/borrar \"texto_a_rimar\"|\"contestacion\"')
        return
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    answer = cursor.execute('''SELECT count(uuid) FROM puns WHERE chatid = ? AND uuid = ?''', (message.chat.id, quote,)).fetchone()
    db.commit()
    if answer[0] != 1:
        bot.reply_to(message, 'UUID ' + quote + ' no encontrado')
    else:
        cursor.execute('''DELETE FROM puns WHERE chatid = ? and uuid = ?''', (message.chat.id, quote))
        bot.reply_to(message, 'Rima borrada del canal.')
        db.commit()
        print "Pun with UUID \"%s\" deleted from channel %s" % (quote, message.chat.id)
    db.close()
    return


@bot.message_handler(commands=['silenciar'])
def silence(message):
    keyboard = telebot.types.InlineKeyboardMarkup()
    keyboard.row(
        telebot.types.InlineKeyboardButton('1 min.', callback_data='silence-1'),
        telebot.types.InlineKeyboardButton('10 min.', callback_data='silence-10'),
    )
    keyboard.row(
        telebot.types.InlineKeyboardButton('30 min.', callback_data='silence-30'),
        telebot.types.InlineKeyboardButton('60 min.', callback_data='silence-60'),
    )
    bot.reply_to(message, 'Vaya vaya, alguien se ha mosqueado. Cuánto tiempo quieres dejarme sin hablar?', reply_markup=keyboard)


def silence_callback(query):
    [action, silence_minutes] = query.data.split('-')
    chatoptions = load_chat_options(query.message.chat.id)
    chatoptions['silence'] = 60 * int(silence_minutes) + int(time.time())
    set_chat_options(chatoptions)
    bot.reply_to(query.message.reply_to_message, 'Ok cobarde, estaré callado hasta el ' + time.strftime('%d-%m-%Y a las %H:%M:%S.', time.localtime(chatoptions['silence'])))


@bot.message_handler(commands=['ajustar'])
def set(message):
    keyboard = telebot.types.InlineKeyboardMarkup()
    keyboard.row(
        telebot.types.InlineKeyboardButton('Casi ninguna', callback_data='set-10-casi ninguna de'),
        telebot.types.InlineKeyboardButton('Algunas', callback_data='set-25-algunas de'),
    )
    keyboard.row(
        telebot.types.InlineKeyboardButton('La mitad', callback_data='set-50-la mitad de'),
        telebot.types.InlineKeyboardButton('Muchas', callback_data='set-75-muchas de'),
    )
    keyboard.row(telebot.types.InlineKeyboardButton('Todas', callback_data='set-100-todas'),)
    bot.reply_to(message, 'Algo me dice que no me estoy comportando bien. Cuánto quieres que conteste con rimas?', reply_markup=keyboard)


def set_callback(query):
    [action, set_value, set_text] = query.data.split('-')
    chatoptions = load_chat_options(query.message.chat.id)
    chatoptions['efectivity'] = int(set_value)
    set_chat_options(chatoptions)
    bot.reply_to(query.message.reply_to_message, '''Okay, comprendido. Contestare a %s las rimas a partir de ahora.''' %(set_text))


@bot.message_handler(commands=['listar'])
def list(message):
    keyboard = telebot.types.InlineKeyboardMarkup()
    keyboard.row(
        telebot.types.InlineKeyboardButton('Globales', callback_data='list-global-0'),
        telebot.types.InlineKeyboardButton('Locales', callback_data='list-local-0')
    )
    bot.reply_to(message, 'Elige qué rimas quieres ver:', reply_markup=keyboard)


def list_callback(query):
    index = "| UUID | Estado (karma) | Rima | Contestacion\n"
    puns_list = ""

    [query_verb, query_scope, query_offset] = query.data.split('-')

    global punsdb
    db = sqlite3.connect(punsdb)
    cursor = db.cursor()
    if (query.data.startswith("list-global")):
        answer = cursor.execute('''SELECT * from puns WHERE chatid = 0 LIMIT ? OFFSET ?''', (default_listing, query_offset,)).fetchall()
        db.commit()
        for i in answer:
            puns_list += "| - | Activa | " + str(i[2]) + " | " + str(i[3]) + "\n"
    elif (query.data.startswith("list-local")):
        answer = cursor.execute('''SELECT * from puns WHERE chatid = ? LIMIT ? OFFSET ?''', (query.message.chat.id, default_listing, query_offset,)).fetchall()
        db.commit()
        for i in answer:
            validations = cursor.execute('''SELECT SUM(validations.karma) FROM puns,validations WHERE puns.chatid = ? AND puns.uuid = ? AND puns.uuid == validations.punid AND puns.chatid = validations.chatid''', (query.message.chat.id, i[0],)).fetchone()
            if bot.get_chat_members_count(query.message.chat.id) >= required_validations:
                if validations[0] >= required_validations:
                    puns_list += "| " + str(i[0]) + " | Activa (" + str(validations[0]) + "/" + str(required_validations) + ") | " + str(i[2]) + " | " + str(i[3]) + "\n"
                else:
                    puns_list += "| " + str(i[0]) + " | Inactiva (" + str(validations[0]) + "/" + str(required_validations) + ") | " + str(i[2]) + " | " + str(i[3]) + "\n"
            else:
                if validations[0] > 0:
                    puns_list += "| " + str(i[0]) + " | Activa (" + str(validations[0]) + ") | " + str(i[2]) + " | " + str(i[3]) + "\n"
                else:
                    puns_list += "| " + str(i[0]) + " | Inactiva (" + str(validations[0]) + ") | " + str(i[2]) + " | " + str(i[3]) + "\n"
    db.close()

    bot.answer_callback_query(query.id)
    bot.send_message(query.message.chat.id, index + puns_list)
    if len(answer) == default_listing:
        keyboard = telebot.types.InlineKeyboardMarkup()
        keyboard.row(
            telebot.types.InlineKeyboardButton('Si', callback_data='-'.join([query_verb, query_scope, str(int(query_offset) + default_listing)])),
            telebot.types.InlineKeyboardButton('No', callback_data='cancel')
        )
        bot.send_message(query.message.chat.id, 'Quieres ver más?', reply_markup=keyboard)

    return


@bot.message_handler(commands=['start'])
def send_welcome(message):
    bot.reply_to(message, "Hagamos unas rimas. Usa /ayuda para saber cómo va esto.")


@bot.message_handler(func=lambda m: True)
def echo_all(message):
    if not is_chat_silenced(message=message, dbfile=punsdb) and is_efective(message.chat.id):
        rima = find_pun(message=message, dbfile=punsdb)
        if rima is not None:
            bot.reply_to(message, rima)


@bot.callback_query_handler(func=lambda call: True)
def iq_callback(query):
    data = query.data
    bot.delete_message(query.message.chat.id, query.message.message_id)
    if data.startswith('list-'):
        list_callback(query)
    if data.startswith('silence-'):
        silence_callback(query)
    if data.startswith('set-'):
        set_callback(query)
    elif data.startswith('cancel'):
        bot.answer_callback_query(query.id)
        bot.send_message(query.message.chat.id, 'Ok, cancelando. Vuelve cuando quieras.')


punsdb = os.path.expanduser(os.environ['DBLOCATION'])
db_setup(dbfile=punsdb)
print "PunsBot %s ready for puns!" % (version)
bot.polling(none_stop=True)

