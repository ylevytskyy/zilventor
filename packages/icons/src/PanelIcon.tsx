import * as React from 'react';

export function PanelIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
      {...props}
    >
      {/* simple parallelogram representing a board */}
      <path d="M3 8 L21 4 L21 16 L3 20 Z" />
      {/* edge band hint */}
      <path d="M3 8 L21 4" strokeWidth="2.5" />
    </svg>
  );
}
