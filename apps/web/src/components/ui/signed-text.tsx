import * as React from "react";

/**
 * Charis draws "+" and the true minus (U+2212) on a full em with about 0.2em of empty space on
 * each side, so a plain "+$217.44" reads as "+ $217.44". The sign is rendered as its own span
 * and pulled in by 0.15em per side, which leaves roughly a figure's own side bearing. Only the
 * sign's advance changes, so right-aligned digit columns still line up. Losses print the true
 * minus instead of the narrow ASCII hyphen so both signs share one width.
 */
function SignedText({ children }: { children: string }) {
  const sign = /^[+\-−]/.exec(children)?.[0];
  if (!sign) return children;
  return (
    <>
      <span data-slot="sign" className="-mx-[0.15em]">
        {sign === "+" ? "+" : "−"}
      </span>
      {children.slice(1)}
    </>
  );
}

export { SignedText };
