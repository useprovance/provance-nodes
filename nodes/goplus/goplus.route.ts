import { Router } from "express";
import { runGoPlus } from "./goplus.controller";

const router = Router();

router.post("/run", runGoPlus);

router.get("/health", (_req, res) => {
  res.json({
    success: true,
    data: { status: "ok", node: "goplus" },
    message: "GoPlus is running",
  });
});

export default router;
