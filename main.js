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
let worldUp = new THREE.Vector3(0, 1, 0);
let isScouting = false;

let startTime = 0;
let spawnPos = new THREE.Vector3(0, 1, 0);
let prisms = [];
let collectedPrisms = 0;
let edgeTime = 0;
let isBalancing = false;
let movingPlatforms = [];
let switches = [];
let ghostBlocks = [];
let teleporters = [];
let lasers = [];
let trailMeshes = [];
let musicStarted = false;
let ghostRecording = [];
let ghostBestRun = null;
let ghostMesh = null;

let currentTool = 'brush';
let currentBlockType = 'normal';
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let ghostBlock;
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;
let isTransparent = false;

let audioCtx = null;
let noiseBuffer = null;
let prismConsecutiveCount = 0;
let lastSoundTime = 0;
let minimapRenderer, minimapCamera;
let keysPressed = new Set();

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
    window.addEventListener('mousedown', onMouseDown, true); // Use capture to enable controls before bubble
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('touchstart', () => {
        document.getElementById('mobile-controls').style.display = 'grid';
    }, { once: true });

    document.getElementById('load-btn').onclick = () => document.getElementById('level-input').click();
    document.getElementById('level-input').onchange = loadLevel;

    window.addEventListener('contextmenu', e => {
        if (gameState === 'playing') e.preventDefault();
    });

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
    movingPlatforms.forEach(p => scene.remove(p));
    movingPlatforms = [];
    switches.forEach(s => scene.remove(s));
    switches = [];
    ghostBlocks.forEach(g => scene.remove(g));
    ghostBlocks = [];
    teleporters.forEach(t => scene.remove(t));
    teleporters = [];
    lasers.forEach(l => {
        if (l.userData.beam) scene.remove(l.userData.beam);
        scene.remove(l);
    });
    lasers = [];
    trailMeshes.forEach(m => scene.remove(m));
    trailMeshes = [];
    if (player) scene.remove(player);
    if (ghostMesh) scene.remove(ghostMesh);
    ghostMesh = null;
    ghostRecording = [];
}

function spawnPlayer() {
    assemblePlayer();
}

function assemblePlayer() {
    const playerGeo = new THREE.BoxGeometry(1, 1, 1);
    const playerMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    player = new THREE.Mesh(playerGeo, playerMat);
    player.position.set(spawnPos.x, spawnPos.y + 5, spawnPos.z);
    player.castShadow = true;
    player.userData = { lastMove: null };
    scene.add(player);

    isMoving = true;
    const animateAssembly = () => {
        player.position.y -= 0.2;
        if (player.position.y <= spawnPos.y) {
            player.position.y = spawnPos.y;
            isMoving = false;
            cameraShake(0.1, 200);
            playSound('roll');
        } else {
            requestAnimationFrame(animateAssembly);
        }
    };
    animateAssembly();
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
    if (gameState === 'playing') {
        if (event.button === 0) { // LMB -> Instant Scout Start
            controls.enabled = true;
            isScouting = true;
            document.getElementById('hud').style.display = 'none';
        } else if (event.button === 2) { // RMB -> Instant Global X-Ray
            toggleTransparency(true);
        }
        return;
    }
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

function onMouseUp(event) {
    if (gameState === 'playing') {
        if (event.button === 0) { // Left Click Release -> Return to standard
            controls.enabled = false;
            isScouting = false;
            document.getElementById('hud').style.display = 'block';
        } else if (event.button === 2) { // Right Click Release -> Transparency Off
            toggleTransparency(false);
        }
        return;
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
    } else if (type === 'teleporter') {
        geo = new THREE.BoxGeometry(0.8, 0.1, 0.8);
        mat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'teleporter', target: null };
        teleporters.push(mesh);
        levelData[key] = mesh;
    } else if (type === 'fragile') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.8 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'fragile', timer: 0, broken: false };
        levelData[key] = mesh;
    } else if (type === 'oneway') {
        geo = new THREE.BoxGeometry(1, 0.1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0xff8800 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'oneway', direction: new THREE.Vector3(0, 0, -1) }; // Default North
        levelData[key] = mesh;
    } else if (type === 'ice') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'ice' };
        levelData[key] = mesh;
    } else if (type === 'bouncy') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'bouncy' };
        levelData[key] = mesh;
    } else if (type === 'explosive') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0xff4400 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'explosive', triggered: false };
        levelData[key] = mesh;
    } else if (type === 'laser') {
        geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        mat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'laser', active: true };
        lasers.push(mesh);
        levelData[key] = mesh;
    } else if (type === 'magnetic') {
        geo = new THREE.BoxGeometry(1, 1, 1);
        mat = new THREE.MeshStandardMaterial({ color: 0x444466, metalness: 1, roughness: 0.3 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'magnetic' };
        levelData[key] = mesh;
    } else if (type === 'gravity') {
        geo = new THREE.BoxGeometry(0.8, 0.2, 0.8);
        mat = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0x550055 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'gravity', axis: 'x' }; // Toggles gravity axis
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
    const teleporterIndex = teleporters.indexOf(mesh);
    if (teleporterIndex > -1) teleporters.splice(teleporterIndex, 1);
    const laserIndex = lasers.indexOf(mesh);
    if (laserIndex > -1) lasers.splice(laserIndex, 1);

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
    if (gameState !== 'playing' || isMoving || isScouting) return;
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
    const key = event.key.toLowerCase();
    if (gameState === 'editor') {
        // ... editor shortcuts ...
        if (key === '1') setBlockType('normal');
        if (key === '2') setBlockType('prism');
        if (key === '3') setBlockType('moving');
        if (key === '4') setBlockType('end');
        if (key === '5') setBlockType('switch');
        if (key === '6') setBlockType('ghost');
        if (key === '7') setBlockType('shrink');
        if (key === '8') setBlockType('checkpoint');
        if (key === 'b') setTool('brush');
        if (key === 'e') setTool('eraser');
        if (key === 'g') {
            const helper = scene.children.find(c => c instanceof THREE.GridHelper);
            if (helper) helper.visible = !helper.visible;
        }
    }

    if (key === 'p') togglePhotoMode();
    if (key === 'h') setAccessibilityMode();
    if (key === 't') toggleTransparency();

    if (gameState === 'playing') {
        const key = event.key.toLowerCase();
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
            keysPressed.add(key);
        }
    }
}

window.onKeyUp = (event) => {
    keysPressed.delete(event.key.toLowerCase());
};
window.addEventListener('keyup', window.onKeyUp);

let balancingDir = null;
function handleContinuousInput() {
    if (isMoving) return;

    let dir = new THREE.Vector3();
    let key = '';
    if (keysPressed.has('w') || keysPressed.has('arrowup')) { dir.set(0, 0, -1); key = 'w'; }
    else if (keysPressed.has('s') || keysPressed.has('arrowdown')) { dir.set(0, 0, 1); key = 's'; }
    else if (keysPressed.has('a') || keysPressed.has('arrowleft')) { dir.set(-1, 0, 0); key = 'a'; }
    else if (keysPressed.has('d') || keysPressed.has('arrowright')) { dir.set(1, 0, 0); key = 'd'; }

    if (isBalancing) {
        // If we were balancing on a direction and the key is released -> fall
        // If a NEW direction is pressed while balancing -> roll that way (handled by processMove below)
        if (dir.length() === 0 || (balancingDir && dir.dot(balancingDir) < 0.9)) {
            isBalancing = false;
            player.rotation.set(0, 0, 0);
            fall();
            return;
        }
    }

    if (dir.length() > 0 && !isBalancing) {
        processMove(dir);
    }
}
function processMove(dir) {
    const targetPos = player.position.clone().add(dir);
    const tx = Math.round(targetPos.x);
    const ty = Math.round(targetPos.y);
    const tz = Math.round(targetPos.z);

    const obstacleKey = `${tx},${ty},${tz}`;
    const aboveObstacleKey = `${tx},${ty + 1},${tz}`;

    // One-Way Path Validation
    const floorKey = `${tx},${ty - 1},${tz}`;
    const floor = levelData[floorKey];
    if (floor && floor.userData.type === 'oneway') {
        const allowedDir = floor.userData.direction;
        if (dir.dot(allowedDir) < 0.9) { // Must be same direction
            return; // Move blocked
        }
    }

    if (levelData[obstacleKey] && !levelData[aboveObstacleKey]) {
        climbCube(dir);
    } else if (!levelData[obstacleKey]) {
        rollCube(dir);
    }
}

function climbCube(direction) {
    if (isBalancing) {
        player.position.set(Math.round(player.position.x), Math.round(player.position.y), Math.round(player.position.z));
        player.rotation.set(0, 0, 0);
        isBalancing = false;
    }
    isMoving = true;
    const pivot = player.position.clone().add(direction.clone().multiplyScalar(0.5)).add(new THREE.Vector3(0, 0.5, 0));
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();

    const startRotation = player.quaternion.clone();
    const startPosition = player.position.clone();
    const targetPosition = player.position.clone().add(direction).add(new THREE.Vector3(0, 1, 0));

    let progress = 0;
    const duration = 150;
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
            player.rotation.set(0, 0, 0);
            isMoving = false;
            player.userData.lastMove = direction.clone();
            playSound('climb');
            checkPhysics();
        }
    }
    animateClimb();
}

function rollCube(direction) {
    if (isBalancing) {
        player.position.set(Math.round(player.position.x), Math.round(player.position.y), Math.round(player.position.z));
        player.rotation.set(0, 0, 0);
        isBalancing = false;
    }
    isMoving = true;

    // Pivot point is the edge in the direction of movement
    const pivot = player.position.clone().add(direction.clone().multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.5, 0));
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();

    const startRotation = player.quaternion.clone();
    const targetRotation = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2).multiply(startRotation);

    const startPosition = player.position.clone();
    const targetPosition = player.position.clone().add(direction);

    let progress = 0;
    const duration = 150; // ms
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
                    player.rotation.set(0, 0, 0);
                    isBalancing = false;
                    fall();
                } else {
                    // Enter balancing state
                    isBalancing = true;
                    player.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
                    // 45 degree tilt
                    if (direction.x !== 0) player.rotation.z = direction.x * Math.PI / 4;
                    if (direction.z !== 0) player.rotation.x = -direction.z * Math.PI / 4;
                    isMoving = false;
                    isBalancing = true;
                    balancingDir = direction.clone();
                    playSound('roll');
                }
            } else {
                // Snap to grid
                player.position.set(tx, ty, tz);
                player.rotation.set(0, 0, 0); // Reset tilt
                isMoving = false;
                isBalancing = false;
                player.userData.lastMove = direction.clone();
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
        const rawTime = (performance.now() - startTime) / 1000;
        const bonus = edgeTime; // Edge time reduces official time
        const finalTime = Math.max(0, rawTime - bonus).toFixed(2);

        // Count total prisms in level
        let totalPrisms = 0;
        scene.traverse(c => { if (c.userData.type === 'prism') totalPrisms++; });
        // Since collected ones are removed, we should have a level-wide constant or count at start
        // For now, let's assume 'prisms' global is the count.

        let rank = 'C';
        if (finalTime < 30 && collectedPrisms >= totalPrisms + collectedPrisms) rank = 'S';
        else if (finalTime < 60) rank = 'A';
        else if (finalTime < 90) rank = 'B';

        playSound('victory');
        setTimeout(() => {
            alert(`Level Complete!\nTime: ${rawTime.toFixed(2)}s\nBonus: -${bonus.toFixed(2)}s\nFinal Time: ${finalTime}s\nRank: ${rank}\nPrisms: ${collectedPrisms}`);

            // Save Progress
            const currentLevelIndex = BUILT_IN_LEVELS.findIndex(l => l.active);
            if (currentLevelIndex !== -1) {
                if (!unlockedLevels.includes(currentLevelIndex + 1)) {
                    unlockedLevels.push(currentLevelIndex + 1);
                    localStorage.setItem('unlockedLevels', JSON.stringify(unlockedLevels));
                }
                if (!highScores[currentLevelIndex] || finalTime < highScores[currentLevelIndex].time) {
                    highScores[currentLevelIndex] = { time: finalTime, rank: rank };
                    localStorage.setItem('highScores', JSON.stringify(highScores));
                    localStorage.setItem(`ghost_${currentLevelIndex}`, JSON.stringify(ghostRecording));
                }
            }
            exitToMenu();
        }, 100);
        return;
    }

    if (!floor) {
        fall();
    } else {
        const type = floor.userData.type;
        if (type === 'shrink') toggleShrink();
        else if (type === 'checkpoint') {
            if (!floor.userData.active) {
                floor.userData.active = true;
                floor.material.color.set(0x00ffff);
                spawnPos.copy(floor.position).add(new THREE.Vector3(0, 1, 0));
            }
        } else if (type === 'teleporter') {
            const other = teleporters.find(t => t !== floor);
            if (other) {
                fadeTransition(() => {
                    player.position.copy(other.position).add(new THREE.Vector3(0, 1, 0));
                    checkPhysics();
                });
                return;
            }
        } else if (type === 'fragile') {
            if (!floor.userData.broken) {
                floor.userData.broken = true;
                floor.material.opacity = 0.4;
                setTimeout(() => {
                    removeBlock(floor);
                    if (player.position.distanceTo(floor.position.clone().add(new THREE.Vector3(0, 1, 0))) < 0.5) fall();
                }, 1000);
            }
        } else if (type === 'ice') {
            const lastMove = player.userData.lastMove;
            if (lastMove) setTimeout(() => processMove(lastMove), 100);
        } else if (type === 'bouncy') {
            isMoving = true;
            const targetY = player.position.y + 2;
            const bounceAnim = () => {
                player.position.y += 0.15;
                if (player.position.y >= targetY) fall();
                else requestAnimationFrame(bounceAnim);
            };
            bounceAnim();
        } else if (type === 'explosive') {
            if (!floor.userData.triggered) {
                floor.userData.triggered = true;
                floor.material.color.set(0xffffff);
                setTimeout(() => triggerExplosion(floor.position), 500);
            }
        } else if (type === 'gravity') {
            if (!floor.userData.active) {
                floor.userData.active = true;
                rotateGravity();
                setTimeout(() => floor.userData.active = false, 2000); // Reset after 2s
            }
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

    // Infinite gen check
    if (player.position.z > lastGeneratedZ - 10) {
        generateChunk(lastGeneratedZ);
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
        playSound('shrink');
    } else {
        player.position.y = Math.round(player.position.y);
        playSound('grow');
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
            player.rotation.set(0, 0, 0);
            isMoving = false;
        } else {
            const key = `${Math.round(player.position.x)},${Math.floor(player.position.y - 0.5)},${Math.round(player.position.z)}`;
            if (levelData[key]) {
                player.position.y = Math.round(player.position.y);
                player.rotation.set(0, 0, 0);
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

window.togglePhotoMode = () => {
    if (gameState !== 'playing') return;
    const isPaused = controls.enabled;
    controls.enabled = !isPaused;
    isMoving = !isPaused;

    // Smooth camera transition: when entering, we stop autolock
    // When leaving, we let updateFollowCamera lerp back
    document.getElementById('hud').style.display = isPaused ? 'block' : 'none';
};

window.toggleTransparency = (forceState) => {
    isTransparent = (forceState !== undefined) ? forceState : !isTransparent;
    scene.traverse(child => {
        // Target everything except player and grid
        if (child.isMesh && child !== player && child.name !== 'basePlane' && !(child instanceof THREE.GridHelper)) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (mat.userData.origOpacity === undefined) {
                    mat.userData.origOpacity = mat.opacity;
                    mat.userData.origTransparent = mat.transparent;
                    mat.userData.origDepthWrite = mat.depthWrite;
                }

                if (isTransparent) {
                    mat.transparent = true;
                    mat.opacity = 0.2;
                    mat.depthWrite = false;
                } else {
                    mat.transparent = mat.userData.origTransparent;
                    mat.opacity = mat.userData.origOpacity;
                    mat.depthWrite = mat.userData.origDepthWrite;
                }
            });
        }
    });
};

let highContrast = false;
window.setAccessibilityMode = () => {
    highContrast = !highContrast;
    scene.background = new THREE.Color(highContrast ? 0x000000 : 0x111111);
    scene.traverse(child => {
        if (child.isMesh && child.userData.type === 'normal') {
            child.material.color.set(highContrast ? 0x00ff00 : 0x888888);
        }
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
            ${highScores[i] ? `<div style="font-size: 10px; color: var(--accent);">Best: ${highScores[i].time}s (${highScores[i].rank})</div>` : ''}
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
    startAmbientMusic();
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
        spawnPos.set(0, 1, 0);
        spawnPlayer();

        // Spawn Ghost
        const levelKey = `ghost_${index}`;
        ghostBestRun = JSON.parse(localStorage.getItem(levelKey));
        if (ghostBestRun) {
            const gGeo = new THREE.BoxGeometry(1, 1, 1);
            const gMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
            ghostMesh = new THREE.Mesh(gGeo, gMat);
            scene.add(ghostMesh);
        }

        startTime = performance.now();
        collectedPrisms = 0;
        document.getElementById('prisms').innerText = '0';
        ghostRecording = [];
    });
}

let lastGeneratedZ = 0;
window.startInfiniteMode = () => {
    startAmbientMusic();
    fadeTransition(() => {
        gameState = 'playing';
        document.getElementById('menu').style.display = 'none';
        document.getElementById('hud').style.display = 'block';
        document.getElementById('minimap-container').style.display = 'block';

        clearScene();
        lastGeneratedZ = 0;
        spawnPos.set(0, 1, 0);
        spawnPlayer();
        generateChunk(0);
        generateChunk(10);
        startTime = performance.now();
    });
};

function generateChunk(zOffset) {
    for (let x = -3; x <= 3; x++) {
        for (let z = 0; z < 10; z++) {
            if (Math.random() > 0.4) {
                const type = Math.random() > 0.95 ? 'prism' : 'normal';
                addBlock(x, 0, z + zOffset, type);
            }
        }
    }
    lastGeneratedZ = zOffset + 10;
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
        updateGamepad();
        handleContinuousInput();

        const elapsed = (performance.now() - startTime) / 1000;
        document.getElementById('timer').innerText = elapsed.toFixed(2);
        updateMovingPlatforms();
        updateFollowCamera();
        updateLasers();
        updateTrails();

        // Ghost Recording
        if (player && !isMoving) {
            ghostRecording.push({ t: elapsed, p: player.position.clone(), r: player.rotation.clone() });
        }
        // Ghost Replay
        if (ghostMesh && ghostBestRun) {
            const frame = ghostBestRun.find(f => f.t >= elapsed);
            if (frame) {
                ghostMesh.position.lerp(frame.p, 0.1);
                ghostMesh.rotation.set(frame.r.x, frame.r.y, frame.r.z);
            }
        }

        // Edge Time Feedback
        if (isBalancing) {
            edgeTime += 0.016;
            document.getElementById('edge-time').innerText = edgeTime.toFixed(2);
            if (player && player.material) {
                const pulse = (Math.sin(performance.now() * 0.01) + 1) * 0.5;
                player.material.emissive.setHex(0x00ffff);
                player.material.emissiveIntensity = pulse;
            }
            // Rhythmic ticking during balancing
            if (performance.now() - lastSoundTime > 200) {
                playSound('balance');
                lastSoundTime = performance.now();
            }
        } else {
            if (player && player.material) {
                player.material.emissiveIntensity = 0;
            }
        }
    }

    if (gameState !== 'playing' || controls.enabled) controls.update();
    renderer.render(scene, camera);

    if (gameState === 'playing' && minimapRenderer && minimapCamera) {
        minimapCamera.position.x = player.position.x;
        minimapCamera.position.z = player.position.z;
        minimapRenderer.render(scene, minimapCamera);
    }
}

function updateFollowCamera() {
    if (!player) return;

    if (controls.enabled) {
        controls.target.copy(player.position);
        return;
    }

    // Standard Perspective
    const offset = new THREE.Vector3(8, 8, 8);
    const targetPos = player.position.clone().add(offset);
    camera.position.lerp(targetPos, 0.08); // Slightly faster lerp for snap-back

    // Smoothly turn back to look at player
    const targetQuaternion = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    m.lookAt(camera.position, player.position, worldUp);
    targetQuaternion.setFromRotationMatrix(m);
    camera.quaternion.slerp(targetQuaternion, 0.1);
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

    // Create White Noise Buffer
    const bufferSize = audioCtx.sampleRate * 2;
    noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
}

function playSound(type) {
    initAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    const createEnvelope = (target, a, d, s, r, peak = 0.3) => {
        target.setValueAtTime(0, now);
        target.linearRampToValueAtTime(peak, now + a);
        target.linearRampToValueAtTime(s * peak, now + a + d);
        target.linearRampToValueAtTime(0, now + a + d + r);
    };

    const playNoiseImpact = (vol = 0.1, duration = 0.05, filterFreq = 1000) => {
        const noise = audioCtx.createBufferSource();
        noise.buffer = noiseBuffer;
        const filter = audioCtx.createBiquadFilter();
        const nGain = audioCtx.createGain();
        filter.type = 'lowpass';
        filter.frequency.value = filterFreq;
        noise.connect(filter);
        filter.connect(nGain);
        nGain.connect(audioCtx.destination);
        createEnvelope(nGain.gain, 0.001, duration, 0, 0.01, vol);
        noise.start(now);
        noise.stop(now + duration + 0.1);
    };

    const mainOsc = audioCtx.createOscillator();
    const mainGain = audioCtx.createGain();
    const mainFilter = audioCtx.createBiquadFilter();
    mainOsc.connect(mainFilter);
    mainFilter.connect(mainGain);
    mainGain.connect(audioCtx.destination);

    switch (type) {
        case 'roll':
            playNoiseImpact(0.1, 0.02, 1200); // Sharp click
            mainOsc.type = 'square'; // Added bite
            mainOsc.frequency.setValueAtTime(80, now);
            mainOsc.frequency.exponentialRampToValueAtTime(40, now + 0.05);
            createEnvelope(mainGain.gain, 0, 0.04, 0, 0.01, 0.3);
            mainOsc.start(now);
            mainOsc.stop(now + 0.05);
            break;
        case 'climb':
            mainOsc.type = 'square';
            mainOsc.frequency.setValueAtTime(150, now);
            mainOsc.frequency.exponentialRampToValueAtTime(400, now + 0.15);
            createEnvelope(mainGain.gain, 0.01, 0.1, 0.2, 0.05, 0.2);
            mainOsc.start(now);
            mainOsc.stop(now + 0.2);
            break;
        case 'balance':
            mainOsc.type = 'sine';
            mainOsc.frequency.setValueAtTime(2000, now); // Higher glassy chime
            createEnvelope(mainGain.gain, 0.001, 0.03, 0, 0.05, 0.15);
            mainOsc.start(now);
            mainOsc.stop(now + 0.1);
            break;
        case 'fall':
            mainOsc.type = 'sawtooth';
            mainOsc.frequency.setValueAtTime(400, now);
            mainOsc.frequency.exponentialRampToValueAtTime(30, now + 1.2);
            createEnvelope(mainGain.gain, 0.1, 0.8, 0, 0.3, 0.3);
            mainOsc.start(now);
            mainOsc.stop(now + 1.2);
            // Finish with a digital pop
            setTimeout(() => playNoiseImpact(0.2, 0.1, 2000), 1100);
            break;
        case 'rank':
            mainOsc.type = 'square';
            mainOsc.frequency.setValueAtTime(800, now);
            createEnvelope(mainGain.gain, 0.001, 0.05, 0, 0.01, 0.1);
            mainOsc.start(now);
            mainOsc.stop(now + 0.06);
            break;
        case 'prism':
            prismConsecutiveCount++;
            const freq = 600 + (prismConsecutiveCount % 8) * 150;
            mainOsc.type = 'sine';
            mainOsc.frequency.setValueAtTime(freq, now);
            mainOsc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.1);
            createEnvelope(mainGain.gain, 0.005, 0.2, 0, 0.1, 0.2);
            mainOsc.start(now);
            mainOsc.stop(now + 0.4);
            // reset count after gap
            clearTimeout(window.prismReset);
            window.prismReset = setTimeout(() => prismConsecutiveCount = 0, 2000);
            break;
        case 'switch':
            mainOsc.type = 'sine';
            mainOsc.frequency.setValueAtTime(300, now);
            createEnvelope(mainGain.gain, 0.001, 0.05, 0, 0.01, 0.2);
            mainOsc.start(now);
            mainOsc.stop(now + 0.1);
            break;
        case 'teleport':
            mainFilter.type = 'bandpass';
            mainFilter.frequency.setValueAtTime(100, now);
            mainFilter.frequency.exponentialRampToValueAtTime(5000, now + 0.3);
            mainOsc.type = 'sawtooth';
            mainOsc.frequency.value = 200;
            createEnvelope(mainGain.gain, 0.1, 0.1, 0, 0.1, 0.15);
            mainOsc.start(now);
            mainOsc.stop(now + 0.3);
            break;
        case 'shrink':
            mainOsc.type = 'sine';
            mainOsc.frequency.setValueAtTime(400, now);
            mainOsc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);
            createEnvelope(mainGain.gain, 0.01, 0.1, 0, 0.1, 0.2);
            mainOsc.start(now);
            mainOsc.stop(now + 0.2);
            break;
        case 'grow':
            mainOsc.type = 'sine';
            mainOsc.frequency.setValueAtTime(1000, now);
            mainOsc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
            createEnvelope(mainGain.gain, 0.01, 0.1, 0, 0.1, 0.2);
            mainOsc.start(now);
            mainOsc.stop(now + 0.2);
            break;
        case 'victory':
            [440, 554.37, 659.25].forEach((f, i) => {
                const o = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                o.type = 'triangle';
                o.frequency.value = f;
                o.connect(g);
                g.connect(audioCtx.destination);
                createEnvelope(g.gain, 0.05, 0.5, 0, 0.5, 0.1);
                o.start(now + i * 0.05);
                o.stop(now + 1.5);
            });
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

function updateLasers() {
    lasers.forEach(l => {
        if (!l.userData.active) return;
        // Create a visual beam if not exists
        if (!l.userData.beam) {
            const beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 20);
            const beamMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
            const beam = new THREE.Mesh(beamGeo, beamMat);
            beam.rotation.x = Math.PI / 2;
            beam.position.z = 10;
            l.add(beam);
            l.userData.beam = beam;
        }
        // Collision check
        const playerPos = player.position.clone();
        const laserPos = l.position.clone();
        const dist = playerPos.sub(laserPos);
        if (Math.abs(dist.x) < 0.3 && Math.abs(dist.y) < 0.3 && dist.z > 0 && dist.z < 20) {
            player.position.copy(spawnPos);
            cameraShake(0.5, 500);
        }
    });
}

function triggerExplosion(pos) {
    cameraShake(0.8, 400);
    playSound('fall');
    // Radial destruction
    const radius = 2;
    const keys = Object.keys(levelData);
    keys.forEach(key => {
        const m = levelData[key];
        if (m.position.distanceTo(pos) < radius && m.userData.type !== 'end') {
            removeBlock(m);
        }
    });
    // Push player
    if (player.position.distanceTo(pos) < radius) {
        player.position.y += 2;
        fall();
    }
}

function updateTrails() {
    if (!player || isMoving) return;
    const pos = player.position.clone();
    if (trailMeshes.length > 20) {
        const old = trailMeshes.shift();
        scene.remove(old);
    }
    const tGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const tMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    const tMesh = new THREE.Mesh(tGeo, tMat);
    tMesh.position.copy(pos);
    scene.add(tMesh);
    trailMeshes.push(tMesh);

    trailMeshes.forEach((m, i) => {
        m.scale.multiplyScalar(0.95);
        m.material.opacity *= 0.9;
        if (m.material.opacity < 0.05) {
            scene.remove(m);
            trailMeshes.splice(i, 1);
        }
    });
}

function startAmbientMusic() {
    if (musicStarted) return;
    musicStarted = true;
    initAudio();

    const playNote = (freq, time, length) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.05, time + 0.5);
        gain.gain.linearRampToValueAtTime(0, time + length);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(time);
        osc.stop(time + length);
    };

    const loop = () => {
        const now = audioCtx.currentTime;
        const scale = [261.63, 329.63, 392.00, 523.25]; // C Major
        for (let i = 0; i < 4; i++) {
            playNote(scale[Math.floor(Math.random() * scale.length)], now + i * 2, 4);
        }
        setTimeout(loop, 8000);
    };
    loop();
}

function cameraShake(intensity = 0.2, duration = 500) {
    const startTime = performance.now();
    function shake() {
        const elapsed = performance.now() - startTime;
        if (elapsed < duration) {
            const factor = 1 - (elapsed / duration);
            camera.position.x += (Math.random() - 0.5) * intensity * factor;
            camera.position.y += (Math.random() - 0.5) * intensity * factor;
            requestAnimationFrame(shake);
        }
    }
    shake();
}

function updateGamepad() {
    const gamepads = navigator.getGamepads();
    if (!gamepads[0]) return;
    const gp = gamepads[0];
    if (isMoving) return;

    // DPAD or Left Stick
    const threshold = 0.5;
    let dir = new THREE.Vector3();
    if (gp.axes[1] < -threshold || gp.buttons[12].pressed) dir.set(0, 0, -1);
    else if (gp.axes[1] > threshold || gp.buttons[13].pressed) dir.set(0, 0, 1);
    else if (gp.axes[0] < -threshold || gp.buttons[14].pressed) dir.set(-1, 0, 0);
    else if (gp.axes[0] > threshold || gp.buttons[15].pressed) dir.set(1, 0, 0);

    if (dir.length() > 0) processMove(dir);

    // Buttons
    if (gp.buttons[0].pressed && !isMoving) { /* Jump or similar? */ }
}

window.exportToSTL = () => {
    let stl = "solid EdgeLevel\n";
    scene.traverse(child => {
        if (child.isMesh && child.userData.type && child !== player && child.name !== 'basePlane') {
            const p = child.position;
            // Add a simple box to STL per block
            stl += `  facet normal 0 0 0\n    outer loop\n`;
            stl += `      vertex ${p.x - 0.5} ${p.y - 0.5} ${p.z - 0.5}\n`;
            stl += `      vertex ${p.x + 0.5} ${p.y - 0.5} ${p.z - 0.5}\n`;
            stl += `      vertex ${p.x + 0.5} ${p.y + 0.5} ${p.z - 0.5}\n`;
            stl += `    endloop\n  endfacet\n`;
            // (Simplified 1-facet representation for demonstration)
        }
    });
    stl += "endsolid EdgeLevel\n";
    const blob = new Blob([stl], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "level.stl";
    a.click();
};

function rotateGravity() {
    fadeTransition(() => {
        const axis = new THREE.Vector3(1, 0, 0);
        worldUp.applyAxisAngle(axis, Math.PI / 2);
        cameraShake(0.5, 500);
        playSound('switch');
    });
}

window.generateRandomLevel = () => {
    clearScene();
    setupEditor();

    const width = 30;
    const depth = 30;
    const grid = [];
    const heights = [];
    for (let x = 0; x < width; x++) {
        grid[x] = new Array(depth).fill(false);
        heights[x] = new Array(depth).fill(0);
    }

    // --- 1. 3D Maze Generation (Recursive Backtracker) ---
    const stack = [];
    let startX = 2, startZ = 2;
    grid[startX][startZ] = true;
    heights[startX][startZ] = 0;
    stack.push([startX, startZ]);

    while (stack.length > 0) {
        const [currX, currZ] = stack[stack.length - 1];
        const currY = heights[currX][currZ];
        const neighbors = [];
        const dirs = [[0, 2], [0, -2], [2, 0], [-2, 0]];

        dirs.forEach(([dx, dz]) => {
            const nx = currX + dx;
            const nz = currZ + dz;
            if (nx >= 0 && nx < width && nz >= 0 && nz < depth && !grid[nx][nz]) {
                neighbors.push([nx, nz, dx, dz]);
            }
        });

        if (neighbors.length > 0) {
            const [nx, nz, dx, dz] = neighbors[Math.floor(Math.random() * neighbors.length)];

            // Limit height change to +/- 1 for climbability
            let ny = currY + (Math.random() < 0.4 ? (Math.random() < 0.5 ? 1 : -1) : 0);
            ny = Math.max(0, Math.min(ny, 4));

            grid[nx][nz] = true;
            heights[nx][nz] = ny;

            // Connect with intermediate bridge block
            const midX = currX + dx / 2;
            const midZ = currZ + dz / 2;
            grid[midX][midZ] = true;
            heights[midX][midZ] = Math.round((currY + ny) / 2);

            stack.push([nx, nz]);
        } else {
            stack.pop();
        }
    }

    // --- 2. Convert Grid to Blocks with Support ---
    const offsetX = -width / 2;
    const offsetZ = -depth / 2;

    for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
            if (grid[x][z]) {
                const y = heights[x][z];
                addBlock(x + offsetX, y, z + offsetZ, 'normal');
                // Fill ground below for stability
                for (let sy = y - 1; sy >= 0; sy--) {
                    addBlock(x + offsetX, sy, z + offsetZ, 'normal');
                }
            }
        }
    }

    // --- 3. Place Start and End ---
    const sY = heights[startX][startZ];
    spawnPos.set(startX + offsetX, sY + 1, startZ + offsetZ);

    // Find a valid end point on the far side
    let endX = width - 4, endZ = depth - 4;
    while (endX > 0 && !grid[endX][endZ]) {
        endX--;
        if (endX <= 0) { endX = width - 2; endZ--; }
    }
    const eY = heights[endX][endZ];
    addBlock(endX + offsetX, eY, endZ + offsetZ, 'end');

    // --- 4. Sprinkle Hazards and Prisms ---
    const hazardTypes = ['laser', 'explosive', 'fragile', 'ice', 'bouncy', 'magnetic'];
    const interactives = ['teleporter', 'switch', 'shrink', 'checkpoint', 'moving'];

    for (let i = 0; i < 60; i++) {
        const rx = Math.floor(Math.random() * width);
        const rz = Math.floor(Math.random() * depth);
        if (grid[rx][rz]) {
            const h = heights[rx][rz];
            const x = rx + offsetX;
            const z = rz + offsetZ;

            const r = Math.random();
            if (r > 0.9 && (rx !== startX || rz !== startZ)) {
                const hType = hazardTypes[Math.floor(Math.random() * hazardTypes.length)];
                addBlock(x, h, z, hType);
            } else if (r > 0.8) {
                const iType = interactives[Math.floor(Math.random() * interactives.length)];
                const mesh = addBlock(x, h, z, iType);
                if (iType === 'moving' && mesh) {
                    mesh.userData.startPos = mesh.position.clone();
                    mesh.userData.endPos = mesh.position.clone().add(new THREE.Vector3(2, 0, 0));
                    mesh.userData.speed = 0.03;
                }
            } else if (r > 0.7) {
                addBlock(x, h + 1, z, 'prism');
            }
        }
    }

    cameraShake(0.5, 400);
    playSound('roll');
    console.log("3D Connected Maze Level Generated.");
};

init();
