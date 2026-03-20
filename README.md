# Beget VPS Manager

Local-first Svelte 5 web app for authenticating against Beget and managing VPS CPU/RAM changes from a single screen.

## Live

https://beget-vps-manager.dokploy.me/

## OpenAPI

- [Beget Auth API docs](https://developer.beget.com/#auth-/v1/auth)
- [Beget Cloud VPS API docs](https://developer.beget.com/#overview-/v1/vps)

Local OpenAPI snapshots for development can be kept in `openapi/`, but they are intentionally not committed to the repository.

## Stack

- Bun
- SvelteKit 2
- Svelte 5 runes
- Static output via `@sveltejs/adapter-static`
- Direct browser requests to the Beget API
- Local UI persistence for filters and dashboard state preferences
- Local Beget token storage in `localStorage` or `sessionStorage`

## Commands

```bash
bun run dev
bun run check
bun run build
bun run start
```

`bun run build` writes the static site to `build/`.

## Environment

Optional override:

```bash
PUBLIC_BEGET_API_BASE_URL=https://api.beget.com
PUBLIC_BEGET_AUTH_X_TOKEN=y0wcxs9n91mxf92
```

## App shape

- Auth is stored only in this browser, not on the app server.
- The UI does not require a separate backend database.
- The dashboard calls the Beget API directly from the browser.
- The app fetches VPS data, available configuration groups, and configurator limits.
- Each VPS card supports live CPU/RAM recalculation and submitting a configuration change.
