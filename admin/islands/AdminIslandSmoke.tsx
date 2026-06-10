/** @jsxImportSource preact */
import { useState } from 'preact/hooks';

export default function AdminIslandSmoke() {
  const [count, setCount] = useState(0);
  return (
    <button
      type='button'
      class='btn btn-ghost'
      data-admin-island-smoke='true'
      onClick={() => setCount((value) => value + 1)}
    >
      Island smoke {count}
    </button>
  );
}
