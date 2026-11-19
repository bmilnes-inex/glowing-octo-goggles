# Handoff: start Claude Code sessions on this PC from my iPhone

## Goal

I want to start new Claude Code sessions on this Windows PC from the Claude app on my iPhone, using Remote Control. Each new session gives me fresh context, and I can run several at once. The PC does the work; my phone is just the screen.

## Where things stand

- I dropped the SSH plan. Don't set up SSH, Tailscale, WSL or tmux.
- A cloud session checked my account. This PC isn't serving any folders to Remote Control yet, so nothing shows up on my phone.
- My phone is an iPhone with the Claude app.

## What I need you to do

1. **Check what's installed.** Is the Claude desktop app installed? What does `claude --version` return? Is it signed in to the same account as my phone? Report what you find before changing anything.
2. **Turn on Remote Control.** In the desktop app it's under Settings → Claude Code → Remote Control. I'll do the clicking; you tell me what to look for. Ask me which folders to add. If my version doesn't have this setting, tell me and go to the fallback below.
3. **Start the desktop app at login.** Check whether it already does. If not, tell me how to turn it on.
4. **Keep the PC awake on power.** Show me the current sleep and hibernate timeouts (`powercfg /query`). Then propose setting both to Never on AC power (`powercfg /change standby-timeout-ac 0` and `powercfg /change hibernate-timeout-ac 0`). Ask before you run them.
5. **Test it with me.** I'll start a new session from my phone in one of the folders. Have that session run `hostname` and create a file named `remote-control-test.txt` in the folder, so we know it ran on this PC. Delete the file afterwards.

## Fallback

If the desktop app has no Remote Control folder setting, run `claude remote-control` in a terminal in each folder. It only works while that terminal stays open. If I want it to survive reboots, propose a scheduled task that starts it at logon, check that it actually works without a visible terminal, and don't create the task until I say yes.

## Rules

- Ask before changing system settings, the registry, scheduled tasks or startup apps.
- Don't install anything without asking.
- When you're done, tell me in a few lines: what's set up, which folders my phone can see, and anything left for me to do.
