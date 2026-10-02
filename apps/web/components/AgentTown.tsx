'use client';

import { useEffect, useRef } from 'react';
import { startAgentTown } from '@/lib/agentTown';

/**
 * The animated town drawn next to the hero copy (see lib/agentTown.ts).
 *
 * Purely decorative: it adds no copy to the page beyond the canvas label, and
 * everything it shows is a simulation with example data. With reduced motion
 * it draws a single still frame.
 */
export function AgentTown() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return startAgentTown(canvas);
  }, []);

  return (
    <div className="town">
      <canvas
        ref={ref}
        className="town-canvas"
        role="img"
        aria-label="Simulation: AI agents with passports check each other before trading. Agents without one are turned away until they get a passport."
      />
    </div>
  );
}
