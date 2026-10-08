module.exports = {
  apps: [
    {
      name: "coin-trading",
      script: "server.py",
      interpreter: "python3",
      interpreter_args: "-u",
      cwd: __dirname,
      env: {
        HOST: "0.0.0.0",
        PORT: "8787",
      },
      watch: ["server.py", "index.html", "app.js", "strategy.js"],
      ignore_watch: ["__pycache__", "*.pyc", ".git"],
      watch_delay: 2000,
      autorestart: true,
    },
  ],
};
