# Claude Code laptop migration (Windows -> Windows)

Two PowerShell scripts to move your Claude Code configuration, projects, and
chat history from one Windows laptop to another.

## What gets moved

Everything under `%USERPROFILE%\.claude\`:

- `projects\` — chat/session history (`.jsonl` transcripts, one per session)
- `.claude.json` — your OAuth login token (so you don't have to log in again)
- `settings.json` — global Claude Code settings
- `agents\`, custom skills, `keybindings.json`, hooks, etc.

> Your **project source code** is NOT inside `~/.claude/`. Move those folders
> (e.g. `C:\Users\you\code\...`) the same way you'd move any other files.

## Steps

### 1. On the OLD laptop

```powershell
powershell -ExecutionPolicy Bypass -File .\Backup-ClaudeCode.ps1
```

This produces `claude-backup-YYYYMMDD-HHMMSS.zip` on your Desktop.

### 2. Move the zip to the NEW laptop

USB stick, OneDrive, network share — anything works. Treat the zip as
sensitive: it contains your auth token.

### 3. On the NEW laptop

Put the zip on the Desktop (or anywhere), then:

```powershell
powershell -ExecutionPolicy Bypass -File .\Restore-ClaudeCode.ps1
```

If the zip isn't on the Desktop, point at it explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\Restore-ClaudeCode.ps1 -ZipPath "C:\path\to\claude-backup-...zip"
```

If a `.claude` folder already exists on the new machine, the script renames it
to `.claude.bak-<timestamp>` instead of deleting it.

### 4. Verify

Open a terminal in any project folder and run `claude`, then `/resume`. Your
old sessions should be listed.

## Notes

- If the OAuth token has expired by the time you restore, Claude will prompt
  you to run `claude login` once. Your projects and chat history are
  unaffected.
- Sessions are local-only — there is no cloud sync, so this manual move is
  the only way to bring them across.
