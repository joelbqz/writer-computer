# Customize the look

Writer Computer's look is set in Preferences: choose **Writer → Preferences…**, press ⌘, or run **Settings** from the command palette (⌘P). A setting you've changed shows a **Reset** button that puts it back.

<!-- Labels, ranges and defaults are from apps/desktop/shared/settings.schema.json. -->

## Light and dark

**Appearance → Schema** picks `system`, `light` or `dark`. With `system`, the default, Writer follows your Mac's appearance and switches the moment macOS does.

To change it without opening Preferences, run **Toggle Dark Mode** from the command palette. It steps through system, light and dark.

## Theme colors

The **Light Theme** and **Dark Theme** sections each have their own five settings, so the two can look quite different:

| Setting     | What it changes                                                            | Light default | Dark default |
| ----------- | -------------------------------------------------------------------------- | ------------- | ------------ |
| Accent      | The highlight color, used across the app and in diagrams                   | `#FF6A00`     | `#FF6A00`    |
| Background  | The window's background color                                              | `#FFFFFF`     | `#111111`    |
| Foreground  | The text color                                                             | `#0D0D0D`     | `#FCFCFC`    |
| Translucent | How much of what's behind the window shows through, from 0 (solid) to 100  | 10            | 20           |
| Contrast    | How strongly borders, cards and hover backgrounds stand out, from 0 to 100 | 20            | 16           |

Pick a color with the macOS color picker or type a hex value. Changes apply as you make them, and Mermaid diagrams recolor with the theme ([Mermaid diagrams](/docs/mermaid/)).

## Fonts

**Typography** has three fonts, shared by both themes:

- **UI font**, for the app around your notes: sidebar, tabs, status bar. Default: SF Pro.
- **Editor font**, for the text of your notes. Default: SF Pro.
- **Code font**, for code blocks and inline code. Default: SF Mono.

Each lists the fonts installed on your Mac. A font you install while Writer is open appears in the list after you restart Writer.

## Text size, width and spacing

In the **Editor** section:

| Setting       | Range               | Default |
| ------------- | ------------------- | ------- |
| Font Size     | any size, in pixels | 16      |
| Zoom          | 50 to 300%          | 100%    |
| Line Height   | any multiplier      | 1.875   |
| Content Width | 480 to 1600 pixels  | 734     |

**Zoom** scales the text of your notes on top of Font Size; the sidebar, tabs and status bar keep their size. ⌘= zooms in, ⌘- zooms out and ⌘0 goes back to 100%, stepping through 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250 and 300%. The command palette has **Zoom In**, **Zoom Out** and **Reset Zoom** too. Zoom applies to every window.

**Content Width** is the widest the column of text gets; on a narrower window it fits the window.

## Sidebar and status bar

- **Appearance → Sidebar File Label** shows each note's title or its filename in the sidebar. See [The sidebar](/docs/sidebar/) for the rest of its settings.
- **Status Bar** turns the **Words**, **Characters** and **Paragraphs** counts on or off. You can also right-click the status bar to choose.
