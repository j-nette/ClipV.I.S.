# hologram/

The Three.js + React Three Fiber scene + 4-view pinwheel renderer for the Pepper's Ghost pyramid.

**Owners:** Baron, Claire

## Responsibilities
- Three.js scene composition (camera, lighting, scene graph)
- 4-view pinwheel renderer: render the scene from 4 angles (front/back/left/right) into 4 quadrants on a flat display
- Loading and swapping 3D model files from `models/`
- Animating transitions when models change
- Pure-black background, bright/emissive materials only

## Integration points
- Exposes a callback: `setSceneState({ model, animation, compare_to })` that `voice/` calls when the agent returns a response
- Receives Clippy mascot model from `clippy/`
- Loads asset files from `models/`

## Standalone test
You should be able to render a rotating cube in the pinwheel layout and confirm the pyramid illusion works with no other systems running.
