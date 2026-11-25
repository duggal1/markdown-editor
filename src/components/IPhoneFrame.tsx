import type { ReactNode } from 'react';

/**
 * The exact two SVG layers and screen box supplied for Flow.
 * No synthetic bezel, island, extra highlights, or decorative shadows.
 */
export default function IPhoneFrame({
  children,
  isDark,
}: {
  children: ReactNode;
  isDark: boolean;
}) {
  return (
    <div className="html-iphone-frame">
      <svg
        className="html-iphone-outline"
        height={700}
        viewBox="0 0 340 700"
        width={340}
        aria-hidden="true"
      >
        <rect
          fill="transparent"
          height={681}
          rx={63}
          ry={63}
          stroke={isDark ? '#27272a' : '#000000'}
          strokeWidth={5}
          width={322}
          x={9}
          y={9.5}
        />
      </svg>
      <div className="html-iphone-content">
        <div className="html-iphone-interactive">{children}</div>
      </div>
      <svg
        className="html-iphone-overlay"
        height={700}
        viewBox="0 0 340 700"
        width={340}
        aria-hidden="true"
      >
        <rect
          fill={isDark ? '#171717' : '#000000'}
          stroke={isDark ? '#262626' : 'none'}
          strokeWidth={1}
          height={28}
          rx={14}
          ry={14}
          width={96}
          x={122}
          y={24}
        />
        <circle cx={186} cy={38} fill="#07e00a" r={2.8} />
      </svg>
    </div>
  );
}
