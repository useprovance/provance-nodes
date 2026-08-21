import dotenv from "dotenv";

// Load root env first, then each node's own env (override: false = don't overwrite already-set vars)
dotenv.config();
dotenv.config({ path: "./nodes/goat/.env", override: false });
dotenv.config({ path: "./nodes/blaze/.env", override: false });
dotenv.config({ path: "./nodes/telegram/.env", override: false });
dotenv.config({ path: "./nodes/openai/.env", override: false });
dotenv.config({ path: "./nodes/gruff/.env", override: false });

export const config = {
  PORT: Number(process.env.PORT) || 3100,
};
