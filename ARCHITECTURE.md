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

## What a gate can and cannot do

Written 23 September 2026, after a day of chasing one flaw through four fixes.
It is here rather than in a `CLAUDE.md` because nobody has asked for one in
this repo and a file that instructs future sessions is Fini's to create, not a
thing to add on a working session's own initiative.

**Every structural gate can only check the shape it was told to look for, and
every gate you add relocates the drift to an axis nobody has named yet.**

The day's evidence, in order:

1. Articles all closed by re-summarising their source. The beat was told, in
   capitals, not to. **A capitalised prohibition always loses to a job whose
   most probable completion is the thing prohibited.**
2. So the job changed: not "close the piece" but "name the one thing to do
   differently this week". The summary survived anyway — the source window was
   still sitting in the prompt. **Proximity does not care which part of the
   context the text came from.**
3. So the close was blinded to everything and given only the article's thesis.
   The summary went. In its place: advice true of the *shelf* rather than the
   article, because removing everything specific left the category as the only
   thing to be specific about.
4. So the close got five jobs and a rule to pick one — and the rule's second
   test was true of nearly every article, collapsing five jobs back to one.
   **The same bug, reproduced one level down, inside the fix for it.**
5. Fixed. Five jobs, genuinely spread. Result: **five habits.** Within a job
   the model has exactly one reach, and it is as strong as the single habit
   was.

Each fix was correct and each one moved the problem somewhere the previous
gate was not looking. That is not a run of bad luck; it is what gates do.

**So the design is: partition it, surface it, let a person judge it.** Five
jobs make convergence five times slower and far more legible, because two
closings sharing a skeleton now means two closings *asked the same question* —
which is a habit — rather than two asked different ones, which is noise. The
detector compares within a job and names the shared phrase. `reclose()` makes
acting on that flag one choice rather than a rewrite.

The levers deliberately **not** taken, so nobody revisits them as oversights:

- **Raising the temperature.** Buys variety by spending coherence.
- **Showing the model its own recent closings as negative examples.** Walks
  straight back into (2): the nearest text gets imitated as readily as it gets
  summarised.
- **A sixth rule.** Buys five more slower habits and a rule table nobody can
  reason about.

The person is the variety. The machine's job is to make their judgement cheap.
