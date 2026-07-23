// Local browser file loading. Selected project data is never uploaded.
export function createDataLoader({ applyLoadedJson, loadEditorProjectObject, applyWorkingSessionObject }) {
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read file'));
      reader.readAsText(file);
    });
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    if (files.length > 1) {
      alert('This viewer accepts one combined batch JSON or NArch file only. Loading the first file: ' + files[0].name);
    }

    const file = files[0];

    try {
      const raw = await readFileAsText(file);
      let json;
      try {
        json = JSON.parse(raw);
      } catch (parseErr) {
        throw new Error('This file is not valid JSON, or it was saved as HTML/text with extra content before or after the JSON. Original parser message: ' + parseErr.message);
      }
      if (json && json.schema === 'area_editor_project_v1') {
        loadEditorProjectObject(json, file.name);
        return;
      }
      if (json && json.schema === 'area_working_session_v1') {
        applyWorkingSessionObject(json, file.name);
        return;
      }
      applyLoadedJson(json, file.name);
    } catch (err) {
      alert(`${file.name} could not be imported:\n\n${err.message}`);
    }
  }

  return { loadFiles };
}
