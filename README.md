# balkaris-desk

The website's own workbench, at **desk.balkaris.ch**.

Share a link in Telegram. The desk reads what is on the other end, writes a
Balkaris article about it, decides which of our services the piece is actually
about, and puts the draft in front of a human. Approve it and it is committed
to `balkaris-web-infrastructure` and live on balkaris.ch about two minutes
later.

```
Telegram  --->  read the page  --->  local model  --->  match  --->  draft  --->  you approve  --->  git push
 (share)         no API, no key       gemma4 on the      HARD-CODED    one of three    Telegram or        Vercel
                                      4090, 0 credits    rules, no AI   templates       the desk           builds
```

## The rules this thing is built on

**No paid API keys. Ever.** Every model call goes to Ollama on this machine
(`OLLAMA_URL`, default `http://127.0.0.1:11434`). There is no Anthropic client
in this repo and no `ANTHROPIC_API_KEY` in `.env.example`, on purpose: the
whole point of the desk is that a blog post costs electricity and nothing else.
`src/llm.ts` will refuse a model name that is not local.

**The service matching is hard-coded.** Which Balkaris services a piece is
about is decided by a table of terms in `src/match.ts`, not by a model. A model
that picks services invents a plausible one about twice a week and nobody
notices until a client does. A table is wrong in a way you can read, fix and
test — `npm run match -- "<some text>"` shows its working.

**The design is not generated.** Three fixed templates in `src/templates.ts`
and a rule that picks one. An article that lays itself out differently every
time is not a journal, it is a demo.

**The source is always cited.** A post generated from somebody else's article
links it, names it, and carries Balkaris's own argument — never a reworded
copy. See "What this must not become" below.

## What this must not become

Scraping an article and republishing a paraphrase of it is two problems at
once: it is someone else's work, and Google calls it scaled content abuse and
demotes the whole domain for it — balkaris.ch included. So the pipeline is
built to produce **commentary**: what the source said, in a sentence or two
with a link, and then what Balkaris thinks about it and what it means for the
people we work for. `src/draft.ts` enforces the shape; a draft that is mostly
the source is rejected before a human ever sees it.

## Layout

| Path | What |
|---|---|
| `src/bot.ts` | Telegram long-poll front door. No webhook, no open port. |
| `src/extract.ts` | URL → title, author, date, clean text. |
| `src/llm.ts` | The one door to Ollama. Refuses anything not local. |
| `src/catalogue.ts` | The site's 30 services and 6 shelves, as data. |
| `src/match.ts` | **The hard-coded matcher.** Terms → shelf + services. |
| `src/templates.ts` | Three article shapes and the rule that picks one. |
| `src/draft.ts` | Extract + match + template → a `Post`. |
| `src/publish.ts` | Post → a file in the site repo, committed and pushed. |
| `src/console.ts` | The small web console behind the tunnel. |

## Running it

```bash
npm install
cp .env.example .env     # then fill in the two tokens, see below
npm run match -- "Google is rolling out AI overviews to Swiss search results"
npm run draft -- https://example.com/some-article
npm run bot
```

## The two things a person has to do once

Both are console steps — a session prepares everything around them and never
holds the value.

1. **A Telegram bot.** @BotFather → `/newbot` → name it, take the token, save
   it as `E:\Balkaris\secrets\desk-telegram-token.txt`. Then `/setprivacy` →
   Disable, so it can see links posted in a group.
2. **A tunnel.** Cloudflare Zero Trust → Networks → Tunnels → Create →
   `desk` → public hostname `desk.balkaris.ch` → `http://localhost:3400`.
   Save the connector token as `E:\Balkaris\secrets\desk-tunnel-token.txt`.

Both belong in the index at `E:\Balkaris\secrets\README.md` once they exist —
name, scope, date, where it lives. Never the value.
