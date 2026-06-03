import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

/**
 * useStdoutDimensions.ts
 *
 * Custom hook to track and react to terminal window dimension changes (resize events).
 * Provides the current columns and rows of the stdout terminal.
 */

/**
 * Subscribes to the stdout resize event and returns the current terminal dimensions.
 *
 * @returns {object} An object containing the current `columns` and `rows` of the terminal.
 */
export function useStdoutDimensions() {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    columns: stdout.columns || 80,
    rows: stdout.rows || 24
  });

  useEffect(() => {
    const onResize = () => {
      setDimensions({
        columns: stdout.columns || 80,
        rows: stdout.rows || 24
      });
    };

    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return dimensions;
}
