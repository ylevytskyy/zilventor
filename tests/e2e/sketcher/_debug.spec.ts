// Debug harness removed; bug traced to SceneManager race (parent useLayoutEffect
// fired before child useEffect created the scene). Fixed in App.tsx via
// useEffect + rAF retry loop. This file is intentionally empty.
