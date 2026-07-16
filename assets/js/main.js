import { initializeApplication } from './app-core.js';
import { wirePresentationSheet, wireEmptyFileState } from './dom.js';

function showFatalInitializationError(error) {
  console.error('Revit Area Analysis failed to initialize.', error);
  const message = document.createElement('div');
  message.style.cssText = 'padding:24px;font-family:Arial,sans-serif;white-space:pre-wrap';
  message.textContent = `Revit Area Analysis failed to initialize.

${error?.message || error}`;
  document.body.replaceChildren(message);
}

try {
  initializeApplication();
  wirePresentationSheet();
  wireEmptyFileState();
} catch (error) {
  showFatalInitializationError(error);
}
