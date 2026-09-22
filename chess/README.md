# Blunderboard

A head-to-head chess.com scoreboard for two friends, with running commentary and the
next game night on the front page. Static web app, installable on a phone home screen.

## How it works

- No backend and no manual scorekeeping. The page pulls both players' games from the
  chess.com public API (`api.chess.com/pub`), keeps only the games you played against
  each other, and computes everything on the phone.
- Completed months are cached in the browser so a reopen is instant. The current month
  is re-pulled every few minutes and whenever you tap refresh.
- Setup is two chess.com usernames. Everything else (nicknames, game night rule, start
  month) is optional and lives in the URL hash, so one link sets up the other phone.

## What is on the board

- Big score with a crown on the leader and titles that change with the margin
  ("Reigning Tyrant", "Rating Donor", "Due For One").
- Tug-of-war bar for share of wins.
- A daily trash-talk headline generated from the actual record (streaks, clock losses,
  resignations, rating gaps, openings, the belt). "Another one" reshuffles, "Send it"
  shares it with the score and link.
- Next game night with a countdown ring, defaulting to the last Wednesday of the month,
  with a recurring calendar file and a Google Calendar link.
- Factory-style "days since X last won" sign.
- Recent form pips and current streak.
- The belt: changes hands on every decisive game, tracks days held and defenses.
- Record book: longest streaks, fastest wins, how each of you usually wins, record by
  color, game-night record, ratings, longest game, most played opening.
- Month-by-month strip and a recent games list with replay links.

## Deploying (GitHub Pages)

The workflow in `.github/workflows/pages.yml` publishes this folder. One-time setup in
the repository: Settings, Pages, Source: **GitHub Actions**. After that every push to
the listed branches redeploys. The site lands at
`https://<owner>.github.io/<repo>/`.

Any static host works too (Netlify, Cloudflare Pages, Vercel): point it at the `chess/`
folder. The app uses relative paths only.

## Putting it on a phone

- **iPhone:** open the link in Safari, tap Share, then Add to Home Screen. It opens
  full screen with the app icon.
- **Android:** open the link in Chrome, tap Install (the page offers it) or use the menu
  and choose Add to Home screen.
- iOS does not allow true home-screen widgets for web apps. The closest thing is a
  Shortcuts widget with an "Open URL" action pointing at the link, or the app icon.

## Local development

```
npx http-server chess -p 8123 -c-1
```

Then open `http://127.0.0.1:8123/`. Browsers call chess.com directly (it allows
cross-origin reads), so no proxy is needed.

## Notes

- Only standard chess counts. Variants (Chess960, bughouse, and so on) are excluded and
  the count of excluded games is shown.
- Draws do not extend or break a streak and do not move the belt.
- "Game night" games are those finished on the configured day (local time).
- Full resync and a reset live in Settings.
