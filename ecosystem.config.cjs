module.exports = {
  apps: [
    {
      name          : "supercz-bot",
      script        : "index.js",
      watch         : false,
      restart_delay : 5000,               // wait 5s before restart
      max_restarts  : 20,                 // increase restart limit
      min_uptime    : "10s",              // if dies before 10s = crash
      exp_backoff_restart_delay : 1000,   // delay increases with each consecutive crash
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
