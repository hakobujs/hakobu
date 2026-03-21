'use strict';
// Forked child: receive message, respond with transformed data
process.on('message', (msg) => {
  process.send({
    echo: msg.value,
    pid: process.pid,
    from_child: true,
  });
});
