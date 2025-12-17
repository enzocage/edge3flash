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

let startTime = 0;
let spawnPos = new THREE.Vector3(0, 1, 0);
let prisms = [];
let collectedPrisms = 0;
let movingPlatforms = [];
let switches = [];
let ghostBlocks = [];

let currentTool = 'brush';
let currentBlockType = 'normal';
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let ghostBlock;

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

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);

    document.getElementById('load-btn').onclick = () => document.getElementById('level-input').click();
    document.getElementById('level-input').onchange = loadLevel;

    animate();
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
            addBlock(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z), currentBlockType);
        } else if (currentTool === 'eraser') {
            if (intersect.object.type === 'Mesh' && intersect.object !== player && intersect.object.name !== 'basePlane') {
                removeBlock(intersect.object);
            }
        }
    }
}

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
}

function removeBlock(mesh) {
    const key = `${mesh.position.x},${mesh.position.y},${mesh.position.z}`;
    delete levelData[key];
    const prismIndex = prisms.indexOf(mesh);
    if (prismIndex > -1) prisms.splice(prismIndex, 1);
    scene.remove(mesh);
}

window.setTool = (tool) => {
    currentTool = tool;
};

window.setBlockType = (type) => {
    currentBlockType = type;
};

window.saveLevel = () => {
    const blocks = [];
    // Collect all meshes that are part of the level
    scene.traverse(child => {
        if (child.isMesh && child.userData.type && child !== player && child.name !== 'basePlane') {
            blocks.push({
                type: child.userData.type,
                pos: [child.position.x, child.position.y, child.position.z]
            });
        }
    });
    const level = {
        metadata: { name: "New Level", author: "Player" },
        blocks: blocks
    };
    const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level.json';
    a.click();
};

function onKeyDown(event) {
    if (gameState !== 'playing' || isMoving) return;

    let dir = new THREE.Vector3();
    switch (event.key) {
        case 'ArrowUp': case 'w': dir.set(0, 0, -1); break;
        case 'ArrowDown': case 's': dir.set(0, 0, 1); break;
        case 'ArrowLeft': case 'a': dir.set(-1, 0, 0); break;
        case 'ArrowRight': case 'd': dir.set(1, 0, 0); break;
        default: return;
    }

    // Check for climbing
    const targetPos = player.position.clone().add(dir);
    const obstacleKey = `${targetPos.x},${targetPos.y},${targetPos.z}`;
    const aboveObstacleKey = `${targetPos.x},${targetPos.y + 1},${targetPos.z}`;

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
            // Snap to grid
            player.position.set(Math.round(targetPosition.x), Math.round(targetPosition.y), Math.round(targetPosition.z));
            isMoving = false;
            checkPhysics();
        }
    }

    animateRoll();
}

function checkPhysics() {
    const key = `${player.position.x},${player.position.y - 1},${player.position.z}`;
    const floor = levelData[key];
    
    if (floor && floor.userData.type === 'end') {
        alert(`Level Complete! Time: ${document.getElementById('timer').innerText}s`);
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

    // Check switches
    let stateChanged = false;
    switches.forEach(s => {
        const dist = player.position.distanceTo(s.position);
        if (dist < 0.6) {
            if (!s.userData.active) {
                s.userData.active = true;
                s.material.color.set(0x00ff00);
                stateChanged = true;
            }
        } else {
            if (s.userData.active) {
                s.userData.active = false;
                s.material.color.set(0xffff00);
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
            document.getElementById('prisms').innerText = collectedPrisms;
        }
    }
}

function toggleShrink() {
    isShrunk = !isShrunk;
    const scale = isShrunk ? 0.5 : 1.0;
    player.scale.set(scale, scale, scale);
    // Adjust position so it doesn't sink into floor
    player.position.y = isShrunk ? player.position.y - 0.25 : Math.round(player.position.y);
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

// --- Game Logic ---
window.loadLevelFromFile = () => {
    document.getElementById('level-input').click();
};

window.startGame = () => {
    gameState = 'playing';
    document.getElementById('menu').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    setupLevel();
};

window.startEditor = () => {
    gameState = 'editor';
    document.getElementById('menu').style.display = 'none';
    document.getElementById('editor-ui').style.display = 'block';
    controls.enabled = true;
    setupEditor();
};

window.exitToMenu = () => {
    gameState = 'menu';
    document.getElementById('menu').style.display = 'block';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('editor-ui').style.display = 'none';
    controls.enabled = false;
    // Clear scene except lights
    while(scene.children.length > 2) {
        const child = scene.children[scene.children.length - 1];
        scene.remove(child);
    }
    ghostBlock = null;
    levelData = {};
};

function setupLevel() {
    // Placeholder for level loading
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
    for(let x = -2; x <= 2; x++) {
        for(let z = -2; z <= 2; z++) {
            const block = new THREE.Mesh(geo, mat);
            block.position.set(x, 0, z);
            block.receiveShadow = true;
            scene.add(block);
            levelData[`${x},0,${z}`] = block;
        }
    }

    // Player
    const playerGeo = new THREE.BoxGeometry(1, 1, 1);
    const playerMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    player = new THREE.Mesh(playerGeo, playerMat);
    player.position.set(0, 1, 0);
    player.castShadow = true;
    scene.add(player);
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
    }

    controls.update();
    renderer.render(scene, camera);
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
        }
    });
}

init();
