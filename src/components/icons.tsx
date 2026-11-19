import type {SVGProps} from "react";

// Two tool icons missing from the icon library, drawn on the same 16px grid and stroke width.
export function CursorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" {...props}>
      <path stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" d="M3.25 2.5l9.5 4-4 1.6-1.6 4.15z" />
    </svg>
  );
}

export function LineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" {...props}>
      <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M3 13L13 3" />
    </svg>
  );
}

export function EllipseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" {...props}>
      <ellipse cx="8" cy="8" rx="6.25" ry="4.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function DiamondIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 16 16" {...props}>
      <path stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" d="M8 1.75L14.25 8 8 14.25 1.75 8z" />
    </svg>
  );
}
