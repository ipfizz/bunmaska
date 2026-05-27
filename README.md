# Sambar

> Electron's leaner, meaner, much-less-bundled cousin. Built on [Bun](https://bun.sh) and your operating system's own WebKit, because shipping Chromium with every app is how we ended up with 14 GB of RAM disappearing into a chat window.

## What

A **drop-in replacement for Electron** that does not bundle 100 MB of Chromium with every desktop app you build.

Same `app`, `BrowserWindow`, `ipcMain`, `ipcRenderer` API you already know. Different runtime (Bun, not Node). Different renderer (system WebKit, not Chromium). Same vibe. Smaller fan noise.

## Why

Because your laptop fan deserves a break, and your users deserve apps under 25 MB.

## Status

**Pre-alpha. Held together with optimism and `strict: true`.**

If you are using this in production, we admire your courage and decline all responsibility. If you are a billion-dollar company evaluating this for your next desktop app, please come back in a year. If you are reading this in 2027 and we still say "pre-alpha," please file an issue titled "are you OK."

## Platforms

| OS | Status |
|---|---|
| macOS | actively developed |
| Linux | actively developed |
| Windows | deferred until WebKit on Windows is a thing humans can actually use. **We will not ship Chromium.** Yes, we are aware this is a hill. Yes, we are willing to die on it. |

## Install

```sh
bun add sambar
```

You will need [Bun](https://bun.sh). Yes, that is the point.

## Hello world

Coming soon. We are doing strict test-driven development like adults, which means every line of code arrives chaperoned by a failing test, which means progress feels slow until suddenly it doesn't.

## Contributing

If you have somehow found this repo before we invited anyone — hi. Open an issue, lower your expectations, and try not to be a jerk. The full contributing guide will appear once we have a working build to contribute to.

## License

[MIT](./LICENSE). Go wild.
