import React from 'react';

export const ScanlineOverlay: React.FC = () => {
  return (
    <div
      aria-hidden="true"
      className="scanlines pointer-events-none fixed inset-0 z-40 opacity-40"
    />
  );
};
