import cors from "@elysiajs/cors";
import Elysia from "elysia";
import { Event, Filter, matchFilter, matchFilters } from "nostr-tools";
import { ElysiaWS } from "elysia/dist/ws";
const PURGE_INTERVAL = 120
let events: Event[] = []
let connections = new Map<string, Socket>()
const app = new Elysia()
.use(cors())
.ws('/', {
    open(ws) {
        connections.set(ws.id, new Socket(ws))
    },
    message(ws, message: string) {
      connections.get(ws.id)?.handle(message)
    },
    close(ws) {
      connections.get(ws.id)?.cleanup()
      connections.delete(ws.id)
    },
    error(e) {
      console.error(e)
    }  
})
.listen(3002)
console.log('Ploofa running on port 3002')
if (PURGE_INTERVAL) {
  setInterval(() => {
    events = []
  }, PURGE_INTERVAL * 1000)
}
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
      console.error(e)
      this.send(['NOTICE', '', 'Unable to parse message'])
    }
    let verb: string =''
    let payload: string[] = []
    try {
      [verb, ...payload] = message
    } catch (e) {
      console.error(e)
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
      this.send(['NOTICE', '', 'Unable to handle message'])
    }
  }
  onCLOSE(subId: string) {
    this.removeSub(subId)
  }
  onREQ(subId: string, ...filters: Filter[]) {
    this.addSub(subId, filters)
    for (const filter of filters) {
      let limitCount = filter.limit
      if ((limitCount??0) <= 0) {
        continue
      }
      for (const event of events) {
        if ((limitCount??0) > 0 || limitCount == undefined) {
          if (matchFilter(filter, event)) {
            this.send(['EVENT', subId, event as unknown as string])
          } 
          limitCount = limitCount ? limitCount - 1 : undefined
        } 
      } 
    }
    this.send(['EOSE', subId])
  }
  onEVENT(event: Event) {
    events.push(event)
    this.send(['OK', event.id, true as unknown as string, ""])
    for (const connection of connections.values()) {
      for (const [subId, filters] of connection.getSubs().entries()) {
        if (matchFilters(filters, event)) {
          connection.send(['EVENT', subId, event as unknown as string])
        }
      }
    }
  }
}