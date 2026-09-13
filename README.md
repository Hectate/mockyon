# Mockyon

## About

Mockyon is a pseudo-server for Beyond All Reason clients, specifically using [Tachyon Protocol](https://github.com/beyond-all-reason/tachyon) and [Recoil-Autohost](https://github.com/beyond-all-reason/recoil-autohost). It's primary purpose is to serve as a testing ground for client and autohost connections without requiring a fully developed and configured [Teiserver](https://github.com/beyond-all-reason/teiserver) instance.

While all requests, responses, and events will conform to protocol, most will not be implemented. Note that the server will auto-succeed for things like `messaging/subscribeReceived` for a smooth experience, even though messages will not be sent or received.

A pinned copy of [Recoil-Autohost](https://github.com/beyond-all-reason/recoil-autohost) is vendored under `vendor/recoil-autohost/` (see `vendor/recoil-autohost/VENDORED_COMMIT.md` for the exact commit) and is licensed separately under Apache-2.0 — see `vendor/recoil-autohost/LICENSE`/`AUTHORS`. It's wired up as an npm workspace so `npm install` at the repo root installs its dependencies too; Mockyon can start and stop it directly from the admin panel.

### **Warning**

Use at your own risk. This is intentionally not a production-ready server.

1. The server is deliberately intended to be insecure for convenience, with an exposed Admin page.
2. Client auth is handed out for simply having a valid server-wide password present, which is the same for all clients.
3. A client attempting to auth/connect with the same user name as an existing one will disconnect the prior.
4. While designed by a human, the majority of the code was produced by AI. Assume that errors exist.

## Installation

1. Clone the repository.
2. Install dependencies:

    ```sh
    npm install
    ```

## Scripts

| Script                 | Description                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build:client` | Builds the Vue SFC pages under `src/client/` with Vite and outputs static assets to `build/client/`.                           |
| `npm run build:server` | Compiles the TypeScript server under `src/server/` with `tsc` and outputs to `build/server/`.                                  |
| `npm run build`        | Runs `build:client` then `build:server` — a full production build.                                                             |
| `npm start`            | Runs `build` first (via the `prestart` hook), then starts the server from `build/server/index.js`. Use after any code changes. |
| `npm run serve`        | Starts the server from `build/server/index.js` **without** rebuilding first. Use when `build/` is already up to date.          |
| `npm run typecheck`    | Type-checks the server (`tsc --noEmit`) and the client (`vue-tsc --noEmit`) without emitting output.                           |
| `npm run lint`         | Runs ESLint (with caching) across TypeScript, Vue, and JSON files.                                                             |
| `npm run format`       | Formats the repo in place with Prettier.                                                                                       |
| `npm run format:check` | Checks formatting with Prettier without writing changes.                                                                       |
| `npm run checks`       | Runs `typecheck`, `lint`, and `format:check` concurrently — useful before committing.                                          |

## Usage

<!-- TODO: asset/related-file installation steps -->

1. Build and start the server:

    ```sh
    npm start
    ```

    By default the server listens on all interfaces (`0.0.0.0`) on port `8080`. Override with the `HOST` and `PORT` environment variables if needed.

    To set the initial server-wide password, set `TACHYON_PASSWORD` before starting the server. For example, in PowerShell:

    ```powershell
    $env:TACHYON_PASSWORD = "your-password"
    npm start
    ```

    On macOS or Linux, use `TACHYON_PASSWORD=your-password npm start`. If it is not set, Mockyon generates a random 16-character password and prints it in the server launch logs.

2. Open the static pages in a browser:
    - Client login/auth: `http://<server-host>:8080/login/`
    - Admin control panel: `http://<server-host>:8080/admin/`

3. Connect clients (local or remote) to the mock Tachyon websocket endpoint at `ws://<server-host>:8080/tachyon`.

4. The vendored recoil-autohost isn't started automatically — use the **Start autohost** button on the admin panel to spawn it as a child process. It authenticates with a generated OAuth2 client-credentials pair and connects back to the same `/tachyon` endpoint as regular clients. Only one autohost runs at a time; use **Stop autohost** to shut it down. Note that autohost has been modified to work with Windows executables, and to permit the path to the `engines` and `instances` folder to be configurable.

## License

This project is licensed under MIT; please see [LICENSE.md](LICENSE.md) for the complete text.
