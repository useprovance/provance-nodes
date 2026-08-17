import { Router } from "express";
import { runGruff } from "./goat.controller";

const router = Router();

router.post("/run", runGruff);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "goat" },
    message: "Gruff is running",
  });
});

export default router;
