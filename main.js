// --- START OF FILE main.js ---

let video = document.getElementById('webcam');
let canvas = document.getElementById('canvas');
let ctx = canvas.getContext('2d');
let scene, camera, renderer;
let shapes = [];
let currentShape = null; // For two-hand creation
let isPinching = false; // For two-hand creation state
let shapeScale = 1; // For two-hand creation scaling
let originalDistance = null; // For two-hand creation scaling
let selectedShape = null; // For single-hand move
let shapeCreatedThisPinch = false; // For two-hand creation cooldown
let lastShapeCreationTime = 0;
const shapeCreationCooldown = 1000; // Cooldown for two-hand creation

// --- New global variables for hand tracking interactions ---
let rightHandState = {
    isScaling: false,
    scalingShape: null,
    pinchThreshold: 0.07, // Adjusted for 2D normalized distance for right-hand pinch detection
};

const MIN_RIGHT_HAND_SCALE_PINCH_DIST = 0.025; // Normalized screen units (2D distance between thumb and index)
const MAX_RIGHT_HAND_SCALE_PINCH_DIST = 0.15;  // Normalized screen units
const MIN_SHAPE_SCALE_FACTOR = 0.3;          // Min scale for right-hand controlled shape
const MAX_SHAPE_SCALE_FACTOR = 2.5;          // Max scale

const LEFT_FINGER_TOUCH_BUFFER = 0.25; // World units, effective "radius" of the finger for touch

const initThree = () => {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 5;
  renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('three-canvas').appendChild(renderer.domElement);
  const light = new THREE.AmbientLight(0xffffff, 1); // Brighter ambient light
  scene.add(light);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);
  animate();
};

const animate = () => {
  requestAnimationFrame(animate);
  shapes.forEach(shape => {
    // Only rotate if not selected for move OR not being scaled by right hand
    if (shape !== selectedShape && shape !== rightHandState.scalingShape) {
      shape.rotation.x += 0.01;
      shape.rotation.y += 0.01;
    }
  });
  renderer.render(scene, camera);
};

const neonColors = [0xFF00FF, 0x00FFFF, 0xFF3300, 0x39FF14, 0xFF0099, 0x00FF00, 0xFF6600, 0xFFFF00];
let colorIndex = 0;

const getNextNeonColor = () => {
    const color = neonColors[colorIndex];
    colorIndex = (colorIndex + 1) % neonColors.length;
    return color;
};

const originalCreateRandomShape = createRandomShape; // Save original if already defined
createRandomShape = (position) => { // Ensure this is the one used
  const geometries = [
    new THREE.BoxGeometry(),
    new THREE.SphereGeometry(0.5, 32, 32),
    new THREE.ConeGeometry(0.5, 1, 32),
    new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
  ];
  const geometry = geometries[Math.floor(Math.random() * geometries.length)];
  const color = getNextNeonColor();
  const group = new THREE.Group();

  // Make material slightly less transparent for better visibility of color changes
  const material = new THREE.MeshStandardMaterial({ color: color, transparent: true, opacity: 0.75, roughness: 0.5, metalness: 0.1 });
  const fillMesh = new THREE.Mesh(geometry, material);

  const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
  const wireframeMesh = new THREE.Mesh(geometry, wireframeMaterial);

  group.add(fillMesh);
  group.add(wireframeMesh);
  group.position.copy(position);
  scene.add(group);

  shapes.push(group);

  // Add custom properties for new interactions
  group.wasTouchedByLeftHand = false;
  group.isSphere = geometry instanceof THREE.SphereGeometry;

  return group;
};

const get3DCoords = (normX, normY) => {
  const x = (normX - 0.5) * 10;
  const y = (0.5 - normY) * 10;
  return new THREE.Vector3(x, y, 0);
};

const isPinch = (landmarks) => { // Original 3D pinch detection
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return d(landmarks[4], landmarks[8]) < 0.06;
};

const areIndexFingersClose = (l, r) => { // 2D distance
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return d(l[8], r[8]) < 0.12;
};

const findNearestShape = (position) => {
  let minDist = Infinity;
  let closest = null;
  shapes.forEach(shape => {
    const dist = shape.position.distanceTo(position);
    // Adjusted threshold for finding nearest shape
    if (dist < 2.0 && dist < minDist) { // Increased detection radius slightly
      minDist = dist;
      closest = shape;
    }
  });
  return closest;
};

const isInRecycleBinZone = (position) => {
  const vector = position.clone().project(camera);
  const screenX = ((vector.x + 1) / 2) * window.innerWidth;
  const screenY = ((-vector.y + 1) / 2) * window.innerHeight;

  const binWidth = 160;
  const binHeight = 160;
  const binLeft = window.innerWidth - 60 - binWidth;
  const binTop = window.innerHeight - 60 - binHeight;
  const binRight = binLeft + binWidth;
  const binBottom = binTop + binHeight;

  const adjustedX = window.innerWidth - screenX; // Corrected for image flip if any

  return adjustedX >= binLeft && adjustedX <= binRight && screenY >= binTop && screenY <= binBottom;
};

const hands = new Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });

hands.onResults(results => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const recycleBin = document.getElementById('recycle-bin');

  // Draw landmarks (optional, for debugging)
  for (const landmarks of results.multiHandLandmarks) {
    const drawCircle = (landmark, color = 'rgba(0, 255, 255, 0.7)') => {
      ctx.beginPath();
      ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 10, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    };
    drawCircle(landmarks[4]); // Thumb tip
    drawCircle(landmarks[8], 'rgba(255, 0, 255, 0.7)'); // Index tip
  }

  let leftHandLandmarks = null;
  let rightHandLandmarks = null;
  let leftHandIndex = -1; // Store original index for robust fallback
  let rightHandIndex = -1;

  if (results.multiHandedness && results.multiHandLandmarks.length > 0) {
    for (let i = 0; i < results.multiHandedness.length; i++) {
      if (results.multiHandedness[i].label === "Left") {
        leftHandLandmarks = results.multiHandLandmarks[i];
        leftHandIndex = i;
      } else if (results.multiHandedness[i].label === "Right") {
        rightHandLandmarks = results.multiHandLandmarks[i];
        rightHandIndex = i;
      }
    }
  }
  // Fallback if no handedness info but two hands are detected (less reliable)
  if (results.multiHandLandmarks.length === 2 && (!leftHandLandmarks || !rightHandLandmarks)) {
      if (!leftHandLandmarks && !rightHandLandmarks) { 
        leftHandLandmarks = results.multiHandLandmarks[0];
        rightHandLandmarks = results.multiHandLandmarks[1];
      } else if (!leftHandLandmarks && rightHandIndex !== -1) { 
        leftHandLandmarks = results.multiHandLandmarks[1 - rightHandIndex];
      } else if (!rightHandLandmarks && leftHandIndex !== -1) { 
        rightHandLandmarks = results.multiHandLandmarks[1 - leftHandIndex];
      }
  }


  // --- Right Hand: Pinch to Scale Sphere ---
  if (rightHandLandmarks) {
    const thumbTip = rightHandLandmarks[4];
    const indexTip = rightHandLandmarks[8];
    const currentRightPinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y); // 2D distance
    const isRightPinching = currentRightPinchDist < rightHandState.pinchThreshold;

    if (isRightPinching) {
      if (!rightHandState.isScaling) { // Try to initiate scaling
        const rightHandPos3D = get3DCoords(indexTip.x, indexTip.y);
        let potentialShape = findNearestShape(rightHandPos3D);
        if (potentialShape && potentialShape.isSphere) {
          rightHandState.isScaling = true;
          rightHandState.scalingShape = potentialShape;
        }
      }
      
      if (rightHandState.isScaling && rightHandState.scalingShape) { // If successfully initiated or continuing
        let clampedPinchDist = Math.max(MIN_RIGHT_HAND_SCALE_PINCH_DIST, Math.min(MAX_RIGHT_HAND_SCALE_PINCH_DIST, currentRightPinchDist));
        let scaleRatio = (clampedPinchDist - MIN_RIGHT_HAND_SCALE_PINCH_DIST) / (MAX_RIGHT_HAND_SCALE_PINCH_DIST - MIN_RIGHT_HAND_SCALE_PINCH_DIST);
        scaleRatio = Math.max(0, Math.min(1, scaleRatio)); // Clamp 0-1

        let newScale = MIN_SHAPE_SCALE_FACTOR + scaleRatio * (MAX_SHAPE_SCALE_FACTOR - MIN_SHAPE_SCALE_FACTOR);
        rightHandState.scalingShape.scale.set(newScale, newScale, newScale);
      }
    } else { // Right hand not pinching
      if (rightHandState.isScaling) {
        rightHandState.isScaling = false;
        // Don't nullify scalingShape immediately, rotation might depend on it.
        // It will be naturally "unselected" if another interaction takes over or hand disappears.
      }
    }
  } else { // No right hand detected
    if (rightHandState.isScaling) {
      rightHandState.isScaling = false;
      // rightHandState.scalingShape = null; // Keep for rotation logic until no hands
    }
  }

  // --- Left Hand: Touch to Change Color ---
  if (leftHandLandmarks) {
    const leftIndexTipLandmark = leftHandLandmarks[8];
    const leftIndexTip3D = get3DCoords(leftIndexTipLandmark.x, leftIndexTipLandmark.y);

    shapes.forEach(shape => {
      if (!shape.children || !shape.children[0] || !shape.children[0].geometry || !shape.children[0].material) return;

      const shapeCenter = shape.position.clone();
      let shapeRadius = 0.5; // Default
      if (shape.children[0].geometry.boundingSphere) {
          shapeRadius = shape.children[0].geometry.boundingSphere.radius;
      }
      shapeRadius *= shape.scale.x; // Current scaled radius

      const distanceToFinger = shapeCenter.distanceTo(leftIndexTip3D);
      const isTouchingThisFrame = distanceToFinger < (shapeRadius + LEFT_FINGER_TOUCH_BUFFER);

      if (isTouchingThisFrame && !shape.wasTouchedByLeftHand) {
        if (shape.children[0].material.color) { // Check if color property exists
            shape.children[0].material.color.set(getNextNeonColor());
        }
        shape.wasTouchedByLeftHand = true;
      } else if (!isTouchingThisFrame && shape.wasTouchedByLeftHand) {
        shape.wasTouchedByLeftHand = false;
      }
    });
  }

  // --- Existing Two-Hand Pinch for Shape Creation ---
  if (leftHandLandmarks && rightHandLandmarks) {
    const l = leftHandLandmarks;
    const r = rightHandLandmarks;
    const leftPinchDetected = isPinch(l); // Uses original 3D isPinch
    const rightPinchDetected = isPinch(r);
    const indexFingersClose = areIndexFingersClose(l, r);

    if (leftPinchDetected && rightPinchDetected && !rightHandState.isScaling) { // Don't create if right hand is busy scaling
      const leftFingerTip = l[8];
      const rightFingerTip = r[8];
      const centerX = (leftFingerTip.x + rightFingerTip.x) / 2;
      const centerY = (leftFingerTip.y + rightFingerTip.y) / 2;
      const distance = Math.hypot(leftFingerTip.x - rightFingerTip.x, leftFingerTip.y - rightFingerTip.y);

      if (!isPinching) { // Global two-hand pinch state
        const now = Date.now();
        if (!shapeCreatedThisPinch && indexFingersClose && now - lastShapeCreationTime > shapeCreationCooldown) {
          currentShape = createRandomShape(get3DCoords(centerX, centerY));
          lastShapeCreationTime = now;
          shapeCreatedThisPinch = true;
          originalDistance = distance;
          isPinching = true; // Set two-hand pinch state
        }
      } else if (currentShape && originalDistance && originalDistance > 0.001) {
        shapeScale = distance / originalDistance;
        currentShape.scale.set(shapeScale, shapeScale, shapeScale);
      }
      // If isPinching is true, other gestures might be suppressed for this frame.
      recycleBin.classList.remove('active');
      if (selectedShape === currentShape) selectedShape = null;
    } else {
      // If conditions for two-hand pinch aren't met (or right hand is scaling)
      if (isPinching) { // If it *was* pinching, now release
        isPinching = false;
        shapeCreatedThisPinch = false;
        originalDistance = null;
        // currentShape = null; // Cleared below if !isPinching
      }
    }
  } else { // Not enough hands for two-hand gesture
    if (isPinching) {
        isPinching = false;
        shapeCreatedThisPinch = false;
        originalDistance = null;
    }
  }
  
  if (!isPinching) { // If two-hand gesture is not active
      currentShape = null; 
  }

  // --- Single-Hand Pinch for Selection and Movement ---
  if (!isPinching) { // Only if not doing two-hand creation/scale
    let handForSinglePinch = null;
    let handLandmarksForSinglePinch = null;

    if (leftHandLandmarks && isPinch(leftHandLandmarks)) { // isPinch is original 3D
        handForSinglePinch = "Left";
        handLandmarksForSinglePinch = leftHandLandmarks;
    } else if (rightHandLandmarks && isPinch(rightHandLandmarks) && !rightHandState.isScaling) {
        // Right hand can select/move ONLY IF it's not currently scaling a sphere.
        handForSinglePinch = "Right";
        handLandmarksForSinglePinch = rightHandLandmarks;
    }

    if (handLandmarksForSinglePinch) {
        const indexTip = handLandmarksForSinglePinch[8];
        const position3D = get3DCoords(indexTip.x, indexTip.y);

        if (!selectedShape) { 
            selectedShape = findNearestShape(position3D);
        }

        if (selectedShape) {
            selectedShape.position.copy(position3D);
            const inBin = isInRecycleBinZone(selectedShape.position);
            selectedShape.children.forEach(child => {
                if (child.material && child.material.wireframe) {
                    child.material.color.set(inBin ? 0xff0000 : 0xffffff);
                }
            });
            recycleBin.classList.toggle('active', inBin);
        }
    } else { // No hand performing single-pinch selection/movement
        if (selectedShape && isInRecycleBinZone(selectedShape.position)) {
            if (selectedShape !== rightHandState.scalingShape) { // Don't delete if being scaled
                scene.remove(selectedShape);
                shapes = shapes.filter(s => s !== selectedShape);
            }
            selectedShape = null; 
        } else if (selectedShape) { // Pinch released, not in bin
            selectedShape = null;
        }
        if (!selectedShape) { // Ensure bin is inactive if no shape is selected or after deletion
            recycleBin.classList.remove('active');
        }
    }
  }

  // --- Final Cleanup if No Hands Detected At All ---
  if (results.multiHandLandmarks.length === 0) {
      if (selectedShape && isInRecycleBinZone(selectedShape.position)) {
          scene.remove(selectedShape);
          shapes = shapes.filter(s => s !== selectedShape);
      }
      selectedShape = null;
      recycleBin.classList.remove('active');
      
      if (rightHandState.isScaling) {
          rightHandState.isScaling = false;
          rightHandState.scalingShape = null; 
      }
      if (isPinching) {
          isPinching = false;
          currentShape = null;
          shapeCreatedThisPinch = false;
          originalDistance = null;
      }
  }
});

const initCamera = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
  video.srcObject = stream;
  await new Promise(resolve => video.onloadedmetadata = resolve);
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  // The Camera class from MediaPipe examples handles sending frames to Hands
  new Camera(video, {
    onFrame: async () => await hands.send({ image: video }),
    width: video.videoWidth,
    height: video.videoHeight
  }).start();
};

initThree();
initCamera();

// --- END OF FILE main.js ---
