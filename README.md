<img width="426" height="240" alt="financeApp" src="https://github.com/user-attachments/assets/aec2417b-231f-48fb-a6a8-b047e9bd9737" />

# Investment & Budget Planner
A small app that runs entirely in your browser (locally), no backend, no build step, no accounts.

Made this tool for my personal use and added every feature I wanted from a quick budgetting/projection app. Here is what I shipped:

## Features
- **Investment projection**: compound growth modeling with optional dividend
  reinvestment (DRIP), custom contribution phases, an inflation-adjusted
  ("today's dollars") view, and a year-by-year breakdown table (with CSV
  export) and chart. Add any ETF/stock, backed by a built-in table of
  long-run historical returns or your own custom estimate.

- **Budget tracker**: Inputs income, expenses, savings (included post-expense
  percent calculator). Outputs a clean and customizable colored breakdown
  pie chart.

- Freeform, draggable/resizable widgets (With grid snapping to allow for a clean layout).
- 15 built-in themes.
- One-click JSON backup/restore of everything, so you're not only ever one
  cleared cache away from losing your data. Also lets you switch devices and pick up where you left off. 

## Privacy
All data is stored in your browser's `localStorage`, meaning that nothing is
ever sent anywhere, this little tool runs completely on your machine, in your
browser. Clearing your browser data clears the tool's data (export a backup
first from the "Backup" menu if you want to keep it).

## Usage
Download `index.html`, `style.css`, and `app.js` (keep them together in the
same folder) and open `index.html`.

To host it locally instead (e.g. to test on another device on your network),
from that folder run:
```
npx serve .
```

It's fully static, so any static host works too!

>Note: Changing the `<title>` line near the top of `index.html` changes the
>name of the website in your browser tab.
