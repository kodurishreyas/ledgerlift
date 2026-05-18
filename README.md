# LedgerLift

A polished personal finance tracker for anyone who wants a clearer, more interactive view of their money. Created by Koduri Shreyas.

Open `index.html` in a browser to run the app locally, or use the public site at `https://ledgerlift.netlify.app/`. It works locally by default and can sync across devices when Supabase is configured.

## Features

- Starts clean with no fake personal financial data.
- User settings for name and any valid 3-letter currency code.
- Optional Supabase magic-link sign-in for cloud sync across devices.
- Interactive dashboard with runway forecasting, health score, savings rate, monthly projection, and smart insights.
- Colorful What-If Lab that shows how small daily cuts can extend money survival time.
- Intelligence Center for monthly summaries, predictive weekly spending, unusual-spend alerts, recurring expense detection, and category trends.
- Fast transaction manager with quick amount buttons, smart defaults, add, edit, delete, search, filters, categories, and CSV export.
- Engagement features including a daily mission board, unlockable badges, streaks, XP levels, daily challenges, and reward-style feedback.
- Shareable Survival Snapshot built around the core question: how long will your money survive?
- Full JSON backup and restore for moving data between browsers or devices.
- Budget cockpit with editable category limits and usage progress.
- Goal tracker with savings targets and live progress sliders.
- Canvas charts for weekly cashflow and category spending.

## Cloud Sync Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run the SQL from `supabase-schema.sql`.
3. In `supabase-config.js`, add your project URL and anon public key:

```js
window.LEDGERLIFT_SUPABASE = {
  url: "https://your-project.supabase.co",
  anonKey: "your-anon-public-key"
};
```

4. Deploy the folder publicly.
5. In Supabase Authentication settings, add your deployed site URL to the allowed redirect URLs.

Each signed-in user gets their own private synced finance data row. If Supabase is not configured, LedgerLift still works in local-only mode.
