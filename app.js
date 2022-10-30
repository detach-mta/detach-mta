require('dotenv').config();
const {SMTPServer} = require('smtp-server');
const {simpleParser} = require('mailparser');
const {SMTPChannel} = require('smtp-channel');
const SMTPComposer = require('nodemailer/lib/mail-composer');
const Handlebars = require('handlebars');

const fs = require('fs');
const path = require('path');
const STORAGE_PATH = process.env.STORAGE_PATH;

const channel = new SMTPChannel({
  host: process.env.SMTP_SERVER,
  port: process.env.SMTP_PORT
});
const handler = console.log;

const parseMail = async (stream) => {
  const options = {};
  const parsed = await simpleParser(stream, options)
	const attachments = parsed.attachments;

  const id = parsed.messageId.split('@')[0].substring(1)
  const items = await processAttachments(id, attachments);

  if (items.length > 0) {
    const bars = fs.readFileSync(path.join(__dirname, 'template.bars'));
    const template = Handlebars.compile(bars);

    const html = template({
      data: parsed.textAsHtml,
      count: items.length,
      one: items.length === 1 ? 1 : 0,
      items
    });

    parsed.html = html;
    return parsed;
  }

  parsed.html = parsed.textAsHtml;
  return parsed;
}

const processAttachments = async (messageId, attachments) => {
  const items = [];
  for (const attachment in attachments) {
    const dir = path.join(STORAGE_PATH, messageId);
    const uri = path.join(dir, attachment.filename);
    fs.writeFileSync(uri, attachment.content);

    const url = new URL(uri, process.env.CDN_SERVER_BASE);

    items.push({
      filename: attachment.filename,
      url: url.href
    });
  }

  return items;
}

const sendEmail = async (message) => {
  const mail = new SMTPComposer({
		to: message.to.text,
		from: message.from.text,
		cc: message.cc,
		bcc: message.bcc,
		subject: message.subject,
		text: message.text,
		html: message.html,
		replyTo: message.replyTo,
		inReplyTo: message.inReplyTo,
		references: message.references,
		encoding: 'utf-8',
		messageId: message.messageId,
		date: message.date
	});

  /**
   * BEGINNING OF SMTP TRANSMISSION
   * COMMANDS EXPLAINED ON RFC 821
   * XFORWARD FOR POSTFIX PROXY
   */
  await channel.connect();
	await channel.write(`EHLO ${process.env.SMTP_HOSTNAME}\r\n`, {handler});
	let token = Buffer.from(`\u0000${process.env.SMTP_USER}\u0000${process.env.SMTP_PASSWORD}`, 'utf-8').toString('base64');
	await channel.write(`AUTH PLAIN ${token}\r\n`, {handler});
	await channel.write(`XFORWARD NAME=${process.env.SMTP_HOSTNAME} ADDR=${process.env.SMTP_SERVER} PROTO=ESMTP\r\n`, {handler});
	const id = parsed.messageId.split('@')[0].substring(1);
	await channel.write(`XFORWARD IDENT=${id}\r\n`, {handler});
	console.log(`MAIL FROM ${parsed.from.text}`);

	let from = parsed.from.text.match(/\<(.*)\>/);
	if (!from) {
		from = parsed.from.text;
	} else {
		from = from[1];
	}

	await channel.write(`MAIL FROM: ${from}\r\n`, {handler})
	await channel.write(`RCPT TO: ${parsed.to.text}\r\n`, {handler});

	const data = (await mail.compile().build()).toString();
	await channel.write('DATA\r\n', {handler});
	await channel.write(`${data.replace(/^\./m,'..')}\r\n.\r\n`, {handler});
	await channel.write(`QUIT\r\n`, {handler});
	console.log(`Message ${parsed.subject} sent successfully`);
}

const server = new SMTPServer({
        authOptional: true,
        onData: async (stream, session, callback) => {
            const mail = await parseMail(stream);

            await sendEmail(mail);
        },
        onAuth(auth, session, callback) {
                if (auth.username !== process.env.AUTH_USERNAME || auth.password !== process.env.AUTH_PASSWORD) {
                        return callback(new Error('Invalid username or password'));
                }
                callback(null, { user: '123' });
        }
});

server.listen(9830);