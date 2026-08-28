import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SurfaceCard } from "@/components/surface-card";
import { useSetSetting } from "@/hooks/use-settings";
import * as tauri from "@/lib/tauri";

const DOCS_URL = "https://github.com/joelbqz/writer-computer/blob/master/docs/telemetry.md";

/** What the dialog claims we collect. Kept as data next to the copy so it stays
 *  in step with the event table in `docs/telemetry.md` and the property set in
 *  `src-tauri/src/telemetry.rs`. */
const COLLECTED = [
  "A random ID for this install, so you count as one person",
  "When the app opens, and when a workspace is opened",
  "That a file or folder was created — not which one",
  "App version, OS, and processor architecture",
];

const NOT_COLLECTED = [
  "Anything you write. No document text, ever",
  "File names, folder names, or paths",
  "Search queries or workspace contents",
];

/** First-run telemetry consent. Shown at most once, only in the main window,
 *  and only in a build configured with a PostHog key — the backend owns all
 *  three conditions, so this component just asks it.
 *
 *  Both buttons and a dismissal mark the prompt answered; only "Share usage
 *  data" writes `telemetry.enabled`. The writes go through the normal settings
 *  store so the Preferences panel and the running client stay in sync with one
 *  write path. */
export function TelemetryConsentDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setSetting = useSetSetting();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void tauri.telemetryShouldPrompt().then((shouldPrompt) => {
      if (!cancelled && shouldPrompt) setIsOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the card itself rather than a button: the Escape handler below needs
  // focus inside the dialog, but autofocusing "Share usage data" would both
  // paint a system focus ring on it and make a stray Enter opt the user in.
  useEffect(() => {
    if (isOpen) cardRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  // `isSubmitting` guards against a double answer (Escape landing between the
  // click and the awaited writes) resolving the prompt twice.
  async function resolvePrompt(enabled: boolean) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (enabled) {
        const trimmed = email.trim();
        // Email first: writing `enabled` last means the very first event the
        // client sends already carries the address, instead of arriving
        // anonymous and being back-filled on the second event.
        if (trimmed) await setSetting("telemetry.email", trimmed);
        await setSetting("telemetry.enabled", true);
      }
      await tauri.telemetryMarkPrompted();
    } finally {
      setIsOpen(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void resolvePrompt(false);
      }}
    >
      <SurfaceCard
        ref={cardRef}
        tabIndex={-1}
        className="surface-card-opaque relative w-full max-w-[440px] p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-consent-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            void resolvePrompt(false);
          }
        }}
      >
        <h2
          id="telemetry-consent-title"
          className="text-[15px] font-semibold text-[var(--text-primary)]"
        >
          Help shape Writer?
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Writer can send a small amount of anonymous usage data so its maintainer knows how many
          people use it and which features are worth the effort. It is off unless you turn it on
          here, and you can change your mind any time in Preferences.
        </p>

        <div className="mt-5 grid gap-4">
          <section>
            <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">What is sent</h3>
            <ul className="mt-1.5 grid gap-1">
              {COLLECTED.map((item) => (
                <li key={item} className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                  <span aria-hidden="true" className="mr-2 text-[var(--text-icon-muted)]">
                    &middot;
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">
              What is never sent
            </h3>
            <ul className="mt-1.5 grid gap-1">
              {NOT_COLLECTED.map((item) => (
                <li key={item} className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                  <span aria-hidden="true" className="mr-2 text-[var(--text-icon-muted)]">
                    &middot;
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <label className="mt-5 block">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">
            Email <span className="font-normal text-[var(--text-muted)]">(optional)</span>
          </span>
          <input
            type="email"
            value={email}
            placeholder="you@example.com"
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void resolvePrompt(true);
            }}
            className="mt-1.5 h-9 w-full rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
          />
          <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--text-muted)]">
            Leave this blank to stay anonymous. Fill it in and the maintainer can reach you about
            the features you actually use.
          </span>
        </label>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void openUrl(DOCS_URL)}
            className="text-[12px] text-[var(--text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--text-secondary)]"
          >
            Read what this collects
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void resolvePrompt(false)}
              className="rounded-lg border border-[var(--line-subtle)] px-4 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-subtle)] disabled:opacity-60"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void resolvePrompt(true)}
              className="rounded-lg bg-[var(--text-primary)] px-4 py-2 text-[13px] font-medium text-[var(--surface-primary)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              Share usage data
            </button>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
