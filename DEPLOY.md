# Deploying

## Environment variables
| Name | Required | Purpose |
|---|---|---|
| `GOOGLE_API_KEY` | yes | Your paid Gemini key. Never commit it; `.env` is git-ignored. |
| `GEMINI_MODEL` | no | Override the model (default `gemini-3.5-flash-lite`). |
| `ALLOWED_ORIGINS` | no | Only if the frontend is on another domain. |

## Vercel
1. Push this folder to GitHub (`.env` and `venv/` are ignored).
2. Vercel -> Add New Project -> import the repo. FastAPI is detected from `app/main.py`; dependencies come from `requirements.txt`.
3. Project Settings -> Environment Variables -> add `GOOGLE_API_KEY` (Production + Preview).
4. Deploy, then open the URL. `GET /health` should return `{"status":"ok"}`.

`vercel.json` raises the function time limit to 60s so longer answers can finish streaming (the allowed maximum depends on your Vercel plan).
Files in `public/` are served by Vercel's CDN; API routes run as a Python function.

CLI alternative: `npx vercel` then `npx vercel --prod` from this folder.

## Your own server (VPS)
```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export GOOGLE_API_KEY=...
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Run it under systemd or a process manager, and put nginx/Caddy in front for HTTPS. For nginx, add `proxy_buffering off;` on the location, otherwise streaming arrives in one lump.

## Before going public
- Anyone who finds the URL can spend your paid quota. Add a limit: a spend cap in Google Cloud, plus login or rate limiting. In-memory rate limiting does not work on serverless (each request may hit a new instance), so use something like Upstash Redis or Vercel's firewall rules.
- Input is capped at 4000 characters per request, and error details are logged server-side only.
