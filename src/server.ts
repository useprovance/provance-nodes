import "./config";
import app from "./app";
import { config } from "./config";

app.listen(config.PORT, () => {
   console.log(`[provance-nodes] running on http://localhost:${config.PORT}`);
});
