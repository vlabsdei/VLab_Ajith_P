// scene3d.js — Three.js scene coordinator.
// Manages lighting, renderer, ground grid, and rendering loop.

window.Scene = (function () {
  'use strict';

  let renderer, scene, camera, controls, clock;
  let animFrameId = null;
  let activeTab = 1;

  function init() {
    const canvas = document.getElementById('droneCanvas');
    const wrapper = document.getElementById('canvasWrapper');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);

    // WebGL Renderer 
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // Camera 
    const w = wrapper.clientWidth || 600;
    const h = wrapper.clientHeight || 260;
    camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
    camera.position.set(0.25, 0.18, 0.35); // Default close view for Tab 1 stand

    // Orbit Controls 
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.12;
    controls.maxDistance = 5.0;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.target.set(0, 0.10, 0);
    controls.update();

    // Lighting System 
    const ambient = new THREE.AmbientLight(0xffffff, 0.60);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(1.5, 3.0, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 1024;
    sun.shadow.mapSize.height = 1024;
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 10;
    sun.shadow.camera.left = -1.0;
    sun.shadow.camera.right = 1.0;
    sun.shadow.camera.top = 1.0;
    sun.shadow.camera.bottom = -1.0;
    sun.shadow.bias = -0.0002;
    scene.add(sun);

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0xe5e7eb, 0.3);
    scene.add(hemi);

    // Ground Platform 
    const groundGeo = new THREE.PlaneGeometry(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xe5e7eb,
      roughness: 0.9,
      metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid 
    const grid = new THREE.GridHelper(8, 40, 0xcbd5e1, 0xe5e7eb);
    grid.position.y = 0;
    scene.add(grid);

    clock = new THREE.Clock();

    resize();
    startLoop();
  }

  function startLoop() {
    if (animFrameId) return;
    function loop() {
      animFrameId = requestAnimationFrame(loop);
      const delta = clock.getDelta();
      
      controls.update();

      if (window.DroneModel) {
        window.DroneModel.animateProps(delta);
      }

      if (window.VLAB && window.VLAB.tickStand && activeTab === 2) {
        window.VLAB.tickStand(delta);
      }

      if (window.FlightSim && window.FlightSim.isRunning()) {
        window.FlightSim.tick(delta);
      }

      renderer.render(scene, camera);
    }
    loop();
  }

  function resize() {
    const wrapper = document.getElementById('canvasWrapper');
    if (!wrapper || !renderer) return;
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setTab(n) {
    activeTab = n;
    controls.enabled = true;

    if (n === 2) {
      camera.position.set(0.30, 0.20, 0.40); // Wider look at motor + propeller stand
      controls.target.set(-0.04, 0.08, 0); // Offset target to the left to avoid HUD overlap
    } else {
      camera.position.set(0.70, 0.45, 0.90); // Overview for drone assembly/flight
      controls.target.set(0, 0.10, 0);
    }
    controls.update();

    /* Force redraw of models to match current tab mode */
    if (window.DroneModel && window.VLAB && window.VLAB.state) {
      window.DroneModel.updateFromSelections(window.VLAB.state.selections);
    }
  }

  function getRenderer()  { return renderer; }
  function getScene()     { return scene; }
  function getCamera()    { return camera; }
  function getControls()  { return controls; }
  function getActiveTab() { return activeTab; }

  return { init, resize, setTab, getRenderer, getScene, getCamera, getControls, getActiveTab };
})();
