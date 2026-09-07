import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { useSetSetting } from "@/hooks/use-settings";
import * as tauri from "@/lib/tauri";

/** What the dialog claims we collect. Kept as data next to the copy so it stays
 *  in step with the event table in `docs/telemetry.md` and the property set in
 *  `src-tauri/src/telemetry.rs`. */
const COLLECTED = [
  "A random ID for this install",
  "When the app or a workspace opens",
  "That a file or folder was created",
  "App version, OS, and architecture",
];

const NOT_COLLECTED = [
  "Anything you write, ever",
  "File names, folder names, or paths",
  "Search queries or workspace contents",
  "Your location",
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong saving your choice.";
}

function DisclosureList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <section>
      <h3 className="text-[12px] font-medium text-[var(--text-secondary)]">{title}</h3>
      <ul className="mt-1 grid gap-1">
        {items.map((item) => (
          <li
            key={item}
            className="whitespace-nowrap text-[12px] leading-relaxed text-[var(--text-muted)]"
          >
            <span aria-hidden="true" className="mr-2 text-[var(--text-icon-muted)]">
              &middot;
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The popover lives inside the dialog's scroll container, which would clip an
 *  absolutely positioned layer. Fixed positioning escapes that clip — the
 *  backdrop's `backdrop-filter` makes it the containing block, and it spans the
 *  viewport — so the position is measured from the trigger each time it opens
 *  rather than expressed in CSS. */
interface PopoverPlacement {
  left: number;
  top: number;
  transform?: string;
}

/** The popover hugs its longest line; this is only the clamp used to keep it
 *  inside the window. */
const POPOVER_MAX_WIDTH = 360;
const POPOVER_GAP = 8;

function placeAbove(trigger: DOMRect): PopoverPlacement {
  const left = Math.max(
    POPOVER_GAP,
    Math.min(trigger.left, window.innerWidth - POPOVER_MAX_WIDTH - POPOVER_GAP),
  );
  // Flip below when the space above cannot hold the list, so the popover is
  // never the thing that gets cut off.
  const roomAbove = trigger.top - POPOVER_GAP;
  if (roomAbove < 200) return { left, top: trigger.bottom + POPOVER_GAP };
  return { left, top: trigger.top - POPOVER_GAP, transform: "translateY(-100%)" };
}

/** First-run telemetry consent. Shown at most once, only in the main window,
 *  and only in a build configured with a PostHog key — the backend owns all
 *  three conditions, so this component just asks it.
 *
 *  The email is what **Subscribe** is for and is required; the usage switch is
 *  an extra that can be left off. Declining takes neither.
 *
 *  Both buttons and Escape mark the prompt answered, then write
 *  `telemetry.enabled` explicitly — `true` or `false` — through the normal
 *  settings store, so Preferences and the running client stay in sync with
 *  one write path. The mark comes first because the backend treats the
 *  setting as consent only once this install's prompt record exists. */
export function TelemetryConsentDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [shareUsage, setShareUsage] = useState(true);
  const [detailsAt, setDetailsAt] = useState<PopoverPlacement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSetting = useSetSetting();
  const cardRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const resolveRef = useRef<(accepted: boolean) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    void tauri.telemetryShouldPrompt().then((shouldPrompt) => {
      if (!cancelled && shouldPrompt) setIsOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  async function resolvePrompt(accepted: boolean) {
    if (isSubmitting) return;
    const trimmed = email.trim();
    if (accepted && (!trimmed || !emailRef.current?.checkValidity())) {
      rejectEmail();
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await tauri.telemetryMarkPrompted();
      if (accepted) {
        // Email first: writing `enabled` last means the very first usage event
        // already carries the address, instead of arriving anonymous and being
        // back-filled on the second event. With the box unchecked this write is
        // the only thing that sends anything at all — the backend treats an
        // email change as its own consent.
        await setSetting("telemetry.email", trimmed);
        await setSetting("telemetry.enabled", shareUsage);
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
  resolveRef.current = (accepted) => void resolvePrompt(accepted);

  /** Missing or malformed address: shake the field instead of printing a
   *  sentence. The failure is about the one input the user is looking at, and a
   *  line of red text would push the buttons down mid-decision. Restarting the
   *  animation needs the class off, a reflow, then on again, which is a DOM
   *  operation rather than a render. */
  function rejectEmail() {
    const input = emailRef.current;
    if (!input) return;
    input.classList.remove("input-shake");
    void input.offsetWidth;
    input.classList.add("input-shake");
    input.addEventListener("animationend", () => input.classList.remove("input-shake"), {
      once: true,
    });
    input.focus();
  }

  function openDetails() {
    const trigger = triggerRef.current;
    if (trigger) setDetailsAt(placeAbove(trigger.getBoundingClientRect()));
  }

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-6 py-6"
      role="presentation"
    >
      {/* No card: the backdrop is the surface. The dialog is the only thing on
          screen while it is open, so a panel outline would only add a second
          edge inside the window's own. The copy still scrolls within a fixed
          height so the buttons stay reachable at the 500px minimum. */}
      <div
        ref={cardRef}
        className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-[440px] flex-col outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-consent-title"
        aria-describedby="telemetry-consent-description"
      >
        {/* `overflow-y: auto` also clips horizontally, which cut the email field
            off mid-shake. The padding gives the animation room to move into and
            the negative margin gives it back, so the copy sits where it did. */}
        <div className="-mx-2 min-h-0 overflow-y-auto px-2">
          <h2
            id="telemetry-consent-title"
            className="text-[15px] font-semibold text-[var(--text-primary)]"
          >
            Stay in touch?
          </h2>
          <p
            id="telemetry-consent-description"
            className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]"
          >
            Writer is made by one person. Leave your email for release news, and share light usage
            data. Both change in Preferences.
          </p>

          <label className="mt-5 block">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">Email</span>
            <input
              ref={emailRef}
              type="email"
              required
              value={email}
              placeholder="you@example.com"
              autoComplete="email"
              onChange={(event) => {
                setEmail(event.target.value);
                // Also clears the rejected state when reduced motion left it
                // standing, since there is no animation end to clear it there.
                event.currentTarget.classList.remove("input-shake");
                if (error) setError(null);
              }}
              className="mt-1.5 h-9 w-full rounded-lg border border-transparent bg-[var(--surface-input)] px-3 text-[13px] text-[var(--text-secondary)] font-[inherit] outline-none focus:border-[var(--focus-border)] focus-visible:outline-none"
            />
            <span className="mt-1.5 block text-[12px] leading-relaxed text-[var(--text-muted)]">
              Only used to tell you about new releases and to ask what you want next.
            </span>
          </label>

          <div className="mt-5 rounded-lg border border-[var(--line-subtle)] p-3">
            <div className="flex items-start justify-between gap-4">
              <span
                id="telemetry-usage-label"
                className="text-[12px] font-medium text-[var(--text-secondary)]"
              >
                Share light usage data
                <span className="mt-1 block font-normal leading-relaxed text-[var(--text-muted)]">
                  Which features get used and how often, tied to the email above. Never what you
                  write, and never a file name.
                </span>
              </span>
              {/* Same switch as Preferences renders for a boolean setting, so the
                  control the user meets here is the one they will find later. */}
              <button
                type="button"
                role="switch"
                aria-checked={shareUsage}
                aria-labelledby="telemetry-usage-label"
                onClick={() => setShareUsage((shared) => !shared)}
                className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
                style={{
                  backgroundColor: shareUsage ? "var(--link-color)" : "var(--border-color)",
                }}
              >
                <span
                  className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200 ease-out"
                  style={{ transform: shareUsage ? "translateX(16px)" : "translateX(0)" }}
                />
              </button>
            </div>

            {/* Hover (or focus) rather than a click: the full list is reference
                material, not a step in the decision, and pushing it into a layer
                keeps the dialog to one screen. */}
            <div
              className="relative mt-2 inline-block"
              onMouseEnter={openDetails}
              onMouseLeave={() => setDetailsAt(null)}
            >
              <button
                ref={triggerRef}
                type="button"
                aria-describedby="telemetry-consent-details"
                onFocus={openDetails}
                onBlur={() => setDetailsAt(null)}
                className="flex items-center gap-1 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
              >
                <HugeiconsIcon
                  icon={InformationCircleIcon}
                  size={13}
                  color="currentColor"
                  strokeWidth={1.8}
                />
                <span className="underline decoration-dotted underline-offset-2">
                  What&rsquo;s collected
                </span>
              </button>

              {detailsAt && (
                <div
                  id="telemetry-consent-details"
                  role="tooltip"
                  style={{ ...detailsAt, width: "max-content", maxWidth: POPOVER_MAX_WIDTH }}
                  className="popover-outline fixed z-10 grid gap-3 rounded-lg bg-[var(--surface-primary)] p-3 shadow-lg"
                >
                  <DisclosureList title="Sent" items={COLLECTED} />
                  <DisclosureList title="Never sent" items={NOT_COLLECTED} />
                </div>
              )}
            </div>
          </div>

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
              Subscribe
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
