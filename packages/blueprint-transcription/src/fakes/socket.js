/**
 * A WebSocket class whose connections reach a fake relay in the same page,
 * with no server and no network: hand it to the relay adapter as its
 * `WebSocket`, and the adapter speaks the relay contract to the fake relay
 * exactly as it would over a real connection.
 *
 * Messages are delivered in order and asynchronously, as a real WebSocket
 * delivers them, including those sent just before a close. `tap` is told of
 * each one, for a page that shows what goes over the wire or a test that
 * checks it.
 */

/**
 * @param {{ protocolFor: Function, accept: Function }} relay - from createFakeRelay
 * @param {object} [options]
 * @param {(from: 'client'|'relay', data: string|Uint8Array) => void} [options.tap]
 * @returns {typeof WebSocket}
 */
export function createInPageSocket(relay, { tap = () => {} } = {}) {
  class End extends EventTarget {
    constructor(side) {
      super();
      this.side = side;
      this.readyState = 0;
      this.binaryType = 'arraybuffer';
    }

    send(data) {
      if (this.readyState !== 1) return;
      tap(this.side, data);
      setTimeout(() => this.peer.dispatchEvent(new MessageEvent('message', { data })));
    }

    close() {
      for (const end of [this, this.peer]) {
        if (end.readyState === 3) continue;
        end.readyState = 3;
        setTimeout(() => end.dispatchEvent(new Event('close')));
      }
    }
  }

  return class InPageSocket extends End {
    constructor(url, protocols = []) {
      super('client');
      this.url = url;
      this.offered = [].concat(protocols);
      this.protocol = '';
      this.peer = new End('relay');
      this.peer.peer = this;
      setTimeout(() => {
        const chosen = relay.protocolFor(this.offered);
        if (!chosen) {
          this.readyState = 3;
          this.dispatchEvent(new Event('close'));
          return;
        }
        this.protocol = chosen;
        this.readyState = 1;
        this.peer.readyState = 1;
        relay.accept(this.peer);
        this.dispatchEvent(new Event('open'));
      });
    }
  };
}
