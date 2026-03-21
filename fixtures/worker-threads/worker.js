'use strict';
const { parentPort, workerData, threadId } = require('worker_threads');

// Compute something with workerData and send back
const result = {
  received: workerData.value,
  computed: workerData.value * 2,
  threadId,
  isMainThread: false,
};

parentPort.postMessage(result);
