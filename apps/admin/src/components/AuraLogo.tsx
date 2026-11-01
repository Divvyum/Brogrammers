import { useId } from "react";

/** The AURA mark, same as the student app. */
export function AuraLogo({ size = 40 }: { size?: number }) {
  // Unique gradient ids: a shared id breaks when the first logo sits in a hidden element.
  const uid = useId().replace(/:/g, "");
  const a = `aura-a-${uid}`;
  const b = `aura-b-${uid}`;
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 60 48" aria-hidden>
      <defs>
        <linearGradient id={a} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--logo-1)" }} />
          <stop offset="1" style={{ stopColor: "var(--logo-2)" }} />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <path d="M28.5 1.5c2.6 0 4.5 1.4 5.8 3.8l20.8 37.4c1.1 2-.4 4.3-2.6 4.3h-6.4c-1.5 0-2.8-.8-3.5-2.1L28.5 18.2 22 30.5h-9.3L22.7 5.3c1.3-2.4 3.2-3.8 5.8-3.8Z" fill={`url(#${a})`} />
      <path d="M12.5 28.5C6.5 28.5 2 33 2 38.3 2 43.2 5.9 47 10.8 47c4.4 0 6.8-2.6 8.6-6l3.9-7.4c-3.5-.1-6.4-5.1-10.8-5.1Z" fill={`url(#${b})`} />
    </svg>
  );
}

export function Brand({ sub = "Admin" }: { sub?: string }) {
  return (
    <>
      <AuraLogo size={40} />
      <span>
        <span className="brand-word">AURA</span>
        <small>{sub}</small>
      </span>
    </>
  );
}
