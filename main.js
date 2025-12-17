import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Constants & State ---
const GRID_SIZE = 1;
let scene, camera, renderer, controls;
let gameState = 'menu'; // 'menu', 'playing', 'editor'
let levelData = {}; // { "x,y,z": mesh }
let player = null;
let isMoving = false;
let isShrunk = false;
const moveSpeed = 0.2;
let isTesting = false;

let startTime = 0;
let spawnPos = new THREE.Vector3(0, 1, 0);
let prisms = [];
let collectedPrisms = 0;
let edgeTime = 0;
let isBalancing = false;
let movingPlatforms = [];
let switches = [];
let ghostBlocks = [];

let currentTool = 'brush';
let currentBlockType = 'normal';
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let ghostBlock;
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

let audioCtx = null;
let minimapRenderer, minimapCamera;

const BUILT_IN_LEVELS = [
    {
        name: "Training",
        blocks: [
            { pos: [-1, 0, -1], type: 'normal' }, { pos: [0, 0, -1], type: 'normal' }, { pos: [1, 0, -1], type: 'normal' },
            { pos: [-1, 0, 0], type: 'normal' }, { pos: [0, 0, 0], type: 'normal' }, { pos: [1, 0, 0], type: 'normal' },
            { pos: [-1, 0, 1], type: 'normal' }, { pos: [0, 0, 1], type: 'normal' }, { pos: [1, 0, 1], type: 'normal' },
            { pos: [2, 0, 1], type: 'normal' }, { pos: [3, 0, 1], type: 'normal' },
            { pos: [3, 0, 2], type: 'normal' }, { pos: [3, 0, 3], type: 'end' },
            { pos: [1, 1, 0], type: 'prism' }
        ]
    },
    {
        name: "The Leap",
        blocks: [
            { pos: [0, 0, 0], type: 'normal' }, { pos: [1, 0, 0], type: 'normal' }, { pos: [2, 0, 0], type: 'normal' },
            { pos: [4, 0, 0], type: 'normal' }, { pos: [5, 0, 0], type: 'normal' }, { pos: [6, 0, 0], type: 'end' },
            { pos: [3, 0, 0], type: 'moving', startPos: [3, 0, -2], endPos: [3, 0, 2], speed: 0.05 }
        ]
    }
];

let unlockedLevels = JSON.parse(localStorage.getItem('unlockedLevels')) || [0];
let highScores = JSON.parse(localStorage.getItem('highScores')) || {};

// --- Initialization ---
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(5, 5, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.getElementById('game-container').appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    scene.add(dirLight);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = false;

    // Minimap Init
    setupMinimap();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('touchstart', () => {
        document.getElementById('mobile-controls').style.display = 'grid';
    }, { once: true });

    document.getElementById('load-btn').onclick = () => document.getElementById('level-input').click();
    document.getElementById('level-input').onchange = loadLevel;

    animate();
}

function setupMinimap() {
    const minimapSize = 200;
    minimapCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 100);
    minimapCamera.position.set(0, 50, 0);
    minimapCamera.lookAt(0, 0, 0);

    minimapRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    minimapRenderer.setSize(minimapSize, minimapSize);
    minimapRenderer.setClearColor(0x000000, 0.5);
    const minimapContainer = document.getElementById('minimap-container');
    if (minimapContainer) {
        minimapContainer.appendChild(minimapRenderer.domElement);
    }
}

function loadLevel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = JSON.parse(e.target.result);
        clearScene();
        data.blocks.forEach(b => {
            addBlock(b.pos[0], b.pos[1], b.pos[2], b.type);
        });
        if (gameState === 'playing') {
            spawnPlayer();
        }
    };
    reader.readAsText(file);
}

function clearScene() {
    for (const key in levelData) {
        scene.remove(levelData[key]);
    }
    levelData = {};
    prisms.forEach(p => scene.remove(p));
    prisms = [];
    if (player) scene.remove(player);
}

function spawnPlayer() {
    const playerGeo = new THREE.BoxGeometry(1, 1, 1);
    const playerMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    player = new THREE.Mesh(playerGeo, playerMat);
    player.position.set(0, 1, 0); // Default start
    player.castShadow = true;
    scene.add(player);
}

function onMouseMove(event) {
    if (gameState !== 'editor') return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children.filter(c => c.type === 'Mesh' && c !== ghostBlock));

    if (intersects.length > 0) {
        const intersect = intersects[0];
        let pos;
        if (intersect.object.name === 'basePlane') {
            pos = intersect.point.clone();
            pos.y = 0;
        } else if (intersect.face) {
            pos = intersect.point.clone().add(intersect.face.normal.clone().multiplyScalar(0.5));
        } else {
            pos = intersect.point.clone();
        }
        pos.x = Math.round(pos.x);
        pos.y = Math.round(pos.y);
        pos.z = Math.round(pos.z);

        if (!ghostBlock) {
            ghostBlock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
            scene.add(ghostBlock);
        }
        ghostBlock.position.copy(pos);
    }
}

function onMouseDown(event) {
    if (gameState !== 'editor') return;
    if (event.target.tagName === 'BUTTON' || event.target.tagName === 'SELECT') return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children.filter(c => c.type === 'Mesh' && c !== ghostBlock));

    if (intersects.length > 0) {
        const intersect = intersects[0];
        if (currentTool === 'brush') {
            let pos;
            if (intersect.object.name === 'basePlane') {
                pos = intersect.point.clone();
                pos.y = 0;
            } else if (intersect.face) {
                pos = intersect.point.clone().add(intersect.face.normal.clone().multiplyScalar(0.5));
            } else {
                pos = intersect.point.clone();
            }
            const x = Math.round(pos.x);
            const y = Math.round(pos.y);
            const z = Math.round(pos.z);
            executeCommand(new AddBlockCommand(x, y, z, currentBlockType));
        } else if (currentTool === 'eraser') {
            if (intersect.object.type === 'Mesh' && intersect.object !== player && intersect.object.name !== 'basePlane') {
                executeCommand(new RemoveBlockCommand(intersect.object));
            }
        }
    }
}

// --- Command Pattern ---
class AddBlockCommand {
    constructor(x, y, z, type) {
        this.x = x; this.y = y; this.z = z; this.type = type;
        this.mesh = null;
    }
    execute() {
        this.mesh = addBlock(this.x, this.y, this.z, this.type);
    }
    undo() {
        if (this.mesh) removeBlock(this.mesh, false);
    }
}

class RemoveBlockCommand {
    constructor(mesh) {
        this.mesh = mesh;
        this.x = mesh.position.x;
        this.y = mesh.position.y;
        this.z = mesh.position.z;
        this.type = mesh.userData.type;
    }
    execute() {
        removeBlock(this.mesh, false);
    }
    undo() {
        this.mesh = addBlock(this.x, this.y, this.z, this.type);
    }
}

function executeCommand(command) {
    command.execute();
    undoStack.push(command);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = []; // Clear redo on new action
}

window.undo = () => {
    if (undoStack.length === 0) return;
    const command = undoStack.pop();
    command.undo();
    redoStack.push(command);
};

window.redo = () => {
    if (redoStack.length === 0) return;
    const command = redoStack.pop();
    command.execute();
    undoStack.push(command);
};

function addBlock(x, y, z, type = 'normal') {
    const key = `${x},${y},${z}`;
    if (levelData[key]) return;

    let geo, mat, mesh;
    if (type === 'prism') {
        geo = new THREE.OctahedronGeometry(0.3);
        mat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'prism' };
        prisms.push(mesh);
    } else if (type === 'moving') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0x0000ff });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = {
            type: 'moving',
            startPos: new THREE.Vector3(x, y, z),
            endPos: new THREE.Vector3(x + 3, y, z), // Default path
            speed: 0.02,
            direction: 1,
            progress: 0
        };
        movingPlatforms.push(mesh);
    } else if (type === 'end') {
        geo = new THREE.BoxGeometry(1, 0.2, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.5 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'end' };
        levelData[key] = mesh;
    } else if (type === 'switch') {
        geo = new THREE.BoxGeometry(0.8, 0.1, 0.8);
        mat = new THREE.MeshStandardMaterial({ color: 0xffff00 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'switch', active: false };
        switches.push(mesh);
    } else if (type === 'ghost') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'ghost', active: false };
        ghostBlocks.push(mesh);
    } else if (type === 'shrink') {
        geo = new THREE.BoxGeometry(0.8, 0.1, 0.8);
        mat = new THREE.MeshStandardMaterial({ color: 0xff00ff });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'shrink' };
        levelData[key] = mesh;
    } else if (type === 'checkpoint') {
        geo = new THREE.BoxGeometry(0.8, 0.1, 0.8);
        mat = new THREE.MeshStandardMaterial({ color: 0x0000ff });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'checkpoint', active: false };
        levelData[key] = mesh;
    } else {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'normal' };
        levelData[key] = mesh;
    }

    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
}

function removeBlock(mesh, updateData = true) {
    if (updateData) {
        const key = `${mesh.position.x},${mesh.position.y},${mesh.position.z}`;
        delete levelData[key];
    }
    const prismIndex = prisms.indexOf(mesh);
    if (prismIndex > -1) prisms.splice(prismIndex, 1);
    const movingIndex = movingPlatforms.indexOf(mesh);
    if (movingIndex > -1) movingPlatforms.splice(movingIndex, 1);
    const switchIndex = switches.indexOf(mesh);
    if (switchIndex > -1) switches.splice(switchIndex, 1);
    const ghostIndex = ghostBlocks.indexOf(mesh);
    if (ghostIndex > -1) ghostBlocks.splice(ghostIndex, 1);

    scene.remove(mesh);
}

window.setTool = (tool) => {
    currentTool = tool;
};

window.setBlockType = (type) => {
    currentBlockType = type;
};

window.saveLevel = async () => {
    console.log("Saving level...");
    try {
        const blocks = [];
        scene.traverse(child => {
            if (child.isMesh && child.userData && child.userData.type && child !== player && child.name !== 'basePlane') {
                blocks.push({
                    type: child.userData.type,
                    pos: [child.position.x, child.position.y, child.position.z]
                });
            }
        });
        const validation = validateLevel(blocks);
        if (!validation.valid) {
            if (!confirm("Level Validation Warning:\n" + validation.errors.join("\n") + "\n\nDo you want to save anyway?")) {
                return;
            }
        }

        const level = {
            metadata: { name: "New Level", author: "Player", timestamp: new Date().toISOString() },
            blocks: blocks
        };
        const json = JSON.stringify(level, null, 2);

        // 1. Try File System Access API (Best for Chrome/Edge)
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'level.json',
                    types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
                });
                const writable = await handle.createWritable();
                await writable.write(json);
                await writable.close();
                console.log("Saved via File System API");
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.warn("File System API failed, using fallback", e);
            }
        }

        // 2. Fallback: Classic Download
        const blob = new Blob([json], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'level.json';
        document.body.appendChild(a);
        a.click();

        // 3. Ultimate Fallback: Clipboard
        const useClipboard = confirm("Download triggered. If the file name is a UUID or the download failed, click OK to copy the level data to your clipboard as a backup.");
        if (useClipboard) {
            await navigator.clipboard.writeText(json);
            alert("Level data copied to clipboard! You can paste it into a .json file.");
        }

        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 10000);
    } catch (err) {
        console.error("Save Level Error:", err);
        alert("Error saving level: " + err.message + "\nCheck console (F12) for data.");
    }
};

function validateLevel(blocks) {
    const errors = [];
    const counts = { start: 0, end: 0 };
    blocks.forEach(b => {
        if (b.type === 'normal' && b.pos[0] === 0 && b.pos[1] === 0 && b.pos[2] === 0) counts.start++; // Simplified start detection
        if (b.type === 'end') counts.end++;
    });

    // In this implementation, start is implicitly 0,0,0 or we could have a start block type.
    // Let's assume the spec means we need an end block.
    if (counts.end === 0) errors.push("Level needs at least one 'End' block.");

    return {
        valid: errors.length === 0,
        errors: errors
    };
}

window.move = (directionStr) => {
    if (gameState !== 'playing' || isMoving) return;
    let dir = new THREE.Vector3();
    if (directionStr === 'up') dir.set(0, 0, -1);
    if (directionStr === 'down') dir.set(0, 0, 1);
    if (directionStr === 'left') dir.set(-1, 0, 0);
    if (directionStr === 'right') dir.set(1, 0, 0);

    processMove(dir);
};

function onKeyDown(event) {
    if (event.ctrlKey && event.key === 's') {
        event.preventDefault();
        saveLevel();
        return;
    }
    if (gameState === 'editor') {
        // ... editor shortcuts ...
        if (event.key === '1') setBlockType('normal');
        if (event.key === '2') setBlockType('prism');
        if (event.key === '3') setBlockType('moving');
        if (event.key === '4') setBlockType('end');
        if (event.key === '5') setBlockType('switch');
        if (event.key === '6') setBlockType('ghost');
        if (event.key === '7') setBlockType('shrink');
        if (event.key === '8') setBlockType('checkpoint');
        if (event.key === 'b') setTool('brush');
        if (event.key === 'e') setTool('eraser');
        if (event.key === 'g') {
            const helper = scene.children.find(c => c instanceof THREE.GridHelper);
            if (helper) helper.visible = !helper.visible;
        }
    }

    if (gameState !== 'playing' || isMoving) return;

    let dir = new THREE.Vector3();
    switch (event.key.toLowerCase()) {
        case 'arrowup': case 'w': dir.set(0, 0, -1); break;
        case 'arrowdown': case 's': dir.set(0, 0, 1); break;
        case 'arrowleft': case 'a': dir.set(-1, 0, 0); break;
        case 'arrowright': case 'd': dir.set(1, 0, 0); break;
        case 'z': if (event.ctrlKey) undo(); break;
        case 'y': if (event.ctrlKey) redo(); break;
        default: return;
    }
    processMove(dir);
}

function processMove(dir) {
    // Check for climbing
    const targetPos = player.position.clone().add(dir);
    const tx = Math.round(targetPos.x);
    const ty = Math.round(targetPos.y);
    const tz = Math.round(targetPos.z);

    const obstacleKey = `${tx},${ty},${tz}`;
    const aboveObstacleKey = `${tx},${ty + 1},${tz}`;

    if (levelData[obstacleKey] && !levelData[aboveObstacleKey]) {
        climbCube(dir);
    } else if (!levelData[obstacleKey]) {
        rollCube(dir);
    }
}

function climbCube(direction) {
    isMoving = true;
    const pivot = player.position.clone().add(direction.clone().multiplyScalar(0.5)).add(new THREE.Vector3(0, 0.5, 0));
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();

    const startRotation = player.quaternion.clone();
    const startPosition = player.position.clone();
    const targetPosition = player.position.clone().add(direction).add(new THREE.Vector3(0, 1, 0));

    let progress = 0;
    const duration = 300;
    const startTime = performance.now();

    function animateClimb() {
        const now = performance.now();
        progress = Math.min((now - startTime) / duration, 1);
        const angle = (Math.PI / 2) * progress;

        player.position.copy(startPosition);
        player.quaternion.copy(startRotation);
        player.rotateOnWorldAxis(axis, angle);

        const offset = startPosition.clone().sub(pivot);
        offset.applyAxisAngle(axis, angle);
        player.position.copy(pivot.clone().add(offset));

        if (progress < 1) {
            requestAnimationFrame(animateClimb);
        } else {
            player.position.set(Math.round(targetPosition.x), Math.round(targetPosition.y), Math.round(targetPosition.z));
            isMoving = false;
            playSound('climb');
            checkPhysics();
        }
    }
    animateClimb();
}

function rollCube(direction) {
    isMoving = true;

    // Pivot point is the edge in the direction of movement
    const pivot = player.position.clone().add(direction.clone().multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.5, 0));
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();

    const startRotation = player.quaternion.clone();
    const targetRotation = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2).multiply(startRotation);

    const startPosition = player.position.clone();
    const targetPosition = player.position.clone().add(direction);

    let progress = 0;
    const duration = 200; // ms
    const startTime = performance.now();

    function animateRoll() {
        const now = performance.now();
        progress = Math.min((now - startTime) / duration, 1);

        // Rotate around pivot
        const angle = (Math.PI / 2) * progress;
        player.position.copy(startPosition);
        player.quaternion.copy(startRotation);

        // Apply rotation around pivot
        player.rotateOnWorldAxis(axis, angle);

        // Adjust position to stay on pivot
        const offset = startPosition.clone().sub(pivot);
        offset.applyAxisAngle(axis, angle);
        player.position.copy(pivot.clone().add(offset));

        if (progress < 1) {
            requestAnimationFrame(animateRoll);
        } else {
            // Check if target has floor
            const tx = Math.round(targetPosition.x);
            const ty = Math.round(targetPosition.y);
            const tz = Math.round(targetPosition.z);
            const targetFloorKey = `${tx},${ty - 1},${tz}`;

            if (!levelData[targetFloorKey]) {
                if (isBalancing) {
                    // Already balancing, now we fall
                    player.position.set(tx, ty, tz);
                    isBalancing = false;
                    fall();
                } else {
                    // Enter balancing state
                    isBalancing = true;
                    player.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
                    // Tilt slightly to show balancing based on direction
                    if (direction.x !== 0) player.rotation.z = direction.x * 0.2;
                    if (direction.z !== 0) player.rotation.x = -direction.z * 0.2;
                    isMoving = false;
                    playSound('roll');
                }
            } else {
                // Snap to grid
                player.position.set(tx, ty, tz);
                player.rotation.set(0, 0, 0); // Reset tilt
                isMoving = false;
                isBalancing = false;
                playSound('roll');
                checkPhysics();
            }
        }
    }

    animateRoll();
}

function checkPhysics() {
    const key = `${player.position.x},${player.position.y - 1},${player.position.z}`;
    const floor = levelData[key];

    if (floor && floor.userData.type === 'end') {
        const time = ((performance.now() - startTime) / 1000).toFixed(2);
        alert(`Level Complete! Time: ${time}s`);

        // Save Progress
        const currentLevelIndex = BUILT_IN_LEVELS.findIndex(l => l.active);
        if (currentLevelIndex !== -1) {
            if (!unlockedLevels.includes(currentLevelIndex + 1)) {
                unlockedLevels.push(currentLevelIndex + 1);
                localStorage.setItem('unlockedLevels', JSON.stringify(unlockedLevels));
            }
            if (!highScores[currentLevelIndex] || time < highScores[currentLevelIndex]) {
                highScores[currentLevelIndex] = time;
                localStorage.setItem('highScores', JSON.stringify(highScores));
            }
        }

        exitToMenu();
        return;
    }

    if (!floor) {
        fall();
    } else if (floor.userData.type === 'shrink') {
        toggleShrink();
    } else if (floor.userData.type === 'checkpoint') {
        if (!floor.userData.active) {
            floor.userData.active = true;
            floor.material.color.set(0x00ffff);
            spawnPos.copy(floor.position).add(new THREE.Vector3(0, 1, 0));
        }
    }

    // Edge Balancing Logic
    const subFloorKey = `${Math.round(player.position.x)},${Math.round(player.position.y - 1)},${Math.round(player.position.z)}`;
    if (!levelData[subFloorKey]) {
        // We are over a void, but maybe balancing?
        // In this simplified version, if we are not moving and not on a floor, we might be balancing 
        // if we just rolled from a solid block.
        // For now, let's trigger balancing if the player is at a non-integer position or specifically flagged.
        // Actually, let's refine: if we are at an integer position but there's no floor, we fall.
        // Balancing happens DURING or at the END of a move if we choose to hold.
    }

    // Check switches
    let stateChanged = false;
    switches.forEach(s => {
        const dist = player.position.distanceTo(s.position);
        if (dist < 0.6) {
            if (!s.userData.active) {
                s.userData.active = true;
                s.material.color.set(0x00ff00);
                playSound('switch');
                stateChanged = true;
            }
        } else {
            if (s.userData.active) {
                s.userData.active = false;
                s.material.color.set(0xffff00);
                playSound('switch');
                stateChanged = true;
            }
        }
    });
    if (stateChanged) toggleGhostBlocks();

    // Check prism collection
    for (let i = prisms.length - 1; i >= 0; i--) {
        if (player.position.distanceTo(prisms[i].position) < 0.8) {
            scene.remove(prisms[i]);
            prisms.splice(i, 1);
            collectedPrisms++;
            playSound('prism');
            document.getElementById('prisms').innerText = collectedPrisms;
        }
    }
}

function toggleShrink() {
    isShrunk = !isShrunk;
    const scale = isShrunk ? 0.5 : 1.0;
    player.scale.set(scale, scale, scale);
    // Adjust position so it doesn't sink into floor
    if (isShrunk) {
        player.position.y -= 0.25;
    } else {
        player.position.y = Math.round(player.position.y);
    }
}

function toggleGhostBlocks() {
    const anyActive = switches.some(s => s.userData.active);
    ghostBlocks.forEach(g => {
        g.userData.active = anyActive;
        g.material.opacity = anyActive ? 1.0 : 0.3;
        const key = `${g.position.x},${g.position.y},${g.position.z}`;
        if (anyActive) {
            levelData[key] = g;
        } else {
            delete levelData[key];
        }
    });
}

function fall() {
    isMoving = true;
    const startY = player.position.y;
    const targetY = -20; // Death floor
    playSound('fall');

    function animateFall() {
        player.position.y -= 0.2;
        if (player.position.y < targetY) {
            player.position.copy(spawnPos); // Respawn
            isMoving = false;
        } else {
            const key = `${Math.round(player.position.x)},${Math.floor(player.position.y - 0.5)},${Math.round(player.position.z)}`;
            if (levelData[key]) {
                player.position.y = Math.round(player.position.y);
                isMoving = false;
            } else {
                requestAnimationFrame(animateFall);
            }
        }
    }
    animateFall();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.exitToMenu = () => {
    if (isTesting) {
        returnToEditor();
        return;
    }
    fadeTransition(() => {
        gameState = 'menu';
        document.getElementById('menu').style.display = 'block';
        document.getElementById('hud').style.display = 'none';
        document.getElementById('editor-ui').style.display = 'none';
        document.getElementById('minimap-container').style.display = 'none';
        location.reload(); // Simplest way to reset all state for now
    });
};

window.returnToEditor = () => {
    fadeTransition(() => {
        isTesting = false;
        gameState = 'editor';
        document.getElementById('hud').style.display = 'none';
        document.getElementById('editor-ui').style.display = 'block';
        controls.enabled = true;

        // Restore editor objects
        setupEditor();

        // Remove player
        if (player) {
            scene.remove(player);
            player = null;
        }

        // Reset levelData for editor raycasting if needed
        // (Actually levelData is used for physics, editor uses raycasting against scene meshes)
    });
};

window.loadLevelFromFile = () => {
    document.getElementById('level-input').click();
};

window.startEditor = () => {
    fadeTransition(() => {
        gameState = 'editor';
        document.getElementById('menu').style.display = 'none';
        document.getElementById('editor-ui').style.display = 'block';
        document.getElementById('minimap-container').style.display = 'block';
        controls.enabled = true;
        setupEditor();
    });
};

window.playEditedLevel = () => {
    isTesting = true;
    const blocks = [];
    scene.traverse(child => {
        if (child.isMesh && child.userData && child.userData.type && child !== player && child.name !== 'basePlane') {
            blocks.push({
                type: child.userData.type,
                pos: [child.position.x, child.position.y, child.position.z],
                // For moving platforms, we'd need to save their path data too if we wanted it per-block
                // For now, moving platforms in editor have default paths
                startPos: child.userData.startPos ? [child.userData.startPos.x, child.userData.startPos.y, child.userData.startPos.z] : null,
                endPos: child.userData.endPos ? [child.userData.endPos.x, child.userData.endPos.y, child.userData.endPos.z] : null,
                speed: child.userData.speed || 0.02
            });
        }
    });

    fadeTransition(() => {
        gameState = 'playing';
        document.getElementById('editor-ui').style.display = 'none';
        document.getElementById('hud').style.display = 'block';

        // Remove editor-only objects
        const grid = scene.children.find(c => c instanceof THREE.GridHelper);
        if (grid) scene.remove(grid);
        const plane = scene.children.find(c => c.name === 'basePlane');
        if (plane) scene.remove(plane);
        if (ghostBlock) {
            scene.remove(ghostBlock);
            ghostBlock = null;
        }

        // We don't clearScene because we already have the blocks!
        // But we need to reset the player and interactive states
        if (player) scene.remove(player);
        spawnPlayer();

        // Re-initialize interactive arrays for the current blocks
        movingPlatforms = [];
        switches = [];
        ghostBlocks = [];
        prisms = [];
        levelData = {};

        scene.traverse(child => {
            if (child.isMesh && child.userData && child.userData.type && child !== player && child.name !== 'basePlane') {
                const type = child.userData.type;
                const pos = child.position;
                const key = `${pos.x},${pos.y},${pos.z}`;

                if (type === 'prism') prisms.push(child);
                else if (type === 'moving') movingPlatforms.push(child);
                else if (type === 'switch') switches.push(child);
                else if (type === 'ghost') ghostBlocks.push(child);
                else if (type !== 'start') levelData[key] = child;
            }
        });

        startTime = performance.now();
        collectedPrisms = 0;
        document.getElementById('prisms').innerText = '0';
        controls.enabled = false;
    });
};

window.showLevelSelector = () => {
    document.getElementById('menu').style.display = 'none';
    document.getElementById('level-selector').style.display = 'block';
    const list = document.getElementById('level-list');
    list.innerHTML = '';
    BUILT_IN_LEVELS.forEach((level, i) => {
        const isLocked = !unlockedLevels.includes(i);
        const card = document.createElement('div');
        card.className = `level-card ${isLocked ? 'locked' : ''}`;
        card.innerHTML = `
            <div>Level ${i + 1}</div>
            <div style="font-size: 14px;">${level.name}</div>
            ${highScores[i] ? `<div style="font-size: 10px; color: var(--accent);">Best: ${highScores[i]}s</div>` : ''}
        `;
        if (!isLocked) card.onclick = () => startLevel(i);
        list.appendChild(card);
    });
};

window.showMenu = () => {
    document.getElementById('level-selector').style.display = 'none';
    document.getElementById('menu').style.display = 'block';
};

function startLevel(index) {
    fadeTransition(() => {
        gameState = 'playing';
        document.getElementById('level-selector').style.display = 'none';
        document.getElementById('menu').style.display = 'none';
        document.getElementById('hud').style.display = 'block';
        document.getElementById('minimap-container').style.display = 'block';

        clearScene();
        const level = BUILT_IN_LEVELS[index];
        BUILT_IN_LEVELS.forEach(l => l.active = false);
        level.active = true;

        level.blocks.forEach(b => {
            const m = addBlock(b.pos[0], b.pos[1], b.pos[2], b.type);
            if (b.type === 'moving' && m) {
                m.userData.startPos = new THREE.Vector3(...b.startPos);
                m.userData.endPos = new THREE.Vector3(...b.endPos);
                m.userData.speed = b.speed;
            }
        });
        spawnPlayer();
        startTime = performance.now();
        collectedPrisms = 0;
        document.getElementById('prisms').innerText = '0';
    });
}

function setupLevel() {
    startLevel(0);
}

function setupEditor() {
    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Base plane for raycasting when scene is empty
    const planeGeo = new THREE.PlaneGeometry(20, 20);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.5; // Align with grid
    plane.name = 'basePlane';
    scene.add(plane);
}

// --- Animation Loop ---
function animate() {
    requestAnimationFrame(animate);

    if (gameState === 'playing') {
        const elapsed = (performance.now() - startTime) / 1000;
        document.getElementById('timer').innerText = elapsed.toFixed(2);
        updateMovingPlatforms();
        updateFollowCamera();
        if (isBalancing) {
            edgeTime += 0.016;
            document.getElementById('edge-time').innerText = edgeTime.toFixed(2);
        }
    }

    if (gameState !== 'playing') controls.update();
    renderer.render(scene, camera);

    if (gameState === 'playing' && minimapRenderer && minimapCamera) {
        minimapCamera.position.x = player.position.x;
        minimapCamera.position.z = player.position.z;
        minimapRenderer.render(scene, minimapCamera);
    }
}

function updateFollowCamera() {
    if (!player) return;
    const offset = new THREE.Vector3(8, 8, 8);
    const targetPos = player.position.clone().add(offset);
    camera.position.lerp(targetPos, 0.1);
    camera.lookAt(player.position);
}

function updateMovingPlatforms() {
    movingPlatforms.forEach(p => {
        const data = p.userData;
        data.progress += data.speed * data.direction;
        if (data.progress >= 1 || data.progress <= 0) {
            data.direction *= -1;
        }
        const oldPos = p.position.clone();
        p.position.lerpVectors(data.startPos, data.endPos, data.progress);

        // If player is on top, move player
        if (player && !isMoving) {
            const dist = player.position.clone().sub(p.position);
            if (Math.abs(dist.x) < 0.6 && Math.abs(dist.z) < 0.6 && Math.abs(dist.y - 1) < 0.1) {
                const delta = p.position.clone().sub(oldPos);
                player.position.add(delta);
            }

            // Crush Logic
            if (Math.abs(dist.x) < 0.8 && Math.abs(dist.z) < 0.8 && Math.abs(dist.y) < 0.8) {
                // Player is inside the platform (crushed)
                player.position.copy(spawnPos);
            }
        }
    });
}

// --- Audio System ---
function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
    initAudio();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    switch (type) {
        case 'roll':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
            break;
        case 'climb':
            osc.type = 'square';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
            break;
        case 'prism':
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(1200, now + 0.2);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now);
            osc.stop(now + 0.2);
            break;
        case 'switch':
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now);
            osc.stop(now + 0.05);
            break;
        case 'fall':
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 1);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.linearRampToValueAtTime(0, now + 1);
            osc.start(now);
            osc.stop(now + 1);
            break;
    }
}

function fadeTransition(callback) {
    const overlay = document.getElementById('fade-overlay');
    overlay.style.opacity = 1;
    setTimeout(() => {
        callback();
        overlay.style.opacity = 0;
    }, 500);
}

init();
