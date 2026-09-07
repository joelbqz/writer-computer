import { useEffect, useRef, useState } from "react";
import { SurfaceCard } from "@/components/surface-card";
import { useSetSetting } from "@/hooks/use-settings";
import * as tauri from "@/lib/tauri";

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
  "Your location — the request is explicitly marked not to derive one",
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong saving your choice.";
}

/** First-run telemetry consent. Shown at most once, only in the main window,
 *  and only in a build configured with a PostHog key — the backend owns all
 *  three conditions, so this component just asks it.
 *
 *  Both buttons and a dismissal mark the prompt answered, then write
 *  `telemetry.enabled` explicitly — `true` or `false` — through the normal
 *  settings store, so Preferences and the running client stay in sync with
 *  one write path. The mark comes first because the backend treats the
 *  setting as consent only once this install's prompt record exists. */
export function TelemetryConsentDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSetting = useSetSetting();
  const cardRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const resolveRef = useRef<(enabled: boolean) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    void tauri.telemetryShouldPrompt().then((shouldPrompt) => {
      if (!cancelled && shouldPrompt) setIsOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the card itself rather than a button: autofocusing "Share usage
  // data" would both paint a system focus ring on it and make a stray Enter
  // opt the user in.
  useEffect(() => {
    if (isOpen) cardRef.current?.focus();
  }, [isOpen]);

  // Keyboard modality. The backdrop only blocks the pointer; without this,
  // Tab walks into the editor behind the card and Cmd+P opens the palette on
  // top of it. Registered at the capture phase on `document` so it runs
  // before the window-level shortcut handler in `useKeyboardShortcuts`.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        resolveRef.current(false);
        return;
      }

      if (event.key === "Tab") {
        const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const inside = active instanceof Node && card.contains(active);
        if (!inside || (event.shiftKey && active === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      // Modifier shortcuts belong to the app underneath, not to a modal that
      // is waiting for a decision. Stopping propagation leaves native editing
      // defaults (paste into the email field) intact.
      if (event.metaKey || event.ctrlKey) event.stopPropagation();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen]);

  // `isSubmitting` guards against a double answer (Escape landing between the
  // click and the awaited writes) resolving the prompt twice.
  async function resolvePrompt(enabled: boolean) {
    if (isSubmitting) return;
    const trimmed = email.trim();
    if (enabled && trimmed && emailRef.current && !emailRef.current.checkValidity()) {
      setError("That doesn't look like an email address. Fix it or leave it blank.");
      emailRef.current.focus();
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await tauri.telemetryMarkPrompted();
      if (enabled) {
        // Email first: writing `enabled` last means the very first event the
        // client sends already carries the address, instead of arriving
        // anonymous and being back-filled on the second event.
        if (trimmed) await setSetting("telemetry.email", trimmed);
        await setSetting("telemetry.enabled", true);
      } else {
        // Explicit rather than "no write": a config copied from elsewhere may
        // already say `true`, and "Not now" has to mean off.
        await setSetting("telemetry.enabled", false);
      }
      setIsOpen(false);
    } catch (cause) {
      // The choice was not fully recorded; keep asking rather than guessing.
      setError(describeError(cause));
    } finally {
      setIsSubmitting(false);
    }
  }
  resolveRef.current = (enabled) => void resolvePrompt(enabled);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6 py-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void resolvePrompt(false);
      }}
    >
      <SurfaceCard
        ref={cardRef}
        tabIndex={-1}
        className="surface-card-opaque relative flex max-h-[calc(100vh-3rem)] w-full max-w-[440px] flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-consent-title"
        aria-describedby="telemetry-consent-description"
      >
        {/* The card stays fixed-size and the copy scrolls inside it, so the
            opaque `::before` layer always covers what is visible and the
            buttons stay reachable at the 500px minimum window height. */}
        <div className="min-h-0 overflow-y-auto p-6">
          <h2
            id="telemetry-consent-title"
            className="text-[15px] font-semibold text-[var(--text-primary)]"
          >
            Help shape Writer?
          </h2>
          <p
            id="telemetry-consent-description"
            className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]"
          >
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
              ref={emailRef}
              type="email"
              value={email}
              placeholder="you@example.com"
              autoComplete="email"
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              className="mt-1.5 h-9 w-full rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
            />
            <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--text-muted)]">
              Leave this blank to stay anonymous. Fill it in and the maintainer can reach you about
              the features you actually use.
            </span>
          </label>

          {error && (
            <p role="alert" className="mt-4 text-[12px] leading-relaxed text-[var(--text-error)]">
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-2">
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
