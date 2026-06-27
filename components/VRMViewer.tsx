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

    // Talking state — triggered by tanyalah-onn:talking CustomEvent
    let isTalking    = false;
    let talkTime     = 0;
    let talkDuration = 0;

    const onTalking = (e: Event) => {
      const detail = (e as CustomEvent<{ duration?: number }>).detail;
      isTalking    = true;
      talkTime     = 0;
      talkDuration = detail?.duration ?? 28;
    };
    window.addEventListener("tanyalah-onn:talking", onTalking);

    // Check if an event fired before this listener was registered (race condition:
    // LeftPanel's initial poll can dispatch the event before VRMViewer mounts)
    const g = globalThis as Record<string, unknown>;
    const talkUntil = (g.__tanyalahOnnTalkUntil as number) ?? 0;
    const remaining = (talkUntil - Date.now()) / 1000;
    if (remaining > 0) {
      isTalking    = true;
      talkTime     = Math.max(0, 28 - remaining);
      talkDuration = 28;
    }

    // Bone refs
    let leftUpperArm:  THREE.Object3D | null = null;
    let rightUpperArm: THREE.Object3D | null = null;
    let leftLowerArm:  THREE.Object3D | null = null;
    let rightLowerArm: THREE.Object3D | null = null;
    let spine:         THREE.Object3D | null = null;
    let hips:          THREE.Object3D | null = null;

    // Load VRM
    const loader = new GLTFLoader();
    // ngrok free tier intercepts XHR with an HTML warning page; this header bypasses it
    loader.setRequestHeader({ "ngrok-skip-browser-warning": "ngrok-skip-browser-warning" });
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      "/models/tanyalah-onn.vrm",
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
          spine         = vrm.humanoid.getNormalizedBoneNode("spine");
          hips          = vrm.humanoid.getNormalizedBoneNode("hips");
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

        breatheTime += delta;
        const t = breatheTime;

        if (isTalking) {
          talkTime += delta;
          if (talkTime >= talkDuration) isTalking = false;

          const tk = talkTime;
          if (vrm.humanoid) {
            const neck = vrm.humanoid.getNormalizedBoneNode("neck");
            if (neck) {
              neck.rotation.x = Math.sin(t * 0.3) * 0.008 + Math.sin(tk * 2.0) * 0.12;
              neck.rotation.y = Math.sin(tk * 0.8) * 0.18;
              neck.rotation.z = Math.sin(tk * 0.6) * 0.04;
            }
            const chest = vrm.humanoid.getNormalizedBoneNode("chest");
            if (chest) {
              chest.rotation.x = Math.sin(t * 0.8) * 0.02 + Math.sin(tk * 1.2) * 0.04;
              chest.rotation.y = Math.sin(tk * 0.5) * 0.07;
            }
            if (spine) {
              spine.rotation.x = Math.sin(t * 0.8) * 0.01;
              spine.rotation.y = Math.sin(tk * 0.4) * 0.04;
            }
            // Right arm raises and gestures clearly
            if (rightUpperArm) {
              rightUpperArm.rotation.z = -Math.PI / 2 + 0.35 + Math.sin(tk * 1.1) * 0.25;
              rightUpperArm.rotation.x = Math.sin(tk * 0.9) * 0.22;
            }
            if (rightLowerArm) {
              rightLowerArm.rotation.x = 0.3 + Math.sin(tk * 1.4) * 0.22;
            }
            // Left arm — slight forward lean during talking
            if (leftUpperArm) {
              leftUpperArm.rotation.z  =  Math.PI / 2 - 0.08;
              leftUpperArm.rotation.x  = Math.sin(tk * 0.7) * 0.05;
            }
            if (leftLowerArm) { leftLowerArm.rotation.x = 0.1; leftLowerArm.rotation.z = 0; }
          }
        } else {
          // ── Idle animation ─────────────────────────────────────────────────
          // Layered sines at prime-ish frequencies to prevent repeating loops
          if (vrm.humanoid) {
            // Breathing drives chest and spine
            const breathe = Math.sin(t * 0.85) * 0.028 + Math.sin(t * 1.7) * 0.006;
            const chest = vrm.humanoid.getNormalizedBoneNode("chest");
            if (chest) {
              chest.rotation.x = breathe;
              chest.rotation.y = Math.sin(t * 0.19) * 0.018;
            }
            if (spine) {
              spine.rotation.x = breathe * 0.5;
              spine.rotation.y = Math.sin(t * 0.17) * 0.012;
            }
            if (hips) {
              hips.rotation.z = Math.sin(t * 0.23) * 0.008;
            }
            // Head wanders slowly — looks natural, not robotic
            const neck = vrm.humanoid.getNormalizedBoneNode("neck");
            if (neck) {
              neck.rotation.x = Math.sin(t * 0.31) * 0.055 + breathe * 0.3;
              neck.rotation.y = Math.sin(t * 0.23) * 0.14 + Math.sin(t * 0.07) * 0.06;
              neck.rotation.z = Math.sin(t * 0.17) * 0.035;
            }
          }
          // Arms hang with a very small oscillation — not rigid sticks
          if (leftUpperArm) {
            leftUpperArm.rotation.z  =  Math.PI / 2 - 0.05;
            leftUpperArm.rotation.x  = Math.sin(t * 0.37) * 0.025;
          }
          if (leftLowerArm)  { leftLowerArm.rotation.x = 0.05; leftLowerArm.rotation.z = 0; }
          if (rightUpperArm) {
            rightUpperArm.rotation.z = -Math.PI / 2 + 0.05;
            rightUpperArm.rotation.x = Math.sin(t * 0.41) * 0.025;
          }
          if (rightLowerArm) { rightLowerArm.rotation.x = 0.05; rightLowerArm.rotation.z = 0; }
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
      window.removeEventListener("tanyalah-onn:talking", onTalking);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
}
