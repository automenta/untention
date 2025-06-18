import { vi } from 'vitest';

const createMockComponent = () => ({
  element: document.createElement('div'), // Ensure .element is a DOM node
  show: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
  add: vi.fn(),
  setContent: vi.fn(),
  mount: vi.fn(),
  // Add any other methods that are commonly called on these components
});

// Mocked constructors that return the mock component instances
export const NoThoughtSelectedView = vi.fn().mockImplementation(() => createMockComponent());
export const NoteEditorView = vi.fn().mockImplementation(() => createMockComponent());
export const MessageListView = vi.fn().mockImplementation(() => createMockComponent());

// MainView is often the component under test, so we re-export the original.
// If MainView itself needs to be mocked in other tests, that should be handled there.
export { MainView } from '../components.js'; // Re-export original MainView
