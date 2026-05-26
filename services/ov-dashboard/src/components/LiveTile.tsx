'use client';
import { StatePill } from './StatePill';

export function LiveTile({ mjpegUrl }: { mjpegUrl: string }) {
  return (
    <div className="relative card p-0 overflow-hidden">
      <div className="absolute top-2 left-2 z-10">
        <StatePill />
      </div>
      <img
        src={mjpegUrl}
        alt="live"
        className="w-full block bg-black"
        style={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.opacity = '0.2';
        }}
      />
    </div>
  );
}
