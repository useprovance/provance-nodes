# Security

## Reporting a vulnerability

If you find a security problem in provance-nodes, please do not open a public GitHub issue. Instead, go to the **Security** tab on the repository and click **Report a vulnerability**. GitHub will keep your report private until we have a fix ready.

Tell us:

- What the problem is
- Which node or endpoint is affected
- Steps to reproduce it
- What impact you think it has

We will acknowledge your report within 48 hours and keep you updated as we work on it.

---

## What we protect

**API keys and secrets** — Every node that connects to a third-party service reads its credentials from environment variables at runtime. No secret is committed to the repository or logged. Do not commit `.env` files or any file containing real credentials.

**Input validation** — All incoming request data is validated with Zod before it is used. Invalid inputs are rejected before they reach any action logic.

**No authentication on node endpoints** — The nodes server is not exposed publicly. It runs behind the Provance platform, which handles authentication. If you are deploying this yourself, make sure the nodes server is not reachable from the open internet. Put it behind a firewall or a private network.

---

## What to avoid when contributing

- Do not log request bodies or parameters that might contain API keys or user data.
- Do not add any code that reads env variables and returns them in a response.
- Do not use `eval`, `Function()`, or any other dynamic code execution with user input.
- Do not add dependencies without checking them. If a package looks suspicious, flag it.

---

## Supported versions

Only the latest version of provance-nodes receives security fixes. If you are running an older version, update to the latest before reporting a bug — it may already be fixed.

---

## Disclosure policy

We follow responsible disclosure. Once we have a fix ready, we will:

1. Push the fix to the main branch
2. Create a GitHub release and tag it
3. Credit you in the release notes if you want

We ask that you give us reasonable time to fix the problem before making it public.
