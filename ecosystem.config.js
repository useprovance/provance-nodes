module.exports = {
  apps: [
    {
      name: "dexscreener",
      script: "src/server.ts",
      cwd: "./dexscreener",
      interpreter: "tsx",
      env: { PORT: 3101 },
    },
    {
      name: "goplus",
      script: "src/server.ts",
      cwd: "./goplus",
      interpreter: "tsx",
      env: { PORT: 3102 },
    },
    {
      name: "honeypot",
      script: "src/server.ts",
      cwd: "./honeypot",
      interpreter: "tsx",
      env: { PORT: 3103 },
    },
    {
      name: "ai-decision",
      script: "src/server.ts",
      cwd: "./ai-decision",
      interpreter: "tsx",
      env: { PORT: 3104 },
    },
    {
      name: "telegram",
      script: "src/server.ts",
      cwd: "./telegram",
      interpreter: "tsx",
      env: { PORT: 3105 },
    },
    {
      name: "gruff",
      script: "src/server.ts",
      cwd: "./goat",
      interpreter: "tsx",
      env: { PORT: 3106 },
    },
    {
      name: "blaze",
      script: "src/server.ts",
      cwd: "./stellar-trader",
      interpreter: "tsx",
      env: { PORT: 3107 },
    },
  ],
};
