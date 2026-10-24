import { copyFile } from 'node:fs/promises';
// Keep the legacy entry used by start_server.bat identical to the main page.
await copyFile('index.html','terrain_editor.html');
