import React from 'react';

export type DrillIconProps = React.SVGProps<SVGSVGElement> & { size?: number };

export function DrillIcon({ size = 16, ...rest }: DrillIconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {/* Body of drill */}
      <rect x="3" y="2" width="10" height="6" rx="1" />
      {/* Drill bit + tip */}
      <path d="M8 8 L8 12" />
      <path d="M6 12 L10 12 L8 14 Z" />
    </svg>
  );
}
