const crypto = require('crypto');
const request = require('request');

const app = require('express')();
function verifyRequestSignature(req, res, buf) {
  const signature = req.headers['x-hub-signature'];
  if (signature) {
    const [, signatureHash] = signature.split('=');
    const expectedHash = crypto
        .createHmac('sha1', process.env.MESSENGER_APP_SECRET)
        .update(buf)
        .digest('hex');
    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}
app.use(require('body-parser').json({ verify: verifyRequestSignature }));

app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === process.env.MESSENGER_VALIDATION_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

const heimdall = require('mxd-heimdall').heimdall({
  apikey: process.env.HEIMDALL_APIKEY,
  appid: process.env.HEIMDALL_APPID,
  pageSize: process.env.HEIMDALL_PAGESIZE || 3
});
const commands = {
  '/mxd-info': require('info-command'),
  '/mxd-search': require('mxd-search-command')({ heimdall })
};

function parseMessageText(messageText) {
  if (messageText.length < 2) {
    return;
  }
  if (messageText[0] !== '/') {
    return { commandName: '/mxd-search', args: messageText };
  }
  const index = messageText.indexOf(' ');
  let commandName;
  let args;
  if (index !== -1) {
    commandName = messageText.substring(0, index);
    args = messageText.substring(index + 1);
  } else {
    commandName = messageText;
  }
  return { commandName, args };
}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: process.env.MESSENGER_PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData
  });
}

app.post('/webhook', async function (req, res) {
  var data = req.body;
  if (data.object == 'page') {
    for (const pageEntry of data.entry) {
      for (const messagingEvent of pageEntry.messaging) {
        if (messagingEvent.message) {
          const { commandName, args } = parseMessageText(messagingEvent.message.text);
          const command = commands[commandName];
          const reply = {
            link: (url, label) => {
              if (label) {
                return `${label} (${url})`;
              }
              return url;
            },
            send: text => {
              if (Array.isArray(text)) {
                text = text.join('\n');
              }
              const messageData = {
                recipient: {
                  id: messagingEvent.sender.id
                },
                message: {
                  text,
                  metadata: 'DEVELOPER_DEFINED_METADATA'
                }
              };
              callSendAPI(messageData);
            }
          };
          if (!command) {
            reply.send(`unknown command "${commandName}"`);
            return;
          }
          try {
            await command({ args: args, reply });
          } catch(e) {
            reply.send(`error: "${e.message}"`);
          }
        }
      }
    }
  }
  res.sendStatus(200);
});

app.listen(process.env.PORT);
