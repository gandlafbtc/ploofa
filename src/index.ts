import cors from "@elysiajs/cors";
import Elysia from "elysia";
import { log, setUpLogger } from "../logger";
import { Event, Filter, matchFilter, matchFilters } from "nostr-tools";
import { ElysiaWS } from "elysia/dist/ws";
import { version, name } from "../package.json";
const PURGE_INTERVAL = 100
let events: Event[] = []
let persistentEvents: Event[] = []
let purgeEvents: Event[] = []
let connections = new Map<string, Socket>()
const app = new Elysia()
.use(cors())
.get('/',(req) => {
    log.info`GET /`
    req.request
    req.set.headers = {
        'Content-Type': 'application/nostr+json',
    }
    return {
        name: `${name}-v${version}`,
        icon: "",
        description: "Ploofa - Ephemeral relay",
        pubkey: "",
        software: "https://github.com/gandlafbtc/ploofa",
    }
})
.ws('/', {
    idleTimeout: 240,
    open(ws) {
        log.info`Received new connection: ${ws.id}`
        const relay = new Socket(ws)
        connections.set( ws.id, relay)
        log.info`Current connections: ${connections.size}`
    },
    message(ws, message: string) {
      log.info`Received message on: ${ws.id}`
      connections.get(ws.id)?.handle(message)
    },
    close(ws) {
      connections.get(ws.id)?.cleanup()
      connections.delete(ws.id)
      log.info`client [${ws.id}] disconnected`
    },
    error(e) {
      log.error('Error on socket: {e}', {e})
    }  
})
.listen(3001)

setUpLogger().then(()=> {
  log.info`Relay listening on port ${3001}`
  if (PURGE_INTERVAL) {
    log.info`Purging events every ${PURGE_INTERVAL} seconds`
    setInterval(() => {
      log.info`Purging [${events.length}] events`
      purgeEvents = [...events]
      events = []
    }, PURGE_INTERVAL * 1000)
  }
  setInterval(() => {
    log.debug`events: [${events.length}]`
    log.debug`purgeEvents: [${purgeEvents.length}]`
    log.debug`persistEvents: [${persistentEvents.length}]`
  }, 30000);
})
class Socket {
  private _socket: ElysiaWS
  private _subs: Map<string, Filter[]>
  constructor(socket: ElysiaWS) {
    this._socket = socket
    this._subs = new Map()
  }
  cleanup() {
    this._socket.close()
  }
  getSubs() {
    return this._subs
  }
  addSub(subId: string, filters: Filter[]) {
    this._subs.set(subId, filters)
  }
  removeSub(subId: string) {
    this._subs.delete(subId)
  }
  send(message: string[]) {
    this._socket.send(JSON.stringify(message))
  }
  handle(message: string) {
    try {
      message = JSON.parse(message)
    } catch (e) {
      log.error('Could not parse message: {e}', {e})
      this.send(['NOTICE', '', 'Unable to parse message'])
    }
    let verb: string =''
    let payload: string[] = []
    try {
      [verb, ...payload] = message
    } catch (e) {
      log.error('Could not read message: {e}', {e})
      this.send(['NOTICE', '', 'Unable to read message'])
    }
    if (verb==='CLOSE') {
      this.onCLOSE(payload[0])
    }
    else if (verb === 'REQ') {
      this.onREQ(payload[0], payload[1] as unknown as Filter)
    }
    else if (verb === 'EVENT') {
      this.onEVENT(payload[0] as unknown as Event)
    }
    else {
      log.error('Could not handle message',)
      this.send(['NOTICE', '', 'Unable to handle message'])
    }
  }
  onCLOSE(subId: string) {
    log.info`Removing sub [${subId}]`
    this.removeSub(subId)
  }
  onREQ(subId: string, ...filters: Filter[]) {
    this.addSub(subId, filters)
    log.info`Added sub [${subId}]`
    for (const filter of filters) {
      let limitCount = filter.limit
      if ((limitCount??0) <= 0) {
        log.debug`miss events due to limit=0 on subscription: ${subId}`
        continue
      }
      for (const event of [...events, ...purgeEvents,...persistentEvents]) {
        if ((limitCount??0) > 0 || limitCount == undefined) {
          if (matchFilter(filter, event)) {
            this.send(['EVENT', subId, event as unknown as string])
            log.info('event sent: {event} on {subId}', {event, subId})
          } 
          limitCount = limitCount ? limitCount - 1 : undefined
        } 
      } 
    }
    this.send(['EOSE', subId])
  }
  onEVENT(event: Event) {
    log.info('Event received: {event}', {event})
    if (event.kind===13194) {
      const eventIndex = persistentEvents.findIndex((e)=>e.pubkey===event.pubkey)
      if (eventIndex!==undefined) {
        persistentEvents.splice(eventIndex, 1, event)
      }
      else {
        persistentEvents.push(event)
      }
    }
    
    else {
      events.push(event)
    }
    this.send(['OK', event.id, true as unknown as string, ""])
    for (const connection of connections.values()) {
      for (const [subId, filters] of connection.getSubs().entries()) {
        if (matchFilters(filters, event)) {
          connection.send(['EVENT', subId, event as unknown as string])
          log.info('event sent: {event} on {subId}', {event, subId})
        }
      }
    }
  }
}