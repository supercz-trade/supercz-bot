module.exports = {
  apps: [
    {
      name          : "supercz-bot",
      script        : "index.js",
      watch         : false,
      restart_delay : 5000,               // tunggu 5s sebelum restart
      max_restarts  : 20,                 // naikkan limit
      min_uptime    : "10s",              // kalau mati sebelum 10s = crash
      exp_backoff_restart_delay : 1000,   // delay makin lama tiap crash berturut
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};