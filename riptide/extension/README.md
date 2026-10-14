# Riptide browser extension

A Manifest V3 Chrome/Edge extension that hands download links and media to the
Riptide desktop app over its loopback "catch" endpoint.

## Install (unpacked)

1. Start Riptide and make sure **Settings › Browser integration** shows the
   endpoint as listening (the default port is `7777`).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this `extension` folder.

The app's Settings dialog shows the exact folder to pick and has an
**Open extension folder** button that reveals it in Explorer.

## Using it

- **Right-click a link → "Download with Riptide."**
- **Right-click a video, audio clip or image → "Download with Riptide."**
- **Select a URL and right-click → "Send to Riptide."**
- **Toolbar button →** paste or edit a link and press **Send to Riptide**.
- **Catch browser downloads** (off by default) cancels Chrome's own downloads
  and forwards them to Riptide instead. Enable it from the popup.

A ✓ badge on the toolbar icon confirms a link was handed over; a ! badge means
the app could not be reached.

## How it talks to the app

| Direction | Request | Notes |
| --------- | ------- | ----- |
| Status    | `GET http://127.0.0.1:<port>/ping` | `{ ok, app: "riptide", version }` |
| Download  | `POST http://127.0.0.1:<port>/add` | JSON `{ url, referrer?, fileName? }` |

The endpoint binds to `127.0.0.1` only, so it is never exposed to the network.
`host_permissions` covers any port on `127.0.0.1` and `localhost`.

If you change the port in the app, set the same port under **App port** in the
popup.
