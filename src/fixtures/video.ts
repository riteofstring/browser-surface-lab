import workloadManifest from "../../workload-manifest.json";

import type { FixtureFactory } from "./contract";
import { createFixtureLifecycle } from "./lifecycle";

const workload = workloadManifest.fixtures.video;

export const createVideoFixture: FixtureFactory = (root, options = {}) => {
  root.className = "surface surface--video";
  const shell = document.createElement("div");
  shell.className = "video-shell";
  const video = document.createElement("video");
  video.autoplay = false;
  video.controls = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = workload.source;
  const label = document.createElement("div");
  label.className = "surface-label";
  label.innerHTML = `<span>Native video</span><strong>${workload.width} × ${workload.height} · ${workload.framesPerSecond} fps</strong>`;
  shell.append(video, label);
  root.replaceChildren(shell);

  let callbackHandle: number | null = null;
  let checksum = 0;
  let decodedFrames = 0;
  let playFailures = 0;

  const scheduleFrame = (): void => {
    if (callbackHandle !== null) {
      return;
    }
    callbackHandle = video.requestVideoFrameCallback((_now, metadata) => {
      callbackHandle = null;
      decodedFrames = Math.max(decodedFrames, metadata.presentedFrames);
      checksum = (checksum * 33 + Math.round(metadata.mediaTime * 1000)) >>> 0;
      if (!video.paused) {
        scheduleFrame();
      }
    });
  };
  const pause = (): void => {
    video.pause();
    if (callbackHandle !== null) {
      video.cancelVideoFrameCallback(callbackHandle);
      callbackHandle = null;
    }
  };
  const resume = (): void => {
    void video.play().then(scheduleFrame, () => {
      playFailures += 1;
    });
  };

  const handle = createFixtureLifecycle({
    destroy() {
      pause();
      video.removeAttribute("src");
      video.load();
      root.replaceChildren();
    },
    fixtureId: "video",
    pause,
    reset() {
      checksum = 0;
      decodedFrames = 0;
      playFailures = 0;
      video.currentTime = 0;
    },
    resume,
    snapshot() {
      return {
        checksum,
        counters: { decodedFrames, playFailures },
        details: {
          currentTime: Math.round(video.currentTime * 1000) / 1000,
          duration: Number.isFinite(video.duration) ? video.duration : null,
          readyState: video.readyState,
          videoHeight: video.videoHeight,
          videoWidth: video.videoWidth,
        },
        supported: video.canPlayType("video/webm; codecs=vp9") !== "",
      };
    },
  });
  if (options.autoStart !== false) {
    handle.command("start");
  }
  return handle;
};
