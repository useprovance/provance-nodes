import "./config";
import app from "./app";
import { config } from "./config";
import { logger } from "./logger";

app.listen(config.PORT, () => {
   logger.info({ port: config.PORT }, `[provance-nodes] running on http://localhost:${config.PORT}`);
});
