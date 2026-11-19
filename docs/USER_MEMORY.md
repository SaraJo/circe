# Personal memory for Circe

Circe automatically extracts durable personal facts from new user messages and
recalls relevant facts across its tiles and conversations. Facts and vectors
live in a local SQLite database. Extraction and embedding use local Ollama
models; no memory service account is required.

## Setup

Install and start [Ollama](https://ollama.com), then download the default models:

```sh
ollama pull qwen3:4b
ollama pull embeddinggemma
```

Open **Memory** in a tile, or **Circe → Memory…** (`Cmd/Ctrl+Shift+M`). Use
**Check local models** to verify both extraction and embedding.
The check extracts a synthetic preference and a biographical fact embedded in a
request to verify extraction beyond simple preference statements. These samples
are never saved as personal facts. Missing models are identified by name
with the download command needed to install them. Other installed
local model names can be selected in this window. Save settings before checking
changed model names. Cloud model names and aliases reporting a remote model or
host are refused. All memory requests use `127.0.0.1:11434`; redirects are refused.
Circe does not install models or change the running Ollama server.

Automatic capture and recall default to on. If local models are unavailable,
normal chat continues; the Memory window reports failures. No old conversations
are imported or replayed into capture when the models become available.

Storage, fact extraction, and semantic search run locally. Retrieved facts are
included in prompts sent to the user's configured Hermes conversation model,
which may be a hosted model. Hermes may retain that context in conversation
history. This feature does not make the rest of a Hermes conversation local.

## Review, correct, and forget

The Memory window lists saved facts with supporting quotes, source profiles,
conversation IDs, and timestamps. Search by text, topic key, or profile. Edit
corrects a fact and rebuilds its embedding. Changing the embedding model in
settings reindexes the existing facts before publishing the new configuration.
A failed reindex leaves the previous configuration intact.

Editing or forgetting a personal fact also clears its source task's Circe
history and other saved tasks known to have been supplied that fact. Context
receipts containing personal-fact snapshots are cleared too. This prevents
known derived task interpretations from reintroducing an outdated or forgotten
fact. Hermes's separate conversation store is unaffected.

**Forget** removes the fact and its vector. A one-way hash of its topic key
prevents later automatic capture under that same key. Pending captures begun
before the review action are discarded, and in-flight recall is invalidated.
A model can express the same topic under a different key, so this is not a
semantic guarantee that a topic will never be learned again from a new message.

**Forget all and turn memory off** removes saved facts, vectors, task sources,
checkpoints, and context receipts and disables capture and recall. The setting persists after restart. Enabling memory
again resumes capture from new messages; existing topic-key blocks remain.

Forgetting does not delete earlier chats, context already sent to a model,
Hermes's built-in `USER.md` / `MEMORY.md`, or another memory provider's records.
Circe does not mirror its saved facts into those stores. If a fact is present in
one of those independent sources, the agent may still know it.

## Capture and recall

This section describes personal-fact capture. Task history, described below,
separately saves original user and assistant text.

Only original user text from completed Circe turns is submitted for capture.
Assistant output, tool results, session replay, generated handoffs, and injected
memory context are excluded. Images are not submitted to the memory models.
Capture runs in the background and is best effort: closing the app can discard
unfinished extraction. Saved database changes are atomically replaced on disk.

The extraction prompt asks for explicit, durable personal statements and
excludes quotations, hypothetical examples, task requests, guesses, and secrets.
Each proposed fact must contain an exact supporting quote from the user message.
This validates provenance, not logical entailment: a local model can still
misinterpret a statement. Review matters, and memory cannot eliminate every
model error or form of drift.

Facts use stable attribute keys such as `user.home.city`. Existing relevant and
recent facts are supplied to extraction so a correction can reuse a key and
replace its old value. Correctness depends on the local model choosing the same
key; conflicting facts under different keys are not automatically resolved.

Recall embeds the current request, ranks compatible vectors by cosine
similarity, and includes at most six facts above the relevance threshold.
The current user message and corrections are explicitly authoritative. Added
context is hidden from the user's replayed message bubble, but remains in the
underlying Hermes history. Retrieval failures fall back to an ordinary prompt.

Bounds: 2,000 facts, six facts per captured message, 500 characters per fact,
20 pending capture jobs, and 12,000 characters per captured user message. Longer
messages and excess jobs are skipped. The UI reports queue overflow and the
fact limit. Capture prompts include at most 16 existing facts. Large lists in
the review window show 100 matches at a time; search narrows the full list.

## Task history, checkpoints, and context used

With memory on, **Keep task history, checkpoints, and source lookup** controls
automatic task capture independently of personal-fact capture. Only new Circe
turns are captured. No older Hermes history is imported. Original user messages
are saved when sent; assistant messages are saved on successful completion.
Interrupted partial assistant output and generated handoffs are excluded.
Attachment paths, images, and tool results are not archived as source messages.

Each conversation starts its own task. **Start fresh with handoff** links the
new session to the same task before delivering queued prompts. A blank tab
starts a separate task. Task sources remain private to the originating agent;
personal facts are shared across the Circe crew as before.

A background local model maintains a versioned checkpoint: goal, constraints,
decisions and reasons, reported progress, open questions, and next steps. Every
item cites stable source IDs. Original messages remain available after a
checkpoint is replaced. Unknown source citations or invalid output leave the
previous valid checkpoint intact and show an error in Memory. A checkpoint is
an interpretation, not independently verified truth. Assistant-only proposals
are labeled unconfirmed; assistant-only progress is labeled reported. The
original explicit task request is retained as a fallback when a model omits
the goal. Common explicit directives such as "keep the hotel refundable" are
retained as user-source quotes through short follow-ups. Explicit corrections
can supersede earlier quoted constraints. Natural-language interpretation is
still fallible; review important decisions and corrections against their sources.
Checkpoints are bounded to eight constraints and four entries per other field.

Before a user turn, Circe supplies matching personal facts, the current task's
checkpoint, and up to four source excerpts. Recent messages remain available
for vague follow-ups while checkpoint generation is pending. Source search
uses keyword matching within the task; it does not embed whole transcripts.
No full proxy compression or automatic rewriting of Hermes history is added.

Expand **Context used** in a tile to inspect the exact context prepared for that
turn. It shows what Circe supplied, rather than claiming to observe the model's
reasoning. Sources fetched through Circe tools during the turn are recorded
under the same receipt, with up to eight source/page excerpts shown. Recent saved receipts
can also be reviewed under **Memory → Task history & context used**. Source
buttons open the original message. Supplied receipts can be restored alongside
replayed prompts that include Circe's receipt marker.

Supported Hermes sessions receive three read-only MCP tools: `search_context`,
`read_context`, and `task_checkpoint`. They search the agent's recorded history,
return exact source pages, and read checkpoint state. The local server binds to
`127.0.0.1` on a random port, requires a per-agent token, rejects browser origins,
and grants access only to that agent's records. Credentials are passed through
session-scoped ACP configuration and never change permanent Hermes settings.
Tool calls include the current context receipt ID so source reads can be
attributed to their turn and included in deletion lineage.
If Hermes rejects the HTTP MCP configuration, Circe retries ordinary chat;
automatic context injection and the review window remain available.

Use **Delete this task's Circe history** to remove original sources, all checkpoint
versions, and receipts for a conversation and its continuations. Pending updates
and late pre-deletion turns cannot restore them. New post-deletion turns may
start recording again. Personal facts and original Hermes conversations remain.

Bounds: 5,000 source messages and approximately 20 million stored JSON characters
across tasks, 120,000 characters per source message, 20 pending checkpoint jobs,
20 checkpoint versions per task, and 1,000 receipts globally. When a limit is
reached, capture reports a failure instead of silently evicting original sources.
The review window shows up to 30 sources and 30 receipts per selected task.
Source tools page exact text in chunks up to 12,000 characters.

## Architecture and ownership

- `src/main/memory/store.ts` owns a SQLite database via `sql.js`, avoiding native
  Electron ABI dependencies. Vectors are stored with facts and their model
  names; an exact cosine scan suits this bounded personal store.
- `src/main/memory/ollama.ts` owns local model calls, response validation,
  quote grounding, and checks against cloud model aliases.
- `src/main/memory/service.ts` owns capture ordering, recall, reindexing, review,
  status, and invalidation of background work after edits or deletion.
- `src/main/memory/tasks.ts` owns source capture, checkpoint updates, search,
  handoff continuity, and context receipts. `contextServer.ts` exposes the
  read-only MCP transport; the SQLite store remains the single writer.
- `TileRegistry` adds context immediately before dispatch and submits original
  user text after completion. Preparation preserves prompt order without
  blocking ACP follow-up interruption until the previous turn finishes.
- The Memory window uses a dedicated preload and IPC handlers restricted to
  that window's main frame. Text is rendered using DOM text nodes. Navigation
  and child windows are refused.

All participating Circe tiles share `$HERMES_HOME/circe/memory.sqlite`. Only
messages sent through Circe enter this store; conversations through the Hermes
CLI or another surface do not. Existing Hermes providers and built-in memory
continue independently. Unlike the initial proposal, this implementation owns
its local pipeline so it can provide direct review/deletion without requiring
a particular Hermes provider plugin or its dependencies.

The SQLite file is not encrypted. Its directory/file are created with private
permissions where supported. SQLite secure deletion clears removed content from
the newly exported database file; filesystem backups and snapshots are outside
that guarantee. Topic-key blocks contain hashes, not fact text. A single Circe
instance owns the database, and failed writes do not publish provisional state.
An unreadable or corrupt database is reported rather than silently reset.

## Validation

`test/memory.test.ts` covers restart persistence, semantic ranking using
synthetic vectors, shared profiles, keyed corrections, deletion races, blocked
recapture, paused settings, edits, model changes, failed writes, grounding,
cloud alias refusal, and invalid vectors. The tile tests verify prompt ordering,
original-text capture, and normal delivery when recall fails. Framing tests
cover history display. Tests use temporary databases and synthetic facts.

Run `CIRCE_LIVE_MEMORY_TEST=1 npm test -- test/memory.live.test.ts` with the default
local Ollama models installed to check biographical facts, classes, facts within
requests, negative examples, and the completed-turn capture path through SQLite,
corrections, reopening, and semantic recall. It uses fictional facts in temporary
databases and never imports or modifies existing personal memories.

An Electron smoke check verifies SQLite loading, the built preload and renderer,
review edits and deletion, and refusal of IPC from a different window. A live
check with the default Ollama models verifies grounded extraction, persisted
SQLite facts, paraphrased recall after reopening the database, keyed corrections,
and forgetting. These checks use synthetic facts in temporary databases; no
existing personal memories or profile configurations are changed.
