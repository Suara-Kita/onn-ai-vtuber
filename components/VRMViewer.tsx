"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from "@pixiv/three-vrm";
import type { VRM } from "@pixiv/three-vrm";

export default function VRMViewer() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width  = mount.clientWidth;
    const height = mount.clientHeight;
    // Guard against layout not ready
    if (width === 0 || height === 0) return;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();

    // Camera — portrait bust, face + chest visible
    const camera = new THREE.PerspectiveCamera(22, width / height, 0.1, 20);
    camera.position.set(0, 1.70, 2.09);
    camera.lookAt(0, 1.54, 0);

    // 3-point lighting
    const ambient     = new THREE.AmbientLight(0xffffff, 1.2);
    const keyLight    = new THREE.DirectionalLight(0xfff5e0, 1.5);
    const fillLight   = new THREE.DirectionalLight(0xd0e8ff, 0.5);
    const rimLight    = new THREE.DirectionalLight(0x8888ff, 0.4);
    keyLight.position.set(-1, 2, 2);
    fillLight.position.set(2, 1, 1);
    rimLight.position.set(0, 1, -2);
    scene.add(ambient, keyLight, fillLight, rimLight);

    let vrm: VRM | null = null;
    const clock = new THREE.Clock();
    let animFrameId = 0;

    // Idle state
    let blinkTimer    = 0;
    let blinkInterval = 3 + Math.random() * 2;
    let isBlinking    = false;
    let blinkPhase    = 0;
    let breatheTime   = 0;

    // Bone refs
    let leftUpperArm:  THREE.Object3D | null = null;
    let rightUpperArm: THREE.Object3D | null = null;
    let leftLowerArm:  THREE.Object3D | null = null;
    let rightLowerArm: THREE.Object3D | null = null;

    // Load VRM
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      "/models/apizz.vrm",
      (gltf) => {
        vrm = gltf.userData.vrm as VRM;
        VRMUtils.removeUnnecessaryVertices(vrm.scene);
        VRMUtils.combineSkeletons(vrm.scene);
        vrm.scene.rotation.y = Math.PI;
        scene.add(vrm.scene);

        if (vrm.humanoid) {
          leftUpperArm  = vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
          rightUpperArm = vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
          leftLowerArm  = vrm.humanoid.getNormalizedBoneNode("leftLowerArm");
          rightLowerArm = vrm.humanoid.getNormalizedBoneNode("rightLowerArm");
        }
      },
      undefined,
      (err) => console.error("VRM load error:", err)
    );

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (vrm) {
        vrm.update(delta);

        // Arms straight down
        if (leftUpperArm)  { leftUpperArm.rotation.z  =  Math.PI / 2; leftUpperArm.rotation.x  = 0; }
        if (rightUpperArm) { rightUpperArm.rotation.z = -Math.PI / 2; rightUpperArm.rotation.x = 0; }
        if (leftLowerArm)  { leftLowerArm.rotation.x  = 0; leftLowerArm.rotation.z  = 0; }
        if (rightLowerArm) { rightLowerArm.rotation.x = 0; rightLowerArm.rotation.z = 0; }

        breatheTime += delta;
        if (vrm.humanoid) {
          const chest = vrm.humanoid.getNormalizedBoneNode("chest");
          if (chest) chest.rotation.x = Math.sin(breatheTime * 0.8) * 0.015;
          const neck = vrm.humanoid.getNormalizedBoneNode("neck");
          if (neck) neck.rotation.x = Math.sin(breatheTime * 0.3) * 0.008;
        }

        // Blink
        blinkTimer += delta;
        if (!isBlinking && blinkTimer >= blinkInterval) {
          isBlinking = true; blinkPhase = 0; blinkTimer = 0;
          blinkInterval = 2.5 + Math.random() * 3;
        }
        if (isBlinking && vrm.expressionManager) {
          blinkPhase += delta * 8;
          const v = blinkPhase < Math.PI ? Math.sin(blinkPhase) : 0;
          if (blinkPhase >= Math.PI) isBlinking = false;
          vrm.expressionManager.setValue(VRMExpressionPresetName.BlinkLeft,  v);
          vrm.expressionManager.setValue(VRMExpressionPresetName.BlinkRight, v);
        }
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
}
