# ToDo 2.0

A replacement for Microsoft To Do that keeps your tasks in Microsoft Planner.

It works the way To Do did. You get **My Day**, **Important**, **Planned**, your own lists, steps and notes, and your flagged emails show up as tasks.

The difference is where things are stored. Your tasks live in a **private Planner plan** that you set up once at the start. If you want more, switch to **Full** mode and all your other plans show up next to your personal tasks. If you don't, **Simple** mode keeps it to your own to-do list.

It also has a cleaner look, and a short overview of your day at the top of My Day. If you miss the original look, the palette button switches to a **Classic To Do** look.

## Features

| To Do feature | How it maps to Planner |
| --- | --- |
| Lists | Buckets in your private plan |
| My Day | The task's `isOnMyDay` flag. Like To Do, My Day empties overnight. |
| Important (star) | Priority *important* (Planner priorities 0–4 count as important) |
| Planned / due date | `dueDateTime` |
| Steps | Checklist items (Planner allows up to 20 per task) |
| Notes | Task description |
| Tags (`#tag` search) | Planner labels. Name them in Settings; unnamed labels use their colour name. |
| Flagged email | Outlook messages with a flag. Completing the task completes the flag; deleting it unflags the email. |
| My tasks | Tasks assigned to you |
| Import | Settings → *Import my To Do lists* copies every To Do list into a new list, with steps, notes, due dates and importance. Your To Do data is left as it is. |

Other things it does:

- **Simple / Full mode.** Simple shows only your private plan. Full adds every Planner plan you're a member of, under *Plans* in the sidebar, and includes their tasks in My tasks, Important, Planned and All.
- **Overview.** A short summary of the day on My Day with up to three tasks to tackle first and why. It is worked out on your device from your tasks and flagged emails; nothing is sent to an AI service.
- **Suggestions.** Overdue, due-soon and important tasks you can add to My Day in one click.
- **Sorting** by importance, due date, title or creation date. **Looks:** Fresh (default) or Classic To Do, each in light or dark.
- Works on phones, and refreshes when you come back to the tab and at midnight.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

On the first screen you can **try it with demo data**, which lives only in your browser, or **sign in with Microsoft** once an app registration is set up.

### Microsoft Entra app registration (one-time)

Planner only works with work or school accounts, not personal Microsoft accounts.

1. In the [Entra admin center](https://entra.microsoft.com), go to **App registrations → New registration**.
2. Supported account types: *Accounts in this organizational directory only* (or multitenant if you need it).
3. Redirect URI: platform **Single-page application (SPA)**, value `http://localhost:5173/` for development, plus your production URL.
4. Under **API permissions**, add the Microsoft Graph **delegated** permissions `User.Read`, `Tasks.ReadWrite` and `Mail.ReadWrite`. Grant admin consent if your tenant requires it.
5. Copy the **Application (client) ID**, then either put it in `.env.local`:

   ```bash
   cp .env.example .env.local
   # VITE_MSAL_CLIENT_ID=<client id>
   # VITE_MSAL_TENANT=<tenant id or "organizations">
   ```

   or paste it on the sign-in screen, where it is saved in the browser.

### First sign-in

After you sign in you're asked to set up your plan, once:

- **Create my private plan** (recommended) creates a Planner *roster* plan with only you as a member, named "Personal ToDo", with a first list called "To do". Nobody else can see it.
- Or pick an existing private plan, for example on a second device. You can also use a shared group plan, but everyone in the group will see your tasks.

Right after creating the plan, Settings opens so you can import your existing To Do lists.

## Things to know

- **Beta Graph API.** Private (roster) plans and My Day are only available on the Microsoft Graph `beta` endpoint today, so the app uses `beta` for Planner and `v1.0` for everything else. Microsoft can change beta APIs. Your tenant admin can also turn off roster plans, in which case you can still use a group plan.
- Not built yet: reminders (Planner has no per-task reminders), repeating tasks, drag-and-drop reordering, and file attachments.
- The importer doesn't check for duplicates; running it twice creates two copies.
- Edits are saved straight away and shown before the server confirms. If Planner rejects a change, it is rolled back and an error appears at the bottom of the screen.

## Development

```bash
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # production build in dist/
```

Code layout:

- `src/model/`: types, smart-list filtering, search, sorting and the overview. No network code.
- `src/data/graphMapping.ts`: pure conversions between Graph payloads and the app model.
- `src/data/graphBackend.ts`: Planner, Outlook and To Do calls (etags, paging, throttling retries).
- `src/data/localBackend.ts`: the demo backend in `localStorage`.
- `src/components/`: the UI. `src/App.tsx` wires it together.
