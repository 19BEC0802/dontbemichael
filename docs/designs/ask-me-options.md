# Ask me: answering options and several questions

Status: design reviewed and approved (owner, 2026-10-15). Not built. Eng review next.

## Problem

Almost every Ask me card ends in a numbered list and one text box. The owner can't tell
how to answer it: "1", "option 1", or the whole sentence. The list also means two
different things, and one box serves neither well.

From the MoblizeIT reference office (157 asks in `tasks.json`, 2026-10-15):

| Shape | Asks | Example |
|---|---|---|
| A choice: pick one, often with "(recommended)" | 107 | Pete's permission card: "I'll open Pete's chat" or "Leave Pete paused" |
| Several questions, each needing its own answer | 31 | "Maheep: staff, contractor or remove?", "Who can sign in to `it@`?" |
| Mixed: some items choices, some questions | 14 | Follow ups, close date, deal types |
| No list | 5 | |

Real answers show the guesswork: "4. yes", "1. removed 2. maheep is no longer in google",
"leave it", "yes go ahead".

The card can't help because the options exist only as text inside the question
(`humanQA[i].q`). Michael is told to "give each option its own bullet or number"
(`src/main/hive.ts`), and `AskMeTab.tsx` renders the question as markdown above one
`GrowingTextarea` and a Reply button.

## Decisions

Every decision below was the owner's, one at a time, on 2026-10-15.

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | Choices and several questions; mixed lists and to-dos get a lighter pass |
| D2 | Answering a choice | Pick, then Reply. Nothing is sent until Reply; free text stays on every card |
| D3 | Reply placement (A1) | Text box full width under the options; Reply on its own row at the end of the card; its label follows the pick |
| 1 | Where options come from (1A) | Michael writes them as fields on the ask; older asks with no fields look exactly like today |
| 2 | Partial answers (2A) | Reply sends the answered questions; the rest stay open on the card |
| 3 | Draft picks (3A) | A pick, a note and question lines are kept like a typed draft |
| 4 | Recommended option (4B) | Nothing starts picked; the recommendation is a green tag |
| 5 | Answer wording (5A) | The option's own words plus which option, never a bare number |
| 6 | Design system (6A) | The new parts are specified in DESIGN.md §7.8 with existing tokens |
| 7 | Keyboard (7A) | Standard radio group; Cmd or Ctrl+Enter sends from anywhere in the card |
| 8 | Mixed lists (8A) | A question can carry its own small choice chips plus a line to type |
| 9 | To-do asks (9A) | Michael gives them a "Done, I did it" option, plus others as fit; no new card kind |

## The ask, as Michael writes it (1A)

A `humanQA` entry keeps `q`, `askedAt`, `raisedBy`. `q` keeps the bold first sentence
and the short context, and no longer repeats the options or questions as a list. Two
optional fields are new:

```json
{ "q": "**Pete has stopped on a permission prompt that only you can answer.** ...",
  "options": [
    { "label": "I'll open Pete's chat and answer it", "recommended": true },
    { "label": "Leave Pete paused for now" }
  ] }
```

```json
{ "q": "**Dwight needs three calls on the live deals.**",
  "parts": [
    { "q": "Follow ups: where should Dwight start?",
      "options": [{ "label": "Batches of 20, contacted first", "recommended": true }, { "label": "Not now" }] },
    { "q": "Close date: all 246 sit on 15 Oct. New date?", "options": [{ "label": "Leave it" }] },
    { "q": "Allucent: subscription, retainer or project?",
      "options": [{ "label": "Subscription" }, { "label": "Retainer" }, { "label": "Project" }] }
  ] }
```

- `options` makes the ask a **choice**. `parts` makes it **several questions**; a part
  with its own `options` is a mixed question (8A). An entry has one or the other.
- A **to-do** (9A) is a choice whose first option is "Done, I did it", with others as
  fit ("Not yet, remind me tomorrow").
- An entry with neither field, or with fields the app can't read, shows exactly as
  today: markdown question, one box, Reply. Nothing changes for asks already waiting.

## The answer, as the app records it (5A, 2A)

- A choice: `a` is "Picked: <option label>" plus ". Note: <note>" when one was typed,
  and `picked` is the option's index. Free text with no pick: `a` is the text, as today.
- Several questions: each answered part gets its own `a` and `answeredAt` on the part.
  The entry stays open on Ask me while any part is unanswered and not withdrawn; it is
  answered when every part is. A part answered with a chip records "<chip label>", plus
  " (<typed text>)" when both were given.
- What Michael gets, and what goes into the raiser's memory notes, is the same labeled
  text, for example "Picked: I'll open Pete's chat and answer it" or
  "1: remove. 2: only me. Also: check Cloudflare too". A partial reply names only the
  parts it answers.

## The card (A1)

Approved mockup: see Approved Mockups below.

Open card, top to bottom: title, person chip and time (unchanged); the question
markdown; then by kind:

- **Choice:** the option rows (a radio group), then the full width box, then Reply on
  its own row, at the end. The box's placeholder is "Or write your own answer", and
  "Add a note (optional)" once an option is picked.
- **Several questions:** each part as its number, its question, its choice chips if
  it has any, and a one line field ("Your answer", or "Or your own answer" under
  chips). An answered part shows "Answered: <answer>" in green in place of its field.
  Then "Anything else (optional)" full width, then Reply on its own row.
- Holding up N tasks, and the See full context footer, are unchanged.

Reply's label says what will go:

| State | Label | Enabled |
|---|---|---|
| Nothing picked or typed | Reply | No |
| Own text only | Reply | Yes |
| Option n picked | Reply with option n | Yes |
| Option n picked and a note | Reply with option n and note | Yes |
| Several questions, k of m open ones answered (k < m) | Reply to k of m | Yes |
| Several questions, all open ones answered | Reply | Yes |
| Sending | Sending… | No |

Picking an option never sends. Clicking a picked option again unpicks it. Nothing
starts picked (4B). Folded cards are unchanged: the headline only, and the Draft tag
when anything is picked or typed (3A).

## DESIGN.md §7.8 addition (6A)

Add to the Open bullet of §7.8, with these tokens (all existing):

- Option row: `card` fill, 1 px `line-2` ring, `r-md`, padding 8 × 10, gap 9; a 16 px
  radio dot (1.5 px `line-input` ring); the option number at 11 / 600 `ink-3`, then the
  label at 12.5 / 18 `ink`. Rows 6 px apart, 10 px above the box. Hover: `card-2` fill,
  `line-input` ring. Picked: `indigo-soft` fill, 1.5 px `indigo` ring, dot filled
  `indigo` (8 px). Focus: 2 px `indigo` ring.
- Recommended tag: pill, `green-soft` fill, `green-text`, 10.5 / 600, 18 px tall,
  6 px after the label. Text "Recommended".
- Choice chip (a part's options): 26 px pill, `card` fill, 1 px `line-2` ring,
  11.5 px `ink`, 5 px apart; pressed like a picked row (`indigo-soft`, 1.5 px `indigo`).
  The Recommended tag inside a chip is 16 px tall at 10 px.
- Question line: the number at 11 / 600 `ink-3` in a 20 px column, end aligned; the
  question at 12.5 / 18; its field the existing `.cth-input` at 30 px tall; parts 10 px
  apart. Answered: "Answered: <answer>" at 11 / 600 `green-text` in place of the field.
- Reply: the existing primary `sm` button, 34 px, on its own row, end aligned, 8 px
  below the box.

## States

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Choice card | Card shows as today while Needs you loads | No options field: legacy card | Reply failed: "Your reply could not be saved" (existing `askMe.mailFailed`); pick and note kept | Card leaves; "Your answer" under All clear shows the labeled answer | n/a |
| Several questions card | as above | No parts field: legacy card | as above; every typed line kept | Card leaves when every part is answered | Answered parts show "Answered: …"; the card stays with the rest open (2A) |
| Draft | n/a | n/a | n/a | Pick, chips and lines survive fold and tab switch; Draft tag on the folded card (3A) | n/a |
| Withdrawn while drafting | n/a | n/a | Existing path: nothing is sent, the draft is kept, the board reloads | n/a | A part Michael withdrew shows as withdrawn, like a withdrawn ask today |

## Journey

| Step | Owner does | Owner feels | Supported by |
|---|---|---|---|
| 1 | Opens the newest card | Oriented: what is asked, by whom | Bold first sentence, person chip (unchanged) |
| 2 | Scans the choices | Clear what the options are | Numbered rows with a radio dot; green Recommended tag |
| 3 | Picks one | Safe: nothing has gone yet | Row turns indigo; Reply now reads "Reply with option 1" |
| 4 | Adds a note, or writes their own | Free to say more | Box stays open on every card |
| 5 | Presses Reply | Certain what was sent | Label named it; "Your answer" shows the labeled text |
| 6 | Weeks later, opens Task detail | Understands the decision | History reads "Picked: …", never "1" (5A) |

## Behavior changes (agent and orchestration)

Listed as their own items for the owner, as the standing rule asks.

1. **Michael's ask instructions change** (both places: the house rules in `hive.ts` and
   the PROTOCOL text). Today: "Give each option its own bullet or number." Proposed: a
   choice goes in `options` (one marked `recommended` when he has a recommendation);
   several questions go in `parts`, each with its own `options` when it is a choice; the
   question text keeps only the bold sentence and short context; a to-do gets a
   "Done, I did it" option first. Who: Michael. What the owner sees: option rows and
   question lines instead of a numbered list.
2. **Michael may get more than one reply per card** (2A). A partial reply names the
   parts it answers; the card stays open with the rest. Who: Michael. What the owner
   sees: the card stays until every part is answered.
3. **Answers reach Michael and memory notes labeled** (5A): "Picked: <option>" or
   "1: …. 2: …". Who: Michael and the raiser's memory. What the owner sees: the same
   text under "Your answer" and in Task detail.

## NOT in scope

- Changing older asks already waiting: they keep today's card (1A).
- The app guessing options from markdown (1B, 1C declined).
- Number key shortcuts (7B declined).
- A dedicated Mark done button or ask kind (9B declined).
- Preselecting the recommended option (4A declined).
- Reports ("Got it" cards), schedule requests, Work style offers and mail proposals:
  separate card types, unchanged.

## What already exists

- `AskMeTab.tsx`: card shell, fold and open, drafts in the store (`answerDrafts`),
  Cmd or Ctrl+Enter, failed reply message, All clear with "Your answer".
- `askMeRouting.ts`: `openAskIndexes`, `isAnswered`, `isWithdrawn`, `answerMessages`,
  `raiserOf`; the merge that lands an answer only on the same open question.
- `GrowingTextarea`, `PixelButton` (primary `sm`), `.cth-input`, `FileText` (file chips
  and named links inside the question and part text).
- `TasksKanban.tsx` Task detail history, which shows each `humanQA` entry.
- DESIGN.md §7.8, which this extends.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a decision above.

- [ ] **T1 (P1, human: ~1d / CC: ~30min)**: askMeRouting: `options` and `parts` on HumanQA
  - Surfaced by: decision 1 (1A), 2 (2A), 5 (5A)
  - Files: `src/shared/askMeRouting.ts`, `src/renderer/src/components/hiveTasks.ts`, `src/main/hive.ts` (HumanQA type)
  - Read and validate the fields (unreadable means legacy); an entry with parts is open until every part is answered or withdrawn; build the labeled answer text; `answerMessages` sends it.
  - Verify: unit tests for parsing, openness with parts, and the labeled text.
- [ ] **T2 (P1, human: ~2d / CC: ~1h)**: AskMeTab: choice rows, question lines, chips, Reply label
  - Surfaced by: D2, D3, decisions 3, 4, 7, 8, 9
  - Files: `src/renderer/src/components/AskMeTab.tsx`, `src/renderer/src/store/store.ts` (draft shape), new small components as needed
  - Radio group (arrows, Space), chips with `aria-pressed`, Reply on its own row with the state table labels and an accessible name that includes the option text; drafts keep picks; partial replies patch only answered parts.
  - Verify: tests on the component source and the draft store; run the app and answer each mockup case.
- [ ] **T3 (P1, human: ~2h / CC: ~15min)**: Michael's ask instructions
  - Surfaced by: decision 1, 9; Behavior changes 1 to 3
  - Files: `src/main/hive.ts` (house rules and PROTOCOL)
  - Verify: prompt text tests; one live ask from Michael arrives with fields.
- [ ] **T4 (P2, human: ~2h / CC: ~15min)**: Task detail shows parts and picks
  - Surfaced by: decision 5
  - Files: `src/renderer/src/components/TasksKanban.tsx`
  - Verify: history shows "Picked: …" and each part with its answer.
- [ ] **T5 (P2, human: ~1h / CC: ~10min)**: strings in en, ar, zh-CN, no dashes
  - Surfaced by: D3 labels, decision 4 tag, states table
  - Files: `src/renderer/src/i18n/locales/*.json`
  - Verify: i18n key and no dash tests.
- [ ] **T6 (P2, human: ~30min / CC: ~5min)**: DESIGN.md §7.8 addition
  - Surfaced by: decision 6
  - Files: `branding/DESIGN.md`
  - Verify: read back against the mockup.

## Questions for eng review

Not design decisions; for `/plan-eng-review` to settle:

- Limits for `options` and `parts` (how many, label length) before an ask falls back to
  the legacy card.
- How a partial reply patches parts through `hivePatchTask` and the existing merge, so
  an answer lands only on the same open part.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Ask me card, all kinds | `/Users/moblizeit/.gstack/projects/agentvivekkumar-dontbemichael/designs/ask-me-options-20261015/ask-me-options.html` | A1 choice card, to-do, several questions partly answered, mixed with chips | The dashed "Michael gets" line is a review aid, not part of the design. Rounds 1 and 2 kept beside it for history |

## Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW: COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md §7.8 exists; UI scope: Ask me card |
  | Step 0               | 4/10; focus: choices + several questions     |
  | Pass 1  (Info Arch)  | 5/10 → 8/10 after fixes                      |
  | Pass 2  (States)     | 4/10 → 8/10 after fixes                      |
  | Pass 3  (Journey)    | 6/10 → 9/10 after fixes                      |
  | Pass 4  (AI Slop)    | 8/10 → 8/10 (no issues)                      |
  | Pass 5  (Design Sys) | 5/10 → 9/10 after fixes                      |
  | Pass 6  (Responsive) | 4/10 → 8/10 after fixes                      |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                            |
  | What already exists  | written                                      |
  | TODOS.md updates     | 0 items proposed                             |
  | Approved Mockups     | 3 rounds generated, round 3 approved         |
  | Decisions made       | 11 added to plan                             |
  | Decisions deferred   | 0                                            |
  | Overall design score | 4/10 → 8/10                                  |
  +====================================================================+
```

Outside voices were skipped: the owner's standing rule keeps Codex to the adversarial
pass only.

### Unresolved Decisions

None.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | none | none |
| Outside Review | none | Independent 2nd opinion | 0 | skipped (owner rule: Codex adversarial only) | none |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | none | none |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 4/10 → 8/10, 11 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | none | none |

- **OUTSIDE COVERAGE:** design outside voices skipped by the owner's standing rule (Codex only for adversarial review); no outside provider ran.
- **VERDICT:** DESIGN CLEARED; eng review required.

NO UNRESOLVED DECISIONS
