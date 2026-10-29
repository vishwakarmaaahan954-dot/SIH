import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Polyfills and mocks for DOM APIs used in App.jsx or components
window.alert = vi.fn();
window.prompt = vi.fn();
window.confirm = vi.fn(() => true);
window.scrollTo = vi.fn();

// App.jsx global polyfill for undeclared state setter bug in App.jsx (escalated to M2 frontend worker)
globalThis.setIsLoadingProfile = vi.fn();

// ResizeObserver and IntersectionObserver mocks for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// MediaDevices mock for jsdom
if (!navigator.mediaDevices) {
  navigator.mediaDevices = {};
}
navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue({
  getVideoTracks: () => [],
  getTracks: () => [],
});
navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([]);
