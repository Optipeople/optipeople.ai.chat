import * as React from "react";

type IconProps = React.SVGAttributes<SVGSVGElement> & { size?: number };

function svg(viewBox: string, path: React.ReactNode, displayName: string) {
  const Comp = React.forwardRef<SVGSVGElement, IconProps>(
    ({ size = 16, className, ...rest }, ref) => (
      <svg
        ref={ref}
        viewBox={viewBox}
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
        {...rest}
      >
        {path}
      </svg>
    ),
  );
  Comp.displayName = displayName;
  return Comp;
}

export const CheckIcon = svg(
  "0 0 16 16",
  <path d="M3 8.5l3.5 3.5L13 5" />,
  "CheckIcon",
);

export const MinusIcon = svg(
  "0 0 16 16",
  <path d="M3.5 8h9" />,
  "MinusIcon",
);

export const XIcon = svg(
  "0 0 16 16",
  <path d="M4 4l8 8M12 4l-8 8" />,
  "XIcon",
);

export const CircleXIcon = svg(
  "0 0 16 16",
  <>
    <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="white" />
  </>,
  "CircleXIcon",
);

export const CircleCheckIcon = svg(
  "0 0 16 16",
  <>
    <circle cx="8" cy="8" r="6.5" fill="#37c245" stroke="none" />
    <path d="M5 8.2l2 2 4-4" stroke="white" />
  </>,
  "CircleCheckIcon",
);

export const CircleInfoIcon = svg(
  "0 0 12 12",
  <>
    <circle cx="6" cy="6" r="5" fill="currentColor" stroke="none" />
    <path d="M6 5.4v3.2M6 3.7v.6" stroke="white" strokeWidth={1.4} />
  </>,
  "CircleInfoIcon",
);

export const CircleExclamationIcon = svg(
  "0 0 12 12",
  <>
    <circle cx="6" cy="6" r="5" fill="currentColor" stroke="none" />
    <path d="M6 3.4v3.2M6 8v.6" stroke="white" strokeWidth={1.4} />
  </>,
  "CircleExclamationIcon",
);

export const TriangleExclamationIcon = svg(
  "0 0 16 16",
  <>
    <path d="M8 1.6l6.5 11.4H1.5L8 1.6z" fill="currentColor" stroke="none" />
    <path d="M8 6.2v3.4M8 11v.6" stroke="white" strokeWidth={1.4} />
  </>,
  "TriangleExclamationIcon",
);

export const SearchIcon = svg(
  "0 0 16 16",
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3 3" />
  </>,
  "SearchIcon",
);

export const ChevronRightIcon = svg(
  "0 0 16 16",
  <path d="M6 3l5 5-5 5" />,
  "ChevronRightIcon",
);

export const ChevronLeftIcon = svg(
  "0 0 16 16",
  <path d="M10 3L5 8l5 5" />,
  "ChevronLeftIcon",
);

export const ChevronDownIcon = svg(
  "0 0 16 16",
  <path d="M3 6l5 5 5-5" />,
  "ChevronDownIcon",
);

export const TrashIcon = svg(
  "0 0 20 20",
  <>
    <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 5.5l1 10a1.5 1.5 0 0 0 1.5 1.4h5a1.5 1.5 0 0 0 1.5-1.4l1-10" />
    <path d="M8.5 8.5v6M11.5 8.5v6" />
  </>,
  "TrashIcon",
);

export const BoldIcon = svg(
  "0 0 24 24",
  <path
    d="M6.5 4h6.2c2.2 0 3.8 1.3 3.8 3.3 0 1.5-1 2.7-2.4 3 1.7.2 3 1.6 3 3.5 0 2.3-1.8 3.7-4.4 3.7H6.5V4zm3 5.5h2.3c1.1 0 1.8-.6 1.8-1.6S13 6.4 11.9 6.4H9.5v3.1zm0 5.7h2.6c1.3 0 2-.6 2-1.7s-.8-1.7-2-1.7H9.5v3.4z"
    fill="currentColor"
    stroke="none"
  />,
  "BoldIcon",
);

export const LinkIcon = svg(
  "0 0 16 16",
  <>
    <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5L8 4.5" />
    <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5L8 11.5" />
  </>,
  "LinkIcon",
);

export const SpellCheckIcon = svg(
  "0 0 20 16",
  <>
    <path d="M2 13l3.5-9 3.5 9M3.4 10h4.2" />
    <path d="M12.5 6.5h2.5a1.5 1.5 0 0 1 0 3h-2.5v-3zM12.5 9.5h3a1.5 1.5 0 0 1 0 3h-3v-3z" />
    <path d="M14.5 14l1.5 1.5 3-3.5" stroke="#37c245" />
  </>,
  "SpellCheckIcon",
);
