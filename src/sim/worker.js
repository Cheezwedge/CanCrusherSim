// Module Web Worker hosting the crush simulation.
import { createRunner } from './runner.js';

const handle = createRunner((msg, transfer) => self.postMessage(msg, transfer || []));
self.onmessage = (e) => handle(e.data);
self.postMessage({ type: 'ready' });
