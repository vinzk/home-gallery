const { v4: uuidv4 } = require('uuid');
const log = require('@home-gallery/logger')('server.api.events');

const { readEvents, appendEvent } = require('@home-gallery/events/dist/node');

const events = (eventsFilename) => {
  let clients = [];
  let eventsCache = false;

  const create = (type, data) => {
    return Object.assign(data, {
      type,
      id: uuidv4(),
      date: new Date().toISOString(),
    })
  }

  const emit = (event) => {
    clients.forEach(c => {
      console.log(`Send data to client ${c.id}`);
      c.res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
  }

  const removeClient = (client) => {
    const index = clients.indexOf(client);
    clients.splice(index, 1);
  }

  const isValidEvent = (data) => {
    if (!data.type) {
      return false;
    } else if (data.type === 'userAction' && (!data.targetIds || !data.targetIds.length || !data.actions || !data.actions.length)) {
      return false;
    }

    return true;
  }

  const stream = (req, res, next) => {
    const headers = {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
      "Content-Encoding": "none"
    };
    res.writeHead(200, headers);

    const clientId = Date.now();
    res.write(`event: hello\nid: ${Date.now()}\ndata: ${clientId}\n\n\n`);
    const newClient = {
      id: clientId,
      res,
      toString: function() {
        return this.id;
      }
    };

    clients.push(newClient);
    log.info(`Add new client ${newClient}`);

    req.on('end', () => {
      log.info(`Client connection ended. Remove client ${newClient}`);
      removeClient(newClient);
    });

    req.on('close', () => {
      log.info(`Client connection closed. Remove client ${newClient}`);
      removeClient(newClient);
    });

    res.on('err', () => {
      log.warn(`Connection error. Remove client ${newClient}`);
      removeClient(newClient);
    });
  };

  const push = (req, res, next) => {
    const event = req.body;
    if (!isValidEvent(event)) {
      log.warn(`Received invalid event: ${JSON.stringify(event)}`);
      res.status(400).end();
      return;
    }
    if (!event.id) {
      event.id = uuidv4();
    }
    if (!event.date) {
      event.date = new Date().toISOString();
    }
    appendEvent(eventsFilename, event, (err) => {
      if (err) {
        console.error(`Could not save event to ${eventsFilename}. Error: ${err}. Event ${JSON.stringify(event).substr(0, 50)}...`);
        res.status(500).end();
      } else {
        log.info(`New event ${event.id} created`);
        if (eventsCache !== false) {
          eventsCache.push(event);
        }
        emit(event);
        res.status(201).end();
      }
    });
  }

  const read = (req, res, next) => {
    if (eventsCache !== false) {
      log.debug(`Send ${eventsCache.length} cached events`);
      return res.json({ data: eventsCache });
    }

    const t0 = Date.now();
    readEvents(eventsFilename, (err, events) => {
      if (err && err.code === 'ENOENT') {
        log.info(`Events file ${eventsFilename} does not exist yet. Create an event to initialize it`);
        const err = {
          error: {
            code: 404,
            message: 'Events file does not exist yet. Create an event to initialize it'
          }
        }
        return res.status(404).json(err).send();
      } else if (err) {
        log.error(`Failed to read events file ${eventsFilename}: ${err}`);
        const err = {
          error: {
            code: 500,
            message: 'Loading event file failded. See server logs'
          }
        }
        return res.status(500).json(err).end();
      }
      eventsCache = events;
      log.info(t0, `Read events file ${eventsFilename} and send ${eventsCache.length} events`);
      return res.json({ data: eventsCache });
    });
  }

  const eventbus = { create, emit };
  return { read, stream, push, eventbus };
}

module.exports = events;
