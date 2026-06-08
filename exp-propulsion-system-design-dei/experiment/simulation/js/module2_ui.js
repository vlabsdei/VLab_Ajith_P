// module2_ui.js — UI handling for Module 2

window.Mod2UI = (function() {
  
  let effChartInstance = null;
  let tachoChartInstance = null;
  let thrustChartInstance = null;

  function initEffChart() {
    const ctx = document.getElementById('effChart');
    if (!ctx) return;
    
    effChartInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Motor Efficiency',
          data: [],
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: true,
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: 'Copper Loss (W)',
          data: [],
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: true,
          borderDash: [5, 5],
          tension: 0.4,
          yAxisID: 'y1'
        },
        {
          label: 'Hover Point',
          data: [],
          borderColor: '#9ca3af',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          showLine: true,
          tension: 0,
          yAxisID: 'y'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: 'Throttle (%)' },
            min: 30,
            max: 105,
            grid: { color: '#f3f4f6' }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Efficiency (%)' },
            min: 0,
            max: 100,
            grid: { color: '#f3f4f6' }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'Loss (W)' },
            min: 0,
            grid: { drawOnChartArea: false }
          }
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              boxWidth: 12,
              font: { size: 10 },
              filter: function(item) {
                return item.text !== 'Hover Point';
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                if (ctx.dataset.label === 'Hover Point') return '';
                return `${ctx.dataset.label}: ${ctx.raw.y.toFixed(1)}`;
              }
            }
          }
        }
      }
    });
  }

  function initTachoChart() {
    const ctx = document.getElementById('tachometerChart');
    if (!ctx) return;

    tachoChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Loaded RPM', 'RPM Lost to Drag', 'Remaining Capacity'],
        datasets: [{
          data: [0, 0, 100],
          backgroundColor: [
            getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
            getComputedStyle(document.documentElement).getPropertyValue('--danger').trim(),
            getComputedStyle(document.documentElement).getPropertyValue('--border-light').trim()
          ],
          borderWidth: 0,
          cutout: '80%',
          circumference: 240,
          rotation: 240
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return `${ctx.label}: ${Math.round(ctx.raw)} RPM`;
              }
            }
          }
        }
      }
    });
  }

  function initThrustChart() {
    const ctx = document.getElementById('thrustChart');
    if (!ctx) return;
    
    thrustChartInstance = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Thrust (N)',
          data: [],
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          showLine: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            title: { display: true, text: 'Current (A)' },
            min: 0,
            grid: { color: '#f3f4f6' }
          },
          y: {
            type: 'linear',
            display: true,
            title: { display: true, text: 'Thrust (N)' },
            min: 0,
            grid: { color: '#f3f4f6' }
          }
        },
        plugins: {
          legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return `${ctx.dataset.label}: ${ctx.raw.y.toFixed(2)} at ${ctx.raw.x.toFixed(1)} A`;
              }
            }
          }
        }
      }
    });
  }

  function updateEffChart(dataPoints, hoverThrottlePct) {
    if (effChartInstance) {
      effChartInstance.data.datasets[0].data = dataPoints.map(p => ({ x: p.throttle_pct, y: p.efficiency_pct }));
      effChartInstance.data.datasets[1].data = dataPoints.map(p => ({ x: p.throttle_pct, y: p.power_loss_w }));
      
      if (hoverThrottlePct !== undefined && hoverThrottlePct !== null && hoverThrottlePct >= 0) {
        effChartInstance.data.datasets[2].data = [
          { x: hoverThrottlePct, y: 0 },
          { x: hoverThrottlePct, y: 100 }
        ];
      } else {
        effChartInstance.data.datasets[2].data = [];
      }
      effChartInstance.update();
    }
    if (thrustChartInstance) {
      thrustChartInstance.data.datasets[0].data = dataPoints.map(p => ({ x: p.current_a, y: p.thrust_n }));
      thrustChartInstance.update();
    }
  }

  function renderEffTable(dataPoints) {
    const tbody = document.getElementById('effTableBody');
    if (!tbody) return;
    
    let html = '';
    dataPoints.forEach(p => {
      html += `
        <tr>
          <td class="mono">${p.throttle_pct.toFixed(0)}%</td>
          <td class="mono">${Math.round(p.rpm || 0)}</td>
          <td class="mono">${p.thrust_n.toFixed(2)}</td>
          <td class="mono">${p.current_a.toFixed(1)}</td>
          <td class="mono">${(p.power_elec_w || p.power_w || 0).toFixed(0)}</td>
          <td class="mono">${(p.power_loss_w || 0).toFixed(0)}</td>
          <td class="mono" style="color:var(--accent); font-weight:600;">${p.efficiency_pct.toFixed(1)}%</td>
        </tr>
      `;
    });
    tbody.innerHTML = html;
  }

  function updateRpmGauge(freeRpm, loadedRpm, maxScaleRpm, targetHoverRpm) {
    if (!tachoChartInstance) return;
    
    const scale = Math.max(maxScaleRpm, 100);
    const lostRpm = Math.max(0, freeRpm - loadedRpm);
    const remainingScale = Math.max(0, scale - freeRpm);

    tachoChartInstance.data.datasets[0].data = [loadedRpm, lostRpm, remainingScale];
    tachoChartInstance.update();

    const lbl = document.getElementById('tachoRpmVal');
    if (lbl) lbl.textContent = Math.round(loadedRpm);
  }

  function updateCircuitDiagram(vBatt, vDrop, vBemf) {
    const elBatt = document.getElementById('circVbatt');
    const elDrop = document.getElementById('circVdrop');
    const elBemf = document.getElementById('circVbemf');
    if (elBatt) elBatt.textContent = `${vBatt.toFixed(1)}V`;
    if (elDrop) elDrop.textContent = `-${vDrop.toFixed(1)}V`;
    if (elBemf) elBemf.textContent = `${vBemf.toFixed(1)}V`;

    // Glow effect for resistor if voltage drop is significant (> 1V)
    const resistorContainer = elDrop.parentElement;
    if (vDrop > 1.0) {
      resistorContainer.style.background = 'var(--danger-light)';
      resistorContainer.style.outline = '1px solid var(--danger)';
      resistorContainer.style.borderRadius = '4px';
      resistorContainer.style.padding = '4px';
    } else {
      resistorContainer.style.background = 'transparent';
      resistorContainer.style.outline = 'none';
      resistorContainer.style.padding = '0';
    }
  }

  function updateSankeyDiagram(pElec, pMech, pLoss) {
    const elElec = document.getElementById('sankeyPelec');
    const elMech = document.getElementById('sankeyPmech');
    const elLoss = document.getElementById('sankeyPloss');
    const barMech = document.getElementById('sankeyBarMech');
    const barLoss = document.getElementById('sankeyBarLoss');

    if (!elElec || !barMech) return;

    elElec.textContent = `${pElec.toFixed(1)} W`;
    elMech.textContent = `${pMech.toFixed(1)} W`;
    elLoss.textContent = `${pLoss.toFixed(1)} W`;

    if (pElec > 0) {
      const mechPct = Math.max(0, Math.min((pMech / pElec) * 100, 100));
      const lossPct = Math.max(0, Math.min((pLoss / pElec) * 100, 100));
      barMech.style.width = `${mechPct}%`;
      barLoss.style.width = `${lossPct}%`;
    } else {
      barMech.style.width = `100%`;
      barLoss.style.width = `0%`;
    }
  }

  let unlockRenderer = null;
  let unlockScene = null;
  let unlockCamera = null;
  let unlockControls = null;
  let unlockClock = null;
  let unlockAnimId = null;
  let propSpinGroup = null;

  function initUnlockScene() {
    const canvas = document.getElementById('unlockCanvas');
    if (!canvas) return;

    if (unlockAnimId) {
      cancelAnimationFrame(unlockAnimId);
      unlockAnimId = null;
    }

    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 180;

    unlockScene = new THREE.Scene();
    unlockScene.background = new THREE.Color(0xf3f4f6); // light background matching surface-2

    // Camera
    unlockCamera = new THREE.PerspectiveCamera(40, w / h, 0.01, 10);
    unlockCamera.position.set(0.12, 0.10, 0.16);

    // WebGL Renderer
    unlockRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    unlockRenderer.setSize(w, h, false);
    unlockRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Controls
    unlockControls = new THREE.OrbitControls(unlockCamera, unlockRenderer.domElement);
    unlockControls.enableDamping = true;
    unlockControls.dampingFactor = 0.08;
    unlockControls.minDistance = 0.08;
    unlockControls.maxDistance = 1.0;
    unlockControls.target.set(0, 0.005, 0);
    unlockControls.update();

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.70);
    unlockScene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.90);
    sun.position.set(1.0, 2.0, 1.0);
    unlockScene.add(sun);

    // materials
    const motorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 }); // Slate metal
    const copperMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5, metalness: 0.5 }); // Copper windings
    const propMat = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.5, metalness: 0.1 }); // Carbon black
    const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4, metalness: 0.1 }); // Red tips
    const nutMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.2, metalness: 0.9 }); // Metallic spinner nut

    // root container
    const itemGroup = new THREE.Group();
    unlockScene.add(itemGroup);

    function createProceduralAssembly() {
      // clear procedural meshes
      while(itemGroup.children.length > 0) { 
        itemGroup.remove(itemGroup.children[0]); 
      }
      
      propSpinGroup = new THREE.Group();
      propSpinGroup.position.set(0, 0.011, 0); // mount on top
      itemGroup.add(propSpinGroup);

      // stator
      const statorGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.006, 16);
      const stator = new THREE.Mesh(statorGeo, motorMat);
      stator.position.y = -0.012;
      itemGroup.add(stator);

      // windings
      const coilsGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.004, 12);
      const coils = new THREE.Mesh(coilsGeo, copperMat);
      coils.position.y = -0.008;
      itemGroup.add(coils);

      // rotor bell
      const bellGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.014, 20);
      const bell = new THREE.Mesh(bellGeo, motorMat);
      bell.position.y = -0.009;
      propSpinGroup.add(bell);

      // shaft
      const shaftGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.024, 8);
      const shaft = new THREE.Mesh(shaftGeo, nutMat);
      shaft.position.y = -0.005;
      propSpinGroup.add(shaft);

      // hub
      const hubGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12);
      const hub = new THREE.Mesh(hubGeo, propMat);
      hub.position.y = 0.007;
      propSpinGroup.add(hub);

      // locknut
      const nutGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.004, 6);
      const nut = new THREE.Mesh(nutGeo, nutMat);
      nut.position.y = 0.012;
      propSpinGroup.add(nut);

      // generate blades
      const bladeRadius = 0.045;
      const numSegments = 6;
      const stepLength = bladeRadius / numSegments;

      for (let b = 0; b < 2; b++) {
        const angle = b * Math.PI;
        const bladeGroup = new THREE.Group();
        bladeGroup.rotation.y = angle;
        bladeGroup.position.y = 0.007;
        propSpinGroup.add(bladeGroup);

        for (let i = 0; i < numSegments; i++) {
          const t = i / (numSegments - 1);
          const segLen = stepLength;
          const segWidth = 0.007 * (1.1 * (1 - t) + 0.4 * t);
          const segThick = 0.001 * (1 - t) + 0.0003 * t;
          const twist = (0.28 * (1 - t) + 0.06 * t);

          const segGeo = new THREE.BoxGeometry(segLen, segThick, segWidth);
          const isTip = (i === numSegments - 1);
          const segMesh = new THREE.Mesh(segGeo, isTip ? redMat : propMat);
          
          segMesh.position.x = 0.006 + i * stepLength + stepLength / 2;
          segMesh.rotation.x = twist;
          bladeGroup.add(segMesh);
        }
      }
    }

    // load glb files
    if (window.GLTFLoader) {
      const loader = new window.GLTFLoader();
      
      const loadLower = new Promise((resolve, reject) => {
        loader.load('asset/motor_lower.glb', resolve, undefined, reject);
      });
      const loadUpper = new Promise((resolve, reject) => {
        loader.load('asset/motor_upper.glb', resolve, undefined, reject);
      });
      const loadProp = new Promise((resolve, reject) => {
        loader.load('asset/propeller.glb', resolve, undefined, reject);
      });

      Promise.all([loadLower, loadUpper, loadProp]).then(([gltfLower, gltfUpper, gltfProp]) => {
        // remove procedural items
        while (itemGroup.children.length > 0) {
          itemGroup.remove(itemGroup.children[0]);
        }

        propSpinGroup = new THREE.Group();
        propSpinGroup.position.set(0, 0, 0);
        itemGroup.add(propSpinGroup);

        const lowerScene = gltfLower.scene;
        const upperScene = gltfUpper.scene;
        const propScene = gltfProp.scene;

        // bounding box for base scale factor
        const boxLower = new THREE.Box3().setFromObject(lowerScene);
        const sizeLower = new THREE.Vector3();
        boxLower.getSize(sizeLower);
        
        const lowerDiameter = Math.max(sizeLower.x, sizeLower.z) || 1.0;
        const assemblyScale = 0.036 / lowerDiameter;

        // normalize & center stator
        lowerScene.scale.set(assemblyScale, assemblyScale, assemblyScale);
        
        const centerLower = new THREE.Vector3();
        boxLower.getCenter(centerLower);
        
        lowerScene.position.set(
          -centerLower.x * assemblyScale,
          -centerLower.y * assemblyScale,
          -centerLower.z * assemblyScale
        );
        itemGroup.add(lowerScene);

        // normalize & align rotor
        const boxUpper = new THREE.Box3().setFromObject(upperScene);
        const centerUpper = new THREE.Vector3();
        boxUpper.getCenter(centerUpper);
        const sizeUpper = new THREE.Vector3();
        boxUpper.getSize(sizeUpper);

        upperScene.scale.set(assemblyScale, assemblyScale, assemblyScale);
        upperScene.position.x = -centerUpper.x * assemblyScale;
        upperScene.position.z = -centerUpper.z * assemblyScale;
        upperScene.position.y = -centerLower.y * assemblyScale; // vertical align
        propSpinGroup.add(upperScene);

        // normalize propeller
        const boxProp = new THREE.Box3().setFromObject(propScene);
        const centerProp = new THREE.Vector3();
        boxProp.getCenter(centerProp);
        const sizeProp = new THREE.Vector3();
        boxProp.getSize(sizeProp);

        const propDiameter = Math.max(sizeProp.x, sizeProp.z) || 1.0;
        const propScale = (0.09 / propDiameter) * 1.45;

        propScene.scale.set(propScale, propScale, propScale);
        propScene.position.x = -centerProp.x * propScale;
        propScene.position.z = -centerProp.z * propScale;

        // position propeller along shaft
        const rotorHeight = sizeUpper.y * assemblyScale;
        const rotorBottomY = upperScene.position.y + boxUpper.min.y * assemblyScale;
        const rotorTransitionY = rotorBottomY + rotorHeight * 0.45;
        const rotorTopY = upperScene.position.y + boxUpper.max.y * assemblyScale;
        const shaftHeight = rotorTopY - rotorTransitionY;

        // 45% shaft height mount
        propScene.position.y = rotorTransitionY + shaftHeight * 0.45 - boxProp.min.y * propScale;
        propSpinGroup.add(propScene);

        // Shadows
        [lowerScene, upperScene, propScene].forEach(scene => {
          scene.traverse(child => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
        });

      }).catch(error => {
        console.error("Error loading GLB assembly models, using procedural assembly:", error);
        createProceduralAssembly();
      });
    } else {
      console.warn("GLTFLoader not found, using procedural assembly fallback.");
      createProceduralAssembly();
    }

    unlockClock = new THREE.Clock();

    function renderLoop() {
      unlockAnimId = requestAnimationFrame(renderLoop);
      const delta = unlockClock.getDelta();
      
      unlockControls.update();

      if (propSpinGroup) {
        propSpinGroup.rotation.y += 1.5 * delta;
      }
      if (itemGroup) {
        itemGroup.rotation.y += 0.25 * delta;
      }

      unlockRenderer.render(unlockScene, unlockCamera);
    }

    renderLoop();

    window.addEventListener('resize', onResizeUnlock);
  }

  function onResizeUnlock() {
    const canvas = document.getElementById('unlockCanvas');
    if (!canvas || !unlockRenderer || !unlockCamera) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    unlockRenderer.setSize(w, h, false);
    unlockCamera.aspect = w / h;
    unlockCamera.updateProjectionMatrix();
  }

  function buildTileGrid(containerId, items, selectedId, specFormatter, onClickCallback) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = '';
    items.forEach(item => {
      const isActive = item.id === selectedId;
      const idStr = `mod2_${containerId}_${item.id}`;
      html += `
        <label class="component-tile ${isActive ? 'active selected' : ''}" for="${idStr}">
          <input type="radio" name="${containerId}" id="${idStr}" value="${item.id}" ${isActive ? 'checked' : ''} style="display:none;">
          <div class="tile-label">
            <span class="tile-name">${item.label}</span>
            <span class="tile-spec">${specFormatter(item)}</span>
          </div>
        </label>
      `;
    });
    
    container.innerHTML = html;

    // Attach listeners
    const inputs = container.querySelectorAll('input[type="radio"]');
    inputs.forEach(input => {
      input.addEventListener('change', (e) => {
        // Update active classes
        container.querySelectorAll('.component-tile').forEach(t => t.classList.remove('active', 'selected'));
        if (e.target.checked) {
          e.target.parentElement.classList.add('active', 'selected');
        }
        
        // Find selected item
        const selectedItem = items.find(i => i.id === e.target.value);
        if (onClickCallback && selectedItem) onClickCallback(selectedItem);
      });
    });
  }

  return {
    initEffChart: initEffChart,
    initTachoChart: initTachoChart,
    initThrustChart: initThrustChart,
    updateEffChart: updateEffChart,
    renderEffTable: renderEffTable,
    updateRpmGauge: updateRpmGauge,
    updateCircuitDiagram: updateCircuitDiagram,
    updateSankeyDiagram: updateSankeyDiagram,
    buildTileGrid: buildTileGrid,
    initUnlockScene: initUnlockScene
  };

})();
