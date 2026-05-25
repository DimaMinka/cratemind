import { useState, useEffect } from 'react';
import { useStdout } from 'ink';

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
