# Edge Clone

https://enzocage.de/code/edge/index.html

A 3D puzzle-platformer inspired by the classic game "Edge", built with Three.js.

## Features

### Core Mechanics
- **Rolling**: Navigate the cube by rolling it across a grid.
- **Climbing**: Scale obstacles by rolling against them.
- **Shrinking**: Use Shrink Pads to fit through tight spaces.
- **Edge Balancing**: Balance on edges and corners to reach distant platforms.
- **Edge Time**: Earn bonus points by maintaining a balancing state.

### Level Editor
- **Full-featured Editor**: Create your own levels with a variety of block types.
- **Block Types**: Normal, Start, End, Moving Platforms, Switches, Ghost Blocks, Shrink Pads, and Checkpoints.
- **Save/Load**: Export and import levels as JSON files.
- **Undo/Redo**: Robust system for easy editing.

### Visuals & Audio
- **Minimalist Aesthetic**: Clean, geometric design with high-contrast visuals.
- **Dynamic Lighting**: Ambient and directional lights with shadows.
- **Immersive SFX**: Custom sound effects for rolling, climbing, and collecting prisms.

## How to Run

1.  Open `index.html` in any modern web browser.
2.  Click **Start Game** to play the default level.
3.  Click **Level Editor** to create and test your own levels.

## Controls

### Game
- **Arrow Keys / WASD**: Move the cube.
- **Space**: Interact (if applicable).

### Level Editor
- **1-8**: Select block type.
- **Left Click**: Place block.
- **Shift + Left Click**: Erase block.
- **Ctrl + S**: Save level JSON.
- **Ctrl + Z / Ctrl + Y**: Undo / Redo.

## Technical Details
- **Engine**: [Three.js](https://threejs.org/)
- **Logic**: Vanilla JavaScript
- **Styling**: Vanilla CSS
- **Audio**: Web Audio API
