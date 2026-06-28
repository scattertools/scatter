import { EventEmitter } from 'events';

export interface ActivityEvent {
  kind: 'uploaded' | 'downloaded' | 'deleted';
  fileId: string;
  shardIndex: number;
  size: number;
  at: number;
}

export interface StatusEvent {
  kind: 'heartbeat' | 'registered' | 'error';
  message: string;
  at: number;
}

export type AnyEvent = ActivityEvent | StatusEvent;

export class Events extends EventEmitter {
  log(e: ActivityEvent | StatusEvent) {
    this.emit('event', e);
  }
  onEvent(fn: (e: AnyEvent) => void) {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}
