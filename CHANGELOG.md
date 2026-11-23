# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.1] - 2026-11-23

### Changed

- The app icon is now the ensō, matching the mark inside the app.
- Releases ship one installer per platform (macOS `.dmg`, Windows `.exe`, Linux AppImage) and no longer upload the `.zip`, `.deb` or detached `.sig` files. The in-app updater is unaffected.

## [0.4.0] - 2026-11-19

### Added

- Customizable dashboard: drag cards to rearrange, hide and restore them, save named layouts; responsive layout with a mobile navigation drawer
- Privacy mode that masks monetary values across the app while keeping counts, ratios and chart shapes
- Markdown notes with formatting toolbar, reusable templates, exact trade links, and image/PDF attachments on trades, days and notebook notes
- Advanced report filters, comparison groups, a two-way cross-analysis matrix, and additional breakdowns (asset class, month, entry/exit hour, position size, planned/realized R)
- Playbook rule checklists per trade with adherence rates and followed-vs-broken performance
- Routines with weekday schedules and completion history; a missed-opportunity log kept out of trading metrics
- PDF and PNG review exports; JSON export now includes folders, templates, rule assessments, routines and defaults
- Configurable breakeven tolerance, default fees, and default stop/target distances per account and symbol
- Importers: MetaTrader 5 deal reports and TradingView strategy exports
- Importers: XTB xStation `.xlsx` account workbooks, with closed positions, open holdings and later closes of those holdings (contributed by @zahei, [#42](https://github.com/LuxAlgo/trade-journal/issues/42))
- Importers: Hyperliquid trade history CSV exports, with HIP-3 markets under the same symbols as broker sync. Imported into a synced Hyperliquid account, the file adds only the history older than broker sync reaches ([#53](https://github.com/LuxAlgo/trade-journal/issues/53))
- Broker sync: Binance USDⓈ-M futures ([#30](https://github.com/LuxAlgo/trade-journal/issues/30)). A Binance connection now also reads futures balances, positions and the last three months of fills, as futures trades. Fees paid in BNB are converted at that hour's BNB/USDT price. In hedge mode, a long and a short held at once on one symbol stay separate trades. A fill that closes a position opened before Binance's history is skipped, or kept only for the part the history covers, and reported. Spot fills are not read yet, and a quarterly contract held to delivery stays open, because delivery leaves no fill.
- Realized R accounts for contract multipliers and scaled entries
- Optional historical market data connections (London Strategic Edge, Alpaca, OANDA, Binance, Coinbase, or your own candle CSV) with estimated MAE/MFE and candle replay on closed trades
- Prop firm tracker: evaluation and reset costs, refunds, payout requests, receipts, cash ROI, renewals, attachments, CSV import and export
- Calendar insights, rolling performance trends, and a trade explorer scatter in Reports
- Light mode, a collapsible sidebar, and friendlier AI setup and error notices
- OpenAI-compatible AI provider for local or third-party models (Ollama, LM Studio, OpenRouter and others), and documented `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` gateway support (proposed by @fiandev in [#19](https://github.com/LuxAlgo/trade-journal/pull/19))

### Changed

- Releases are built by `.github/workflows/release.yml` from `v<semver>` tags (not `electron-v*`), on the native macOS arm64/x64, Windows x64 and Linux x64 matrix, and attached to a draft GitHub Release. Pushing to the default branch never releases.
- In-app updates use `tauri-plugin-updater` with a signed `latest.json` on GitHub Releases. Updater artifacts exist only for builds signed with the owner's `TAURI_SIGNING_PRIVATE_KEY`; builds without it report "updates unavailable".
- The About page shows the Tauri runtime version; web runtime detection no longer has an Electron branch

- Data loads render as React transitions, so a tab change paints progressively instead of freezing while every card and chart mounts at once
- The development server runs on Turbopack, roughly halving first-visit compile times when switching tabs in `pnpm dev`
- Removed the gradient accent bar and gradient Edge Score number; the active nav item and the score now use the solid brand blue
- Trade pages chart recorded fills only and never contact a data provider on open; market candles load only from a data source you choose
- Gross profit and gross loss now include every closed trade, so trades labeled breakeven by a tolerance still count; the Edge Score version is bumped to 2
- Reports and dashboard aggregation reuse daily totals and equity for large histories; charts load only the components they use
- Executions are validated and written together with their recomputed trades in one transaction
- Node 22 or newer is required (already required by the AI dependencies)

### Removed

- **Electron is gone: Tauri is now the only desktop app.** The Electron shell, its packaging and update tooling (`electron`, `electron-builder`, `electron-updater`, Sparkle) and the `electron-v*` release workflow are removed. The previous "Sumi Rust" Tauri preview is now simply **Sumi**: product name `Sumi`, binary `sumi`, bundle identifier `local.sumi.journal`. It uses the operating system WebView instead of bundled Chromium.
- **Moving from the Electron app (0.3.x):** the old app will not update itself into the Tauri app. Install the new build once (macOS `Sumi.app`, Windows setup `.exe`, Linux AppImage), after quitting the old app. Your journal is found automatically: the Tauri app uses the same data folder (`~/Library/Application Support/Sumi`, `%APPDATA%\Sumi`, `$XDG_CONFIG_HOME/Sumi` or `~/.config/Sumi`) and the same `journal.db`, `.secret` and `preferences.json`, and nothing is moved or deleted. The old `electron/` browser-profile folder inside it is no longer used and can be deleted.
- Root scripts `desktop:package` and the Electron `desktop:*` implementations are removed; `desktop:build`, `desktop:open` and `desktop:check` are now aliases of `tauri:build`, `tauri:open` and `tauri:check`.

### Fixed

- Webull sync imports trade history ([#28](https://github.com/LuxAlgo/trade-journal/issues/28), proposed by @anthony-som in [#29](https://github.com/LuxAlgo/trade-journal/pull/29)). A fill that closes a position opened before Webull's roughly one year of history is skipped, or kept only for the part the history covers, and reported, instead of showing a position that never existed. An option that expired while held closes at 0 at the 4pm New York expiry, and Webull's option contract sizes are saved as multipliers unless you set one. Later syncs only ask for orders from 30 days before the previous sync onward.
- Broker sync and IBKR Flex XML uploads keep every fill when an order fills in identical pieces (same symbol, side, size, price and time). Previously the later pieces were dropped as duplicates, so volume, fees and P&L were under-counted and a closed position could stay open, as with a closed Hyperliquid short ([#50](https://github.com/LuxAlgo/trade-journal/issues/50), [#52](https://github.com/LuxAlgo/trade-journal/issues/52)). Fills already stored keep their identity; the next sync adds the missing pieces that are still in the broker's history. IBKR sync now skips order, closed-lot and summary rows in the Flex statement, as file uploads already did, so they are no longer stored as extra fills.
- IBKR Flex Query XML statements can be uploaded on Import → File upload, and their times are read in the statement timezone, as broker sync does. Previously an XML upload was not recognized and could not be imported, so the Default import timezone never applied ([#16](https://github.com/LuxAlgo/trade-journal/issues/16)).
- Password protection now verifies the session signature on every API route. Previously, when `JOURNAL_PASSWORD` was set, any request carrying a cookie of the right name was accepted, so a forged cookie could read the journal.

## [0.3.8] - 2026-11-19

This is the final Electron release. Sumi 0.4 is a new, Tauri-based desktop app, and Electron builds receive no further updates.

### Added

- A "Sumi has a new desktop app" notice inside the Electron app: a dismissible banner at the top of the window ("Not now" hides it until the next launch) and a permanent entry under Settings → About. Both link to the [Sumi 0.4 release](https://github.com/xolah88457/Sumi/releases/tag/v0.4.0). Quit this app before opening the new one; your journal data folder is shared, so the new app picks your journal up automatically.

## [0.1.0] - 2026-09-03

Initial public release.

### Added

- Round-trip engine: flat-to-flat position cycles from raw fills, FIFO/LIFO/weighted-average matching, partial fills, position flips, futures multipliers, rebuild-stable annotation keys (`@luxalgo/journal-core`)
- Analytics: P&L, win and day-win rates, profit factor, expectancy, R multiples, streaks, drawdown and recovery, profit concentration, calendar and bucket aggregations, the open Edge Score
- Statement importers with auto-detection for 12 formats, one-click TradeZella/Tradervue migration with exact P&L reconciliation, and a column mapper for anything else (`@luxalgo/journal-importers`)
- Web app: dashboard, P&L calendar, daily journal with voice dictation, trades table, trade pages with charting, notebook, playbooks, reports
- Broker sync via `@luxalgo/broker-sdk` with credentials encrypted at rest
- Optional AI reflection (bring your own Anthropic API key): session recaps, trade critiques, ask-your-journal
- Docker deployment, optional password auth, full JSON/CSV export
