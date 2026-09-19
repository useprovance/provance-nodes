# Contributing to provance-nodes

Thank you for taking the time to contribute. This document covers everything you need to know before you start.

---

## What we are building

provance-nodes is the agent execution layer for Provance. Every node is a live HTTP service. When a workflow runs on the Provance canvas, these nodes do the actual work.

If you want to add a new agent, fix a bug, or improve an existing node — this is the right place.

---

## Before you start

- Make sure you understand how the node request/response format works. Read the README.
- Check the open issues before creating a new one. Someone might already be working on it.
- For big changes, open an issue first and discuss the approach before writing code. This saves everyone time.

---

## Setting up locally

**Requirements**

- Node.js 20+
- pnpm 8+

**Steps**

```bash
# Clone the repo
git clone https://github.com/useprovance/provance-nodes.git
cd provance-nodes

# Install dependencies
pnpm install

# Copy env file
cp .env.example .env

# Start the dev server
pnpm dev
```

The server runs on `http://localhost:3100`. Hit `/health` to confirm everything is working.

Some nodes need their own env file. Check `nodes/{node-name}/.env` and fill in the required secrets before running that node.

---

## How to add a new node

Every node follows the same structure:

```
nodes/your-node/
├── your-node.route.ts       # Express router
├── your-node.controller.ts  # Request handler — dispatches by action
├── your-node.schema.ts      # Zod validation schemas
└── your-node.actions.ts     # The actual logic
```

**Controller pattern**

```ts
export async function runYourNode(req: Request, res: Response): Promise<void> {
  const { action, ...params } = req.body ?? {};

  try {
    let data: unknown;

    switch (action) {
      case "your_action":
        data = await yourAction(YourSchema.parse(params));
        break;
      default:
        res.status(400).json({ success: false, data: {}, message: `Unknown action: "${action}"` });
        return;
    }

    res.json({ success: true, data, message: "ok" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, data: {}, message });
  }
}
```

**Response format — always return this shape**

```ts
{
  success: boolean;
  data: Record<string, unknown>;
  message: string;
}
```

After creating the node, register it in `src/app.ts` and add it to the `/health` nodes list.

---

## Code style

- TypeScript. No plain JavaScript.
- Use `zod` to validate all incoming request data. Never trust `req.body` directly.
- Keep each node self-contained. Do not import from other nodes.
- No `console.log`. Use the `logger` from `src/logger.ts`.
- Keep functions small and named clearly.

---

## Pull request process

1. Fork the repo and create your branch from `main`.
2. Branch name format: `feat/node-name` for new nodes, `fix/description` for bug fixes.
3. Write clear commit messages. Say what changed and why.
4. Test your node manually before opening a PR. Show a sample request and response in the PR description.
5. Open the PR against `main`.

**PR description should include:**

- What the node does or what bug was fixed
- Sample `curl` request showing it works
- Sample response output
- Any env variables the node needs

---

## Reporting bugs

Open a GitHub issue. Include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Node name and action you were calling

---

## Good first issues

Look for issues tagged `good first issue`. These are small, well-scoped tasks that are good starting points if you are new to the codebase.
