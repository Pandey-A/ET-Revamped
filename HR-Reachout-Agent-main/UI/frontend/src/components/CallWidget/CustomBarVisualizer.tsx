import React, { useEffect, useState } from 'react';
import { TrackReferenceOrPlaceholder } from '@livekit/components-core';

interface Props {
  trackRef: TrackReferenceOrPlaceholder;
  state: string;
  barCount?: number;
  className?: string;
  minHeight?: number;
  maxHeight?: number;
}

export const CustomBarVisualizer: React.FC<Props> = ({
  trackRef,
  state,
  barCount = 5,
  className = '',
  minHeight = 45,
  maxHeight = 120,
}) => {
  const [heights, setHeights] = useState<number[]>(Array(barCount).fill(minHeight));


useEffect(() => {
  const interval = setInterval(() => {
    const audioTrack = 'publication' in trackRef ? trackRef.publication?.track : undefined;
    let audioLevel = (audioTrack as any)?.audioLevel ?? 0;

    // Soft boost if too low but speaking
    if (audioLevel < 0.03 && state === 'speaking') {
      audioLevel = 0.2 + Math.random() * 0.2;
    }

    const now = Date.now();
    const waveSpeed = 70;

    const newHeights = Array.from({ length: barCount }, (_, i) => {
      if (state === 'speaking') {
        const phaseOffset = Math.random() * 100 + i * 25; 
        const sine = Math.sin((now + phaseOffset) / waveSpeed);
        const jitter = Math.random() * 0.5 + 0.5;

        const dynamicFactor = (sine * 0.5 + 0.5) * jitter; 
        const boosted = Math.pow(audioLevel, 0.5);
        const scaled = boosted * maxHeight * dynamicFactor * 1.6;

        return Math.max(minHeight, Math.min(maxHeight, scaled));
      } else {
        return minHeight;
      }
    });

    setHeights(newHeights);
  }, 200); 

  return () => clearInterval(interval);
}, [trackRef, state, barCount, minHeight, maxHeight]);



  const centerIndex = Math.floor(barCount / 2);

  return (
    <div className={`agent-bar-visualizer ${className}`}>
      {heights.map((height, idx) => {
        const isCenter = idx === centerIndex;
        const isSpeaking = state === 'speaking';

        return (
          <div
            key={idx}
            className={`lk-audio-bar ${!isSpeaking && isCenter ? 'blinking' : ''}`}
            style={{
              height: `${height}px`,
              backgroundColor: isSpeaking ? '#E10503' : 'white',
              borderColor: '#E10503',
              boxShadow: isSpeaking
                ? '0 0 14px rgba(225, 5, 3, 0.4), 0 0 28px rgba(225, 5, 3, 0.2)'
                : 'none',
            }}
          />
        );
      })}
    </div>
  );
};
