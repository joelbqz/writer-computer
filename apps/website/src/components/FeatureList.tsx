export type Feature = { label: string; description: string };

/**
 * A label in full ink followed by a short dimmed line. The space between them
 * keeps the text readable as a sentence without CSS (crawlers, reader mode).
 */
export function FeatureList({ features }: { features: readonly Feature[] }) {
  return (
    <ul className="features">
      {features.map(({ label, description }) => (
        <li className="feature" key={label}>
          <span className="feature-label">{label}</span>{" "}
          <span className="feature-desc">{description}</span>
        </li>
      ))}
    </ul>
  );
}
