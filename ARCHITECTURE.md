# Where this runs, and why it is split in two

Fini, 22 September 2026: *"we move away from tunnels and bullshit. We need this
to exist actually on the platform. So that everyone can access it. Not when my
PC is dead and then I cannot access it."*

So the desk lives on the Hetzner box beside the engine, on a real domain with
real TLS. No cloudflared, no workstation in the path, nothing that dies when a
laptop lid closes.

```
                    ALWAYS ON                                WHEN IT IS AWAKE
  ┌──────────────────────────────────────────┐        ┌────────────────────────┐
  │  desk.balkaris.ch   91.99.153.205        │        │  the workstation, 4090 │
  │                                          │        │                        │
  │  Telegram webhook   a link lands         │        │  runner polls out      │
  │  SQLite queue       and is kept          │◄───────┤  over HTTPS            │
  │  the console        everyone can read    │  pulls │                        │
  │  the publisher      pushes to the site   ├───────►│  Ollama   gemma4:26b   │
  │                                          │  work  │  ComfyUI  covers       │
  └──────────────────────────────────────────┘        └────────────────────────┘
```

## Why not all of it on the box

The box is 3.7 GB of RAM and no GPU. `gemma4:26b` wants about 19 GB of VRAM.
Nothing that writes a readable paragraph fits on that machine, and the rule
from the same conversation is that no paid API key lives in this repo.

So the split is not a compromise, it is the only arrangement that keeps both
promises:

- **The service is always up.** The bot answers, links are accepted and kept,
  the console lists everything, drafts already written can be read, edited and
  published — with the workstation off, asleep or in another country.
- **The writing is free.** It happens on the 4090, which polls the box for
  work. A link shared at midnight is written up when the machine next wakes.

The console says which of the two states a piece is in, and the bot answers
"queued — the workstation is asleep, this will be written when it wakes"
rather than going quiet. Nobody is left wondering.

**If that wait is not acceptable**, there are exactly two doors and both are
Fini's call, not a thing to decide quietly in a commit: a paid API key for the
writing step (fast, always on, costs per article), or a GPU server (always on,
costs per month whether or not anything is written). The queue is built so
either can be dropped in as a second runner without changing anything else.

## What runs where

| | Box (`/opt/balkaris-desk`) | Workstation |
|---|---|---|
| Telegram | webhook endpoint | — |
| Queue + drafts | SQLite at `/opt/balkaris-desk/desk.db` | — |
| Console | `desk.balkaris.ch`, behind Caddy | — |
| Reading a URL | yes — it is only a fetch | — |
| Matching services | yes — it is a table, not a model | — |
| Writing the article | — | Ollama |
| Cover images | — | ComfyUI |
| Publishing to the site | yes — git push over a deploy key | — |

Matching runs on the box on purpose: it is `src/match.ts`, a table of terms,
and it costs nothing. A link therefore gets its shelf and its services the
moment it arrives, and only the prose waits for the GPU.

## The three credentials, and who makes them

None of them is ever held by a session. Each is a console step with one line
of preparation around it.

| What | Where the value lives | Who makes it |
|---|---|---|
| Telegram bot token | `/opt/balkaris-desk/.env` on the box | Fini, @BotFather |
| `DESK_RUNNER_SECRET` | the box `.env` + the workstation `.env` | minted by `deploy/mint-runner-secret.sh`, which puts it in both places and prints nothing |
| GitHub deploy key | private half stays on the box, generated there | Fini pastes the PUBLIC half into the repo's Deploy keys, write access |

No tunnel token. The tunnel is gone.
