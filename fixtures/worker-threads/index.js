'use strict';
const { Worker, isMainThread } = require('worker_threads');
const path = require('path');

const checks = {};
checks.format = 'worker-threads';
checks.main_is_main_thread = isMainThread;

const workerPath = path.join(__dirname, 'worker.js');

const promise = new Promise((resolve, reject) => {
  const worker = new Worker(workerPath, {
    workerData: { value: 21 },
  });

  const timer = setTimeout(() => {
    worker.terminate();
    reject(new Error('timeout'));
  }, 10000);

  worker.on('message', (msg) => {
    clearTimeout(timer);
    resolve(msg);
  });

  worker.on('error', (err) => {
    clearTimeout(timer);
    reject(err);
  });
});

promise.then((msg) => {
  checks.worker_received = msg.received;
  checks.worker_computed = msg.computed;
  checks.worker_thread_id_is_number = typeof msg.threadId === 'number';
  checks.worker_is_not_main = msg.isMainThread === false;
}).catch((err) => {
  checks.worker_received = 'ERROR:' + err.message.slice(0, 80);
  checks.worker_computed = -1;
  checks.worker_thread_id_is_number = false;
  checks.worker_is_not_main = false;
}).finally(() => {
  checks.node_version = process.version;
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${k}=${JSON.stringify(v)}`);
  }
});
