// drone_model.js — Parametric 3D Drone Builder.
// Rebuilds the viewport scene graph dynamically based on tab and selections.

window.DroneModel = (function () {
  'use strict';

  const THREE = window.THREE;

  /* Arm configuration: diagonal offset vectors (X configuration) */
  const ARM_DIRECTIONS = [
    new THREE.Vector3( 1, 0, -1).normalize(), // Front-Right
    new THREE.Vector3(-1, 0, -1).normalize(), // Front-Left
    new THREE.Vector3( 1, 0,  1).normalize(), // Rear-Right
    new THREE.Vector3(-1, 0,  1).normalize()  // Rear-Left
  ];

  /* Propeller rotation directions (adjacent motors counter-rotate) */
  const PROP_ROTATION_SIGNS = [1, -1, -1, 1];

  let droneGroup = null;
  let propGroups = [];
  let blurDiscs = [];
  let rotationRPM = 0;

  /* LCD Display Texture & State for Digital Thrust stand */
  let lcdCanvas = null;
  let lcdCtx = null;
  let lcdTexture = null;

  /* Smoke particle system variables */
  let smokeParticles = [];
  let isBurning = false;
  let spawnTimer = 0.0;

  function initLCDTexture() {
    if (lcdTexture) return;
    lcdCanvas = document.createElement('canvas');
    lcdCanvas.width = 256;
    lcdCanvas.height = 128;
    lcdCtx = lcdCanvas.getContext('2d');
    lcdTexture = new THREE.CanvasTexture(lcdCanvas);
    updateThrustStandDisplay(0, 0, 0, 'READY');
  }

  function updateThrustStandDisplay(measuredThrust, targetThrust, rpm, status) {
    if (!lcdCtx) return;
    
    // Draw background (dark slate)
    lcdCtx.fillStyle = '#0f172a';
    lcdCtx.fillRect(0, 0, 256, 128);
    
    // Draw border (cyan/blue stroke)
    lcdCtx.strokeStyle = '#0284c7';
    lcdCtx.lineWidth = 6;
    lcdCtx.strokeRect(3, 3, 250, 122);
    
    // Title
    lcdCtx.fillStyle = '#38bdf8';
    lcdCtx.font = 'bold 15px sans-serif';
    lcdCtx.fillText('THRUST MEASURING TOOL', 16, 24);
    
    // Measured Thrust (green if matches target, red if stall/burn)
    lcdCtx.fillStyle = (status === 'BURN!') ? '#ef4444' : (status === 'STALL') ? '#f59e0b' : '#34d399';
    lcdCtx.font = '22px monospace';
    lcdCtx.fillText('MEASURED: ' + measuredThrust.toFixed(3) + ' N', 16, 56);
    
    // Required Hover Target
    lcdCtx.fillStyle = '#94a3b8';
    lcdCtx.font = '16px monospace';
    lcdCtx.fillText('REQUIRED: ' + targetThrust.toFixed(3) + ' N', 16, 82);
    
    // Loaded RPM & Status
    lcdCtx.fillStyle = '#f1f5f9';
    lcdCtx.font = '15px monospace';
    lcdCtx.fillText('RPM: ' + Math.round(rpm) + ' | ' + status, 16, 108);
    
    lcdTexture.needsUpdate = true;
  }

  function updateSmoke(delta) {
    if (isBurning && droneGroup) {
      spawnTimer += delta;
      if (spawnTimer >= 0.04) {
        spawnTimer = 0.0;
        
        // Find motor positions to spawn smoke
        const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
        if (activeTab === 3) {
          const frame = window.VLAB.state.selections.frame;
          const bh = frame ? frame.body_size_mm[1] / 1000 : 0.026;
          const motorRadius = frame ? frame.wheelbase_mm / 2000 : 0.225;
          
          ARM_DIRECTIONS.forEach(function (dir) {
            const tipPos = dir.clone().multiplyScalar(motorRadius);
            tipPos.y = bh * 0.45 + 0.015;
            // Add drone offset
            const globalPos = tipPos.clone().add(droneGroup.position);
            spawnParticle(globalPos);
          });
        } else if (activeTab === 2) {
          // Spawn smoke from the stand motor position (0, 0.144, 0)
          const standMotorPos = new THREE.Vector3(0, 0.144, 0);
          spawnParticle(standMotorPos);
        }
      }
    }
    
    // Update active particles
    const sc = window.Scene ? window.Scene.getScene() : null;
    if (sc) {
      for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        p.age += delta;
        if (p.age >= p.maxAge) {
          sc.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          smokeParticles.splice(i, 1);
        } else {
          const t = p.age / p.maxAge;
          p.mesh.position.addScaledVector(p.velocity, delta);
          p.mesh.scale.setScalar(p.startScale * (1.0 + t * 4.0));
          p.mesh.material.opacity = p.startOpacity * (1.0 - t);
        }
      }
    }
  }

  function spawnParticle(pos) {
    const sc = window.Scene ? window.Scene.getScene() : null;
    if (!sc) return;
    const geo = new THREE.SphereGeometry(0.008, 6, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4b5563, // dark grey smoke
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    sc.add(mesh);
    
    smokeParticles.push({
      mesh: mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.04,
        0.15 + Math.random() * 0.10,
        (Math.random() - 0.5) * 0.04
      ),
      age: 0.0,
      maxAge: 0.8 + Math.random() * 0.5,
      startScale: 0.5 + Math.random() * 0.4,
      startOpacity: 0.35
    });
  }

  function setBurnState(burn) {
    isBurning = burn;
    if (!burn) {
      const sc = window.Scene ? window.Scene.getScene() : null;
      if (sc) {
        smokeParticles.forEach(p => {
          sc.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        });
      }
      smokeParticles = [];
    }
  }

  function hexToHexInt(hexStr) {
    return parseInt(hexStr.replace('#', ''), 16);
  }

  function createMaterial(color, roughness, metalness, extraOpts) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      roughness: roughness,
      metalness: metalness
    }, extraOpts || {}));
  }

  function alignMeshAlongDirection(mesh, direction) {
    const defaultUp = new THREE.Vector3(0, 1, 0);
    const normalizedDir = direction.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultUp, normalizedDir);
    mesh.setRotationFromQuaternion(quaternion);
  }

  function ensureGroup() {
    if (!window.Scene || !window.Scene.getScene()) return;
    if (!droneGroup) {
      droneGroup = new THREE.Group();
      droneGroup.position.set(0, 0.10, 0);
      window.Scene.getScene().add(droneGroup);
    }
  }

  function clearAll() {
    if (!droneGroup) return;
    while (droneGroup.children.length > 0) {
      const child = droneGroup.children[0];
      droneGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
    propGroups = [];
    blurDiscs = [];
  }

  // Procedural propeller blade builder.
// Generates a realistic twisted and tapered aerodynamic blade.
  function createAeroBlade(radius, baseChord, directionSign) {
    const blade = new THREE.Group();
    const numSegments = 6;
    const startRadius = 0.006;
    const stepLength = (radius - startRadius) / numSegments;

    for (let i = 0; i < numSegments; i++) {
      const segStart = startRadius + i * stepLength;
      const segEnd = segStart + stepLength;
      const segMid = (segStart + segEnd) / 2.0;
      const segLength = stepLength * 1.05; // 5% overlap to avoid visible seams

      const t = i / (numSegments - 1); // Normalized radius: 0 (root) to 1 (tip)

      // Chord width and thickness taper from hub to tip
      const segmentChord = baseChord * (1.1 * (1 - t) + 0.4 * t);
      const segmentThickness = 0.003 * (1 - t) + 0.0006 * t;

      // Helical twist: high pitch angle at root, flattening towards the tip
      const pitchAngle = (0.32 * (1 - t) + 0.08 * t) * directionSign;

      const segGeo = new THREE.BoxGeometry(segLength, segmentThickness, segmentChord);
      
      // Add a high-visibility red tip to the outermost segment of the propeller
      const isTip = (i === numSegments - 1);
      const segMat = isTip 
        ? createMaterial(0xef4444, 0.4, 0.1) // High-visibility red tip
        : createMaterial(0x282828, 0.45, 0.1); // Matte black carbon prop
        
      const segMesh = new THREE.Mesh(segGeo, segMat);

      segMesh.position.x = segMid;
      segMesh.rotation.x = pitchAngle;
      segMesh.castShadow = true;

      blade.add(segMesh);
    }

    return blade;
  }

  // Standardized component builder.
  function updateFromSelections(sel) {
    ensureGroup();
    if (!droneGroup) return;
    clearAll();

    const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;

    const frame = sel.frame;
    const motor = sel.motor;
    const prop = sel.propeller;
    const batt = sel.battery;
    const esc = sel.esc;
    const fc = sel.flight_controller;
    const rx = sel.receiver;
    const payloads = sel.payloads || [];

    // TAB 2: AERODYNAMIC TEST STAND MODE (Measuring Tool)
    if (activeTab === 2) {
      droneGroup.position.set(0, 0, 0); // Ground level for stand base

      /* Base plate of the measuring stand */
      const baseGeo = new THREE.BoxGeometry(0.12, 0.008, 0.09);
      const baseMat = createMaterial(0x1e293b, 0.6, 0.3); // Slate 800
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = 0.004;
      baseMesh.receiveShadow = true;
      droneGroup.add(baseMesh);

      /* Vertical aluminum stand post representing load cell */
      const standHeight = 0.12;
      const standGeo = new THREE.BoxGeometry(0.016, standHeight, 0.024);
      const standMat = createMaterial(0x94a3b8, 0.45, 0.75); // Anodized aluminium
      const standMesh = new THREE.Mesh(standGeo, standMat);
      standMesh.position.y = standHeight / 2 + 0.008;
      standMesh.castShadow = true;
      standMesh.receiveShadow = true;
      droneGroup.add(standMesh);

      /* Group for Digital LCD display */
      const lcdGroup = new THREE.Group();
      lcdGroup.position.set(0.008, 0.075, 0.011);
      lcdGroup.rotation.x = -0.15; // Angled slightly upwards for visibility
      lcdGroup.rotation.y = Math.atan2(0.25, 0.35); // Angle to face the default camera (0.25, 0.18, 0.35)

      /* Digital LCD display housing */
      const lcdFrameGeo = new THREE.BoxGeometry(0.052, 0.034, 0.008);
      const lcdFrameMat = createMaterial(0x0f172a, 0.8, 0.15); // Black bezel
      const lcdFrame = new THREE.Mesh(lcdFrameGeo, lcdFrameMat);
      lcdFrame.position.set(0, 0, 0);
      lcdFrame.castShadow = true;
      lcdGroup.add(lcdFrame);

      /* LCD Screen texture plane */
      initLCDTexture();
      const lcdScreenGeo = new THREE.PlaneGeometry(0.046, 0.028);
      const lcdScreenMat = new THREE.MeshBasicMaterial({
        map: lcdTexture,
        side: THREE.DoubleSide
      });
      const lcdScreen = new THREE.Mesh(lcdScreenGeo, lcdScreenMat);
      lcdScreen.position.set(0, 0, 0.0041); // slightly offset forward to avoid z-fighting
      lcdGroup.add(lcdScreen);

      droneGroup.add(lcdGroup);

      /* Mount bracket adapter at top */
      const mountGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.006, 12);
      const mountMat = createMaterial(0x334155, 0.5, 0.5);
      const mountMesh = new THREE.Mesh(mountGeo, mountMat);
      mountMesh.position.y = standHeight + 0.011;
      droneGroup.add(mountMesh);

      if (motor) {
        const motorY = standHeight + 0.014;

        /* Selected Motor Bell */
        const bellR = (motor.bell_diameter_mm / 2) / 1000;
        const bellH = motor.bell_height_mm / 1000;
        const bellGeo = new THREE.CylinderGeometry(bellR, bellR * 0.82, bellH, 20);
        const bellMat = createMaterial(0x1e293b, 0.3, 0.7);
        const bellMesh = new THREE.Mesh(bellGeo, bellMat);
        bellMesh.position.y = motorY + bellH / 2;
        bellMesh.castShadow = true;
        droneGroup.add(bellMesh);

        /* Motor Stator */
        const statorGeo = new THREE.CylinderGeometry(bellR * 0.55, bellR * 0.55, bellH * 0.6, 12);
        const statorMat = createMaterial(0xd97706, 0.5, 0.4); // windings
        const statorMesh = new THREE.Mesh(statorGeo, statorMat);
        statorMesh.position.y = motorY + bellH * 0.3;
        droneGroup.add(statorMesh);

        /* Selected Propeller */
        if (prop) {
          const propR = prop.diameter_m / 2;
          const propChord = 0.016 + prop.diameter_m * 0.04;
          const hubH = 0.012;
          const propY = motorY + bellH + hubH / 2;

          const propGroup = new THREE.Group();
          propGroup.position.set(0, propY, 0);
          droneGroup.add(propGroup);
          propGroups.push(propGroup);

          /* Propeller Hub */
          const hubGeo = new THREE.CylinderGeometry(0.006, 0.006, hubH, 12);
          const hubMat = createMaterial(0x1f2937, 0.5, 0.1);
          const hubMesh = new THREE.Mesh(hubGeo, hubMat);
          propGroup.add(hubMesh);

          /* Bullet locknut spinner */
          const nutGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.006, 6); // hexagonal nut shape
          const nutMat = createMaterial(0xd1d5db, 0.2, 0.9); // Metallic spinner
          const nutMesh = new THREE.Mesh(nutGeo, nutMat);
          nutMesh.position.y = hubH / 2 + 0.003;
          propGroup.add(nutMesh);

          /* 2 Aero Blades */
          const b1 = createAeroBlade(propR, propChord, 1);
          const b2 = createAeroBlade(propR, propChord, 1);
          b2.rotation.y = Math.PI;
          propGroup.add(b1);
          propGroup.add(b2);

          /* Propeller Blur Disc */
          const discGeo = new THREE.CircleGeometry(propR * 1.03, 32);
          const discMat = new THREE.MeshBasicMaterial({
            color: 0x1f2937,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const discMesh = new THREE.Mesh(discGeo, discMat);
          discMesh.rotation.x = -Math.PI / 2;
          propGroup.add(discMesh);
          blurDiscs.push(discMat);
        }
      }
      return;
    }

    // TAB 2: FULL DRONE FLIGHT MODE (Hover Simulation)
    droneGroup.position.set(0, 0.10, 0); // Restore stand-off position (landing legs height)

    if (!frame) return;

    const bw = frame.body_size_mm[0] / 1000;
    const bh = frame.body_size_mm[1] / 1000;
    const bz = frame.body_size_mm[2] / 1000;

    const frameMat = createMaterial(hexToHexInt(frame.color_hex), frame.roughness, frame.metalness);

    /* Bottom Plate */
    const bottomPlateGeo = new THREE.BoxGeometry(bw, 0.002, bz);
    const bottomPlate = new THREE.Mesh(bottomPlateGeo, frameMat);
    bottomPlate.position.y = 0;
    bottomPlate.receiveShadow = true;
    bottomPlate.castShadow = true;
    droneGroup.add(bottomPlate);

    /* Top Plate */
    const topPlateGeo = new THREE.BoxGeometry(bw * 0.95, 0.002, bz * 0.95);
    const topPlate = new THREE.Mesh(topPlateGeo, frameMat);
    topPlate.position.y = bh;
    topPlate.castShadow = true;
    droneGroup.add(topPlate);

    /* Frame corner standoffs */
    const standoffR = 0.0025;
    const standoffMat = createMaterial(0xd1d5db, 0.3, 0.9); // Aluminium spacers
    const cornerOffsets = [
      [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]
    ];
    cornerOffsets.forEach(function (off) {
      const standoffGeo = new THREE.CylinderGeometry(standoffR, standoffR, bh - 0.002, 8);
      const standoffMesh = new THREE.Mesh(standoffGeo, standoffMat);
      standoffMesh.position.set(bw * off[0], bh / 2, bz * off[1]);
      standoffMesh.castShadow = true;
      droneGroup.add(standoffMesh);
    });

    /* Diagonal Arms */
    const motorRadius = frame.wheelbase_mm / 2000;
    const armR = (frame.arm_tube_od_mm / 2) / 1000;
    const armMat = createMaterial(hexToHexInt(frame.color_hex), frame.roughness + 0.1, frame.metalness);

    ARM_DIRECTIONS.forEach(function (dir, i) {
      /* Tubular Arm stretching from center to motor radius */
      const armGeo = new THREE.CylinderGeometry(armR, armR, motorRadius, 12);
      const armMesh = new THREE.Mesh(armGeo, armMat);
      armMesh.position.copy(dir.clone().multiplyScalar(motorRadius / 2));
      armMesh.position.y = bh * 0.45; // Clamped in center of plates
      alignMeshAlongDirection(armMesh, new THREE.Vector3(dir.x, 0, dir.z));
      armMesh.castShadow = true;
      droneGroup.add(armMesh);

      /* Motor Mount Plate at tip */
      const tipPos = new THREE.Vector3(dir.x * motorRadius, bh * 0.45, dir.z * motorRadius);
      const mountGeo = new THREE.CylinderGeometry(armR * 2.1, armR * 2.1, 0.003, 12);
      const mountMesh = new THREE.Mesh(mountGeo, frameMat);
      mountMesh.position.copy(tipPos);
      droneGroup.add(mountMesh);

      /* Landing Leg structure (clamps to arm tip) */
      const legHeight = 0.12;
      const legGeo = new THREE.CylinderGeometry(0.003, 0.002, legHeight, 6);
      const legMesh = new THREE.Mesh(legGeo, frameMat);
      legMesh.position.copy(tipPos);
      legMesh.position.y -= legHeight / 2 + 0.002;
      alignMeshAlongDirection(legMesh, new THREE.Vector3(0, -1, 0));
      legMesh.castShadow = true;
      droneGroup.add(legMesh);

      /* Motor stator & rotating bell */
      if (motor) {
        const bellR = (motor.bell_diameter_mm / 2) / 1000;
        const bellH = motor.bell_height_mm / 1000;
        const motorY = tipPos.y + 0.0015;

        const bellGeo = new THREE.CylinderGeometry(bellR, bellR * 0.85, bellH, 16);
        const bellMat = createMaterial(0x1f2937, 0.3, 0.7);
        const bellMesh = new THREE.Mesh(bellGeo, bellMat);
        bellMesh.position.copy(tipPos);
        bellMesh.position.y = motorY + bellH / 2;
        bellMesh.castShadow = true;
        droneGroup.add(bellMesh);

        const statorGeo = new THREE.CylinderGeometry(bellR * 0.55, bellR * 0.55, bellH * 0.5, 10);
        const statorMat = createMaterial(0xd97706, 0.5, 0.4);
        const statorMesh = new THREE.Mesh(statorGeo, statorMat);
        statorMesh.position.copy(tipPos);
        statorMesh.position.y = motorY + bellH * 0.25;
        droneGroup.add(statorMesh);

        /* Dynamic Propellers */
        if (prop) {
          const propR = prop.diameter_m / 2;
          const propChord = 0.016 + prop.diameter_m * 0.04;
          const hubH = 0.012;
          const propY = motorY + bellH + hubH / 2;

          const propGroup = new THREE.Group();
          propGroup.position.set(tipPos.x, propY, tipPos.z);
          droneGroup.add(propGroup);
          propGroups.push(propGroup);

          /* Hub */
          const hubGeo = new THREE.CylinderGeometry(0.006, 0.006, hubH, 10);
          const hubMat = createMaterial(0x111827, 0.5, 0.1);
          const hubMesh = new THREE.Mesh(hubGeo, hubMat);
          propGroup.add(hubMesh);

          /* Silver Prop Locknut */
          const nutGeo = new THREE.CylinderGeometry(0.0035, 0.0045, 0.005, 8);
          const nutMat = createMaterial(0xd1d5db, 0.2, 0.9);
          const nutMesh = new THREE.Mesh(nutGeo, nutMat);
          nutMesh.position.y = hubH / 2 + 0.0025;
          propGroup.add(nutMesh);

          /* CW or CCW blade twists */
          const dirSign = PROP_ROTATION_SIGNS[i];
          const b1 = createAeroBlade(propR, propChord, dirSign);
          const b2 = createAeroBlade(propR, propChord, dirSign);
          b2.rotation.y = Math.PI;

          propGroup.add(b1);
          propGroup.add(b2);

          /* Blur Circle */
          const discGeo = new THREE.CircleGeometry(propR * 1.02, 32);
          const discMat = new THREE.MeshBasicMaterial({
            color: 0x111827,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const discMesh = new THREE.Mesh(discGeo, discMat);
          discMesh.rotation.x = -Math.PI / 2;
          propGroup.add(discMesh);
          blurDiscs.push(discMat);
        }
      }
    });

    // Bottom-Mounted Battery with velcro straps 
    if (batt) {
      const capacity = batt.capacity_mah;
      const normVal = Math.min(Math.max((capacity - 800) / 3400, 0), 1);
      const battW = 0.068 + normVal * 0.076;
      const battH = 0.026 + normVal * 0.016;
      const battD = 0.020 + normVal * 0.018;

      const cellColors = { 3: 0x6e2a14, 4: 0x1f2937, 6: 0x1e1b4b };
      const battColor = cellColors[batt.cells] || 0x22252a;

      const battGeo = new THREE.BoxGeometry(battW, battH, battD);
      const battMat = createMaterial(battColor, 0.8, 0.05);
      const battMesh = new THREE.Mesh(battGeo, battMat);

      // Mount battery DIRECTLY BELOW the bottom plate
      const battY = -battH / 2 - 0.003;
      battMesh.position.set(0, battY, 0);
      battMesh.castShadow = true;
      droneGroup.add(battMesh);

      /* Silicone Battery Cushion Pad */
      const padGeo = new THREE.BoxGeometry(battW * 0.9, 0.002, battD * 0.9);
      const padMat = createMaterial(0x111827, 0.9, 0.0); // Rough matte rubber
      const padMesh = new THREE.Mesh(padGeo, padMat);
      padMesh.position.set(0, -0.001, 0);
      droneGroup.add(padMesh);

      /* Velcro Straps (Two loops wrapping around body and battery) */
      const strapWidth = 0.008;
      const strapMat = createMaterial(0x111827, 0.9, 0.0);
      const strapOffsets = [-battW * 0.25, battW * 0.25];

      strapOffsets.forEach(function (zOff) {
        // Simple rectangular loop representation
        const strapGeo = new THREE.BoxGeometry(battD * 1.05, battH + bh + 0.006, strapWidth);
        const strapMesh = new THREE.Mesh(strapGeo, strapMat);
        strapMesh.position.set(zOff, (bh - battH) / 2, 0);
        strapMesh.rotation.y = Math.PI / 2;
        droneGroup.add(strapMesh);
      });
    }

    // Stacked Electronics (FC & ESC inside frame) 
    if (esc) {
      if (esc.quantity === 1) {
        /* 4-in-1 ESC (bottom of the stack) */
        const escGeo = new THREE.BoxGeometry(0.032, 0.003, 0.032);
        const escMat = createMaterial(0x14532d, 0.7, 0.1); // Green PCB
        const escMesh = new THREE.Mesh(escGeo, escMat);
        escMesh.position.set(0, 0.008, 0);
        droneGroup.add(escMesh);

        /* Tiny spacer columns under FC */
        const spacerGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.006, 6);
        const spacerMat = createMaterial(0xf59e0b, 0.5, 0.2); // Brass nylon spacer
        const stackCorners = [[-0.012, -0.012], [0.012, -0.012], [-0.012, 0.012], [0.012, 0.012]];
        stackCorners.forEach(function (pt) {
          const spacer = new THREE.Mesh(spacerGeo, spacerMat);
          spacer.position.set(pt[0], 0.0125, pt[1]);
          droneGroup.add(spacer);
        });
      } else {
        /* Individual ESCs mounted on arms */
        ARM_DIRECTIONS.forEach(function (dir) {
          const escPos = dir.clone().multiplyScalar(motorRadius * 0.45);
          const escGeo = new THREE.BoxGeometry(0.014, 0.003, 0.024);
          const escMat = createMaterial(0x111827, 0.85, 0.0);
          const escMesh = new THREE.Mesh(escGeo, escMat);
          escMesh.position.set(escPos.x, bh * 0.45 + 0.004, escPos.z);
          escMesh.rotation.y = Math.atan2(dir.x, dir.z);
          droneGroup.add(escMesh);
        });
      }
    }

    if (fc) {
      /* FC (top of the stack) */
      const fcY = esc && esc.quantity === 1 ? 0.018 : 0.010;
      const fcGeo = new THREE.BoxGeometry(0.030, 0.003, 0.030);
      const fcMat = createMaterial(0x14532d, 0.7, 0.1);
      const fcMesh = new THREE.Mesh(fcGeo, fcMat);
      fcMesh.position.set(0, fcY, 0);
      droneGroup.add(fcMesh);
    }

    if (rx) {
      /* Receiver mounted on the rear of bottom plate */
      const rxGeo = new THREE.BoxGeometry(0.018, 0.004, 0.013);
      const rxMat = createMaterial(0x1f2937, 0.8, 0.05);
      const rxMesh = new THREE.Mesh(rxGeo, rxMat);
      rxMesh.position.set(0, 0.003, bz * 0.32);
      droneGroup.add(rxMesh);

      /* Thin antenna guide tube */
      const antGeo = new THREE.CylinderGeometry(0.0006, 0.0006, 0.045, 4);
      const antMat = createMaterial(0x111827, 0.9, 0.0);
      const antMesh = new THREE.Mesh(antGeo, antMat);
      antMesh.position.set(-0.004, 0.0225, bz * 0.34);
      antMesh.rotation.x = 0.25;
      antMesh.rotation.z = -0.15;
      droneGroup.add(antMesh);
    }

    // Payloads with Vibration-Damping mounts 
    payloads.forEach(function (p) {
      addPayload(p, frame);
    });
  }

  function addPayload(p, frame) {
    const bh = frame ? frame.body_size_mm[1] / 1000 : 0.026;
    const bw = frame ? frame.body_size_mm[0] / 1000 : 0.088;
    const bz = frame ? frame.body_size_mm[2] / 1000 : 0.088;

    switch (p.id) {
      case 'gimbal_2axis':
      case 'gimbal_3axis': {
        const g = new THREE.Group();

        /* Rubber Vibration Damping Balls (4 units) */
        const ballGeo = new THREE.SphereGeometry(0.003, 8, 8);
        const ballMat = createMaterial(0x2563eb, 0.9, 0.0); // Blue silicone damping balls
        const ballOffsets = [[-0.015, -0.015], [0.015, -0.015], [-0.015, 0.015], [0.015, 0.015]];
        ballOffsets.forEach(function (off) {
          const ball = new THREE.Mesh(ballGeo, ballMat);
          ball.position.set(off[0], -0.0015, off[1]);
          g.add(ball);
        });

        /* Mount base cardan */
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.002, 0.035), createMaterial(0x1f2937, 0.6, 0.3));
        base.position.y = -0.004;
        g.add(base);

        if (p.id === 'gimbal_2axis') {
          const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.024, 8), createMaterial(0x4b5563, 0.5, 0.5));
          roll.rotation.z = Math.PI / 2;
          roll.position.set(0, -0.015, 0);
          g.add(roll);
        } else {
          const yaw = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.015, 10), createMaterial(0x1f2937, 0.5, 0.8));
          yaw.position.set(0, -0.012, 0);
          g.add(yaw);
        }

        g.position.set(0, -0.002, -bw * 0.22);
        droneGroup.add(g);
        break;
      }

      case 'camera_gopro': {
        const g = new THREE.Group();
        // TPU GoPro frame mount
        const mountGeo = new THREE.BoxGeometry(0.036, 0.028, 0.024);
        const mountMat = createMaterial(0x2563eb, 0.8, 0.0); // Blue TPU
        const mount = new THREE.Mesh(mountGeo, mountMat);
        mount.position.y = frame ? frame.body_size_mm[1] / 1000 + 0.014 : 0.036;
        mount.position.z = -bw * 0.32;
        mount.rotation.x = -0.15; // Angled up
        g.add(mount);

        const camGeo = new THREE.BoxGeometry(0.032, 0.024, 0.018);
        const camMat = createMaterial(0x111827, 0.6, 0.1);
        const cam = new THREE.Mesh(camGeo, camMat);
        cam.position.copy(mount.position);
        cam.rotation.x = mount.rotation.x;
        g.add(cam);

        const lensGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.004, 12);
        const lensMat = createMaterial(0x1e3a8a, 0.1, 0.8);
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.rotation.x = Math.PI / 2;
        lens.position.copy(cam.position).add(new THREE.Vector3(0.007, 0, -0.010));
        g.add(lens);

        droneGroup.add(g);
        break;
      }

      case 'camera_fpv_nano': {
        const g = new THREE.Group();
        const sideGeo = new THREE.BoxGeometry(0.002, 0.015, 0.012);
        const sideMat = createMaterial(0x9ca3af, 0.4, 0.6);
        const left = new THREE.Mesh(sideGeo, sideMat);
        left.position.x = -0.008;
        const right = left.clone();
        right.position.x = 0.008;
        g.add(left);
        g.add(right);

        const coreGeo = new THREE.BoxGeometry(0.012, 0.012, 0.012);
        const coreMat = createMaterial(0x111827, 0.6, 0.1);
        const core = new THREE.Mesh(coreGeo, coreMat);
        g.add(core);

        const lensGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 0.005, 10);
        const lensMat = createMaterial(0x1e293b, 0.1, 0.9);
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.rotation.x = Math.PI / 2;
        lens.position.z = -0.0085;
        g.add(lens);

        g.position.set(0, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, -bw * 0.42);
        g.rotation.x = 0.25; // standard FPV camera angle
        droneGroup.add(g);
        break;
      }

      case 'gps_m8n':
      case 'gps_m9n_compass': {
        const g = new THREE.Group();
        const heightGPS = 0.06;
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, heightGPS, 6), createMaterial(0x111827, 0.8, 0.2));
        mast.position.y = heightGPS / 2;
        g.add(mast);

        const r = p.id === 'gps_m9n_compass' ? 0.025 : 0.020;
        const dome = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.006, 20), createMaterial(0xf3f4f6, 0.7, 0.05));
        dome.position.y = heightGPS + 0.003;
        g.add(dome);

        g.position.set(-bw * 0.2, frame ? frame.body_size_mm[1] / 1000 : 0.026, bz * 0.2);
        droneGroup.add(g);
        break;
      }

      case 'lidar_tfmini': {
        const g = new THREE.Group();
        const tf = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.010), createMaterial(0x111827, 0.8, 0.0));
        g.add(tf);
        g.position.set(0, -0.003, 0); // Mounted underneath the center plate
        g.rotation.x = Math.PI / 2; // Point down
        droneGroup.add(g);
        break;
      }

      case 'lidar_garmin': {
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 16), createMaterial(0x1f2937, 0.7, 0.1));
        g.add(base);
        g.position.set(0, -0.008, 0); // Point down
        droneGroup.add(g);
        break;
      }

      case 'telemetry_915': {
        const g = new THREE.Group();
        const TelemBox = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.014), createMaterial(0x2563eb, 0.7, 0.1));
        g.add(TelemBox);
        const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.070, 5), createMaterial(0x111827, 0.9, 0.0));
        whip.position.set(0.010, 0.035, 0); whip.rotation.z = -0.15;
        g.add(whip);
        g.position.set(bw * 0.4, (frame ? frame.body_size_mm[1] / 1000 : 0.026) / 2, 0);
        g.rotation.y = Math.PI / 2;
        droneGroup.add(g);
        break;
      }

      case 'fpv_vtx': {
        const g = new THREE.Group();
        const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.020, 0.008, 0.016), createMaterial(0x374151, 0.5, 0.7)); // Metal heatsink case
        g.add(bodyBox);
        const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 0.050, 6), createMaterial(0x111827, 0.9, 0.0));
        antenna.position.set(0, 0.025, 0.006);
        antenna.rotation.x = 0.2;
        g.add(antenna);
        g.position.set(0, frame ? frame.body_size_mm[1] / 1000 + 0.005 : 0.031, bz * 0.38);
        droneGroup.add(g);
        break;
      }

      default:
        break;
    }
  }

  function animateProps(delta) {
    updateSmoke(delta);

    if (!propGroups.length) return;
    const omega = (rotationRPM * 2.0 * Math.PI) / 60.0;

    propGroups.forEach(function (pg, i) {
      const activeTab = window.Scene ? window.Scene.getActiveTab() : 1;
      const sign = activeTab === 1 ? 1 : PROP_ROTATION_SIGNS[i];
      pg.rotation.y += sign * omega * delta;
    });

    const bladeOpa = rotationRPM > 800
      ? Math.max(0.0, 0.9 - (rotationRPM - 800) / 4000)
      : 0.9;
    const discOpa = rotationRPM > 1200
      ? Math.min(0.24, (rotationRPM - 1200) / 10000)
      : 0.0;

    propGroups.forEach(function (pg) {
      pg.children.forEach(function (child) {
        if (child.children.length > 0) {
          // Segments inside the blade group
          child.children.forEach(function (sub) {
            if (sub.geometry && sub.geometry.type === 'BoxGeometry') {
              sub.material.opacity = bladeOpa;
              sub.material.transparent = bladeOpa < 0.9;
            }
          });
        }
      });
    });

    blurDiscs.forEach(function (discMat) {
      discMat.opacity = discOpa;
    });
  }

  function setSimRPM(rpm) {
    rotationRPM = Math.max(0, rpm);
  }

  function getDroneGroup() { return droneGroup; }

  return { updateFromSelections, clearAll, animateProps, setSimRPM, getDroneGroup, updateThrustStandDisplay, setBurnState };
})();
