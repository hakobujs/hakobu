'use strict';
const { fork } = require('child_process');
const path = require('path');

const checks = {};
checks.format = 'fork-ipc';

// Fork a child with IPC and exchange messages
const childPath = path.join(__dirname, 'child.js');

const promise = new Promise((resolve, reject) => {
  const child = fork(childPath, [], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('timeout'));
  }, 10000);

  child.on('message', (msg) => {
    clearTimeout(timer);
    resolve(msg);
    child.kill();
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    reject(err);
  });

  child.on('exit', (code) => {
    // If child exits before sending a message
    clearTimeout(timer);
  });

  child.send({ value: 'hello-from-parent' });
});

promise.then((msg) => {
  checks.ipc_echo = msg.echo;
  checks.child_pid_is_number = typeof msg.pid === 'number';
  checks.from_child = msg.from_child;
  checks.child_is_different_pid = msg.pid !== process.pid;
}).catch((err) => {
  checks.ipc_echo = 'ERROR:' + err.message.slice(0, 60);
  checks.child_pid_is_number = false;
  checks.from_child = false;
  checks.child_is_different_pid = false;
}).finally(() => {
  checks.node_version = process.version;
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${k}=${JSON.stringify(v)}`);
  }
});
