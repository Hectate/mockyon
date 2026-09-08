# Mockyon

## About

Mockyon is a pseudo-server for Beyond All Reason clients, specifically using [Tachyon Protocol](https://github.com/beyond-all-reason/tachyon) and [Recoil-Autohost](https://github.com/beyond-all-reason/recoil-autohost). It's primary purpose is to serve as a testing ground for client and autohost connections without requiring a fully developed and configured [Teiserver](https://github.com/beyond-all-reason/teiserver) instance.

While all requests, responses, and events will conform to protocol, most will not be implemented. Those that are implemented may be disabled at will via the web interface.

## Installation

1. Clone the repository.
2. Install dependencies:

    ```sh
    npm install
    ```

## Scripts

| Script                 | Description                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:client` | Builds the Vue SFC pages under `client/` with Vite and outputs static assets to `public/`.                                  |
| `npm run build:server` | Compiles the TypeScript server under `server/` with `tsc` and outputs to `dist/`.                                           |
| `npm run build`        | Runs `build:client` then `build:server` — a full production build.                                                          |
| `npm start`            | Runs `build` first (via the `prestart` hook), then starts the server from `dist/index.js`. Use after any code changes.      |
| `npm run serve`        | Starts the server from `dist/index.js` **without** rebuilding first. Use when `dist/` and `public/` are already up to date. |
| `npm run typecheck`    | Type-checks the server (`tsc --noEmit`) and the client (`vue-tsc --noEmit`) without emitting output.                        |
| `npm run lint`         | Runs ESLint (with caching) across TypeScript, Vue, and JSON files.                                                          |
| `npm run format`       | Formats the repo in place with Prettier.                                                                                    |
| `npm run format:check` | Checks formatting with Prettier without writing changes.                                                                    |
| `npm run checks`       | Runs `typecheck`, `lint`, and `format:check` concurrently — useful before committing.                                       |

## Usage

<!-- TODO: asset/related-file installation steps -->

1. Build and start the server:

    ```sh
    npm start
    ```

    By default the server listens on all interfaces (`0.0.0.0`) on port `8080`. Override with the `HOST` and `PORT` environment variables if needed.

2. Open the static pages in a browser:
    - Client login/auth: `http://<server-host>:8080/login/`
    - Admin control panel: `http://<server-host>:8080/admin/`

3. Connect clients (local or remote) to the mock Tachyon websocket endpoint at `ws://<server-host>:8080/tachyon`.

4. Connect a recoil-autohost instance running on the **same local machine** to `ws://localhost:8080/autohost`. Connections from non-loopback addresses are rejected.

     <!-- TODO: installation/configuration steps for the recoil-autohost itself -->

## Development

Mochyon is build in Typescript with the following libraries:

- Fastify
- Vue
- Tachyon Protocol
- Typebox

## License

This project is licensed under MIT; please see [LICENSE.md](LICENSE.md) for the complete text.
