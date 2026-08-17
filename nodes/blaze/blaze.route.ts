import { Router } from "express";
import { runBlaze } from "./blaze.controller";

const router = Router();

router.post("/run", runBlaze);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "blaze" },
    message: "Blaze is running",
  });
});

export default router;
