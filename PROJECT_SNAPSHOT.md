# Live Preview Project Snapshot

## What This Project Is

This is a very small, dependency-free Node.js app that serves a single-page browser UI for live video preview. The page can show a webcam, a screen share, or a window share, and it includes quick controls for flipping the image and entering fullscreen.

## File Map

- [server.js](server.js) is the HTTP server.
- [index.html](index.html) is the full client app, including markup, styles, and behavior.
- [.git](.git) is version control metadata.
- [.qodo](.qodo) is workspace tooling/configuration metadata.

## Runtime Model

There is no build step, bundler, or framework. The server listens on port 8080 and serves files directly from the project folder. The browser loads [index.html](index.html), which owns all UI state and media handling in the page script.

## How The Preview Flow Works

### 1. The page opens with a source picker

When [index.html](index.html) loads, the user sees a full-screen overlay asking them to choose a video source:

- Camera (webcam)
- Screen share
- Window share

At this point the actual `<video>` preview is present in the page, but no stream is attached yet.

### 2. A media source is requested from the browser

Each source button calls a different async handler:

- `startCamera()` calls `navigator.mediaDevices.getUserMedia(...)`
- `startScreen()` calls `navigator.mediaDevices.getDisplayMedia(...)`
- `startWindow()` reuses `startScreen()` and relies on the browser picker to let the user choose a window

The requested stream is stored in `currentStream`, then assigned to `preview.srcObject` so the `<video>` element renders it.

### 3. The UI switches from picker mode to preview mode

After a stream starts successfully:

- the source selector overlay is hidden
- the toolbar becomes active
- the camera dropdown is shown only for webcam mode

For camera mode, the app also enumerates available video inputs with `enumerateDevices()` and fills the camera selector so the user can switch devices.

### 4. The user can transform the preview

The preview supports two independent transforms:

- horizontal flip toggles `flipped`, which applies `scaleX(-1)`
- vertical flip toggles `flipped-v`, which applies `scaleY(-1)`

The app updates the button state and a small status label whenever either transform changes.

### 5. Fullscreen mode changes the chrome behavior

Pressing the fullscreen button calls `requestFullscreen()` on the document element. While fullscreen is active:

- the toolbar auto-hides until the mouse moves near the top edge
- the toolbar briefly appears on hover or movement
- leaving fullscreen restores the normal toolbar layout

### 6. The user can return to source selection

The `changeSource()` action stops the current tracks, clears the video element, and brings back the source picker. When a screen-share track ends naturally, the app also returns to source selection automatically.

## Server Behavior

The server in [server.js](server.js) is intentionally minimal:

- it maps `/` to `/index.html`
- it normalizes paths and blocks path traversal attempts
- it reads files from disk and serves them with a small MIME-type map
- it listens on `0.0.0.0:8080` so the app is reachable on the LAN
- it prints both localhost and detected IPv4 LAN URLs on startup

## Keyboard Shortcuts

- `H` toggles horizontal flip
- `V` toggles vertical flip
- `F` toggles fullscreen
- `Esc` exits back to source selection when a stream is active

## Notable Characteristics

- Single-file frontend, no framework
- No package.json or dependency install step
- Browser-native media APIs only
- Designed for quick local or LAN use rather than deployment to a larger platform

## Practical Limitations

- The project only serves static files; it does not provide an API or persistence layer.
- Camera switching works only after the browser has permission to expose device labels.
- The app depends on browser support for fullscreen and media capture APIs.

## How To Run

1. Start the server with Node.js.
2. Open `http://localhost:8080` in a browser.
3. Choose a media source and use the toolbar controls as needed.

## Short Summary

This project is a tiny live-preview utility: one Node server, one self-contained HTML client, and a media flow built around browser capture APIs. The main user path is choose a source, attach the stream to the preview video, optionally flip or fullscreen it, and switch back when done.