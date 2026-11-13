# Terragen 0.2.3

- Removed the balloon simulator, its physics, audio, controls and UI.
- Removed the inventory, held props and lantern. F toggles a single flashlight beam.
- Old projects still load; old equipment migrates to the flashlight. Balloon state
  is discarded and old passengers return to the editor.
- Removed the WebGPU lab and its build entry points. The editor still uses WebGL.
- Scene reflections are available only at high desktop quality. VR retains its
  stereo-safe sky reflection fallback and does not use monocular scene captures.
- Sun shadow maps are capped at 2048. Walking coverage is 70 m in balanced and
  80 m in high quality; orbit coverage is capped at a 150 m radius.
- Builtin models use the same authored procedural factories as the GLB exporter.
  Geometry is created on first use and cached. Catalog listing does not create
  geometry. The redundant embedded builtin GLB pack is no longer shipped in the
  application; public GLB exports remain available.

Historical verification reports describe older versions and removed features.
Current checks: npm test, npm run typecheck, npm run build.
