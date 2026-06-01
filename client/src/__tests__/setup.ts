import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollIntoView; several components call it inside
// effects (thread/digest row expansion, teach-panel autoscroll). Stub it so
// those code paths don't throw during tests.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
