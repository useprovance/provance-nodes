import { Request, Response, NextFunction } from "express";

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-payment, x-payment-run-id, x-payment-index");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}
