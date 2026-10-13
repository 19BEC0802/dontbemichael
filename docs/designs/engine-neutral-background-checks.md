# Engine-neutral background checks (issue #85)

All six background operations call `runHiddenModel`: standing approval, hire
overlap, work-style conversion, focus-area check, work-style suggestion, and
memory tidy. The main process supplies `godProvider` and `godModel` from the
owner's configuration. An absent provider keeps legacy Claude behavior. The
command names the executable; it does not choose the engine.

## Execution and model choice

- Claude delegates to `runHiddenClaude` with the same Haiku/Sonnet model,
  timeout, settings, tools, authentication, preview and cancellation options
  each caller used before this change. `hiddenClaude.ts` is unchanged.
- Codex uses the owner's `godModel`, when set, or the CLI's default. It never
  receives the callers' Claude models. This increment does not introduce
  automatic quick/careful model selection (see review of PR #176).
- Gemini and every other unimplemented engine return unavailable immediately.
  A request to give Codex tools also returns unavailable.

## Codex boundary

Use the command documented in TODOS.md and tested by the author of #85:
`exec --ephemeral --ignore-user-config --skip-git-repo-check -s read-only`,
disable `shell_tool`, `unified_exec`, `apps`, `browser_use`, `computer_use`,
and set `web_search="disabled"`. Also explicitly disable local image viewing,
multi-agent tools, hooks, remote plugins and skill dependency installation.
These additional controls are documented in the
[official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
The installed CLI exposes image viewing as the `view_image` feature; the older
`tools.view_image` config key is ignored by that build. Use `--disable view_image`
and `--strict-config`, so unsupported configuration is an error instead of a
silently weakened restriction. All six callers request `noTools: true`.

Each invocation gets a private temporary root and an empty workspace inside
it. Its `-o` answer file is a sibling of that workspace, unique to this call.
The prompt goes through stdin, not argv, and no shell is launched. This also
avoids Windows command-line length limits for memory notes. Known Windows npm
shims use the terminal's existing parser to launch their interpreter directly;
unknown batch files return unavailable.

Only a zero exit code with a nonempty answer at most 1 MiB counts as success.
Cancel, timeout and process errors stop the process tree. Every exit path
attempts to remove the temporary files. CLI stdout and stderr are not exposed
as model answers or logged with customer text. Codex's work-style preview is
the final answer only; Claude's existing live preview is preserved.

The existing fallbacks remain: standing approval asks the owner, hire overlap
uses rules, conversion uses plain text, focus remains unchecked, suggestion
returns empty, and memory tidy restores pending notes without changing the
index.

## Validation boundary

The tests use fake model answers and a real local fake CLI process. They check
argument/configuration construction, stdin transport, output isolation,
failure/cancel/timeout, cleanup, and each caller's success/unavailable paths.
They do not prove a real Codex release exposes no tools. The real CLI must be
verified against these restrictions before Codex can enter `BUILD_ENGINES`.
That engine list and all other engine-readiness gaps are unchanged here.
