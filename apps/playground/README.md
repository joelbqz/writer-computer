# Editor playground

A plain Vite + React page that mounts the desktop app's editor core
(`apps/desktop/src/lib/prosemark-core`) with the app's editor theme, next to a
live view of the markdown source with whitespace made visible. It exists to
QA editor behaviour in a normal browser, where automation and screen
recording are easy, without building the Tauri app.

Everything Tauri-specific (file IO, clipboard, link navigation, images) is
left out; what is here is the CodeMirror setup, the list/heading/formatting
extensions and the theme.

```sh
vp install
vp run playground#dev      # http://localhost:1430 (or `vp dev` inside apps/playground)
```

The editor view is on `window.__view` for scripted checks
(`agent-browser eval "window.__view.state.doc.toString()"`), and the
`EditorView` class on `window.__EditorView`, so a script can read facets
(`view.state.facet(window.__EditorView.decorations)`) while diagnosing
height or decoration churn.
