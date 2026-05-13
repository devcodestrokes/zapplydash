import * as React from "react";

// Maps our internal market codes to ISO 3166-1 alpha-2 (lowercase) for flagcdn.
const CODE_MAP: Record<string, string> = {
  NL: "nl",
  UK: "gb",
  GB: "gb",
  US: "us",
  EU: "eu",
  DE: "de",
  FR: "fr",
};

export function Flag({
  code,
  size = 14,
  className = "",
  title,
}: {
  code?: string | null;
  size?: number;
  className?: string;
  title?: string;
}) {
  if (!code) return null;
  const iso = CODE_MAP[code.toUpperCase()] ?? code.toLowerCase();
  const w = size;
  const h = Math.round(size * 0.75);
  return (
    <img
      src={`https://flagcdn.com/${w * 2}x${h * 2}/${iso}.png`}
      width={w}
      height={h}
      alt={title ?? code}
      title={title ?? code}
      className={`inline-block rounded-[2px] object-cover align-[-2px] ${className}`}
      loading="lazy"
    />
  );
}
