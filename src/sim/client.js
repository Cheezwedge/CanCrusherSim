// Main-thread side: start simulations in a Web Worker when possible, or fall
// back to running them on the main thread in short time slices.

import { createRunner } from './runner.js';

let workerSupport = null; // null = unknown, true/false after the first attempt

function makeLocal(onMessage, sliceMs) {
  const handle = createRunner((msg) => setTimeout(() => onMessage(msg), 0), { sliceMs });
  return {
    local: true,
    post: (m) => handle(m),
    terminate: () => handle({ type: 'stop' }),
  };
}

/**
 * Create a simulation channel. Resolves to {post(msg), terminate(), local}.
 * onMessage receives every message from the runner.
 */
export function createSimChannel(onMessage) {
  if (workerSupport === false || typeof Worker === 'undefined') {
    return Promise.resolve(makeLocal(onMessage, 18));
  }
  return new Promise((resolve) => {
    let settled = false;
    let w;
    const fallback = () => {
      if (settled) return;
      settled = true;
      workerSupport = false;
      try { w && w.terminate(); } catch (_) { /* ignore */ }
      resolve(makeLocal(onMessage, 18));
    };
    try {
      w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    } catch (_) {
      fallback();
      return;
    }
    const timeout = setTimeout(fallback, 4000);
    w.onerror = (e) => { e.preventDefault?.(); fallback(); };
    w.onmessage = (e) => {
      if (!settled && e.data && e.data.type === 'ready') {
        settled = true;
        workerSupport = true;
        clearTimeout(timeout);
        w.onmessage = (ev) => onMessage(ev.data);
        w.onerror = (ev) => onMessage({ type: 'error', message: ev.message || 'Simulation worker failed' });
        resolve({ local: false, post: (m) => w.postMessage(m), terminate: () => w.terminate() });
      }
    };
  });
}
